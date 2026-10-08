-- O caixa e os eventos da projeção POR CONTA (20260929140000): a soma das contas É a visão geral.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/caixa_por_conta.sql

\set ON_ERROR_STOP on
begin;

do $$
declare
  usr uuid := '00000000-0000-0000-0000-00000000f1b1';
  ws uuid;
  a uuid; b uuid; c uuid; d uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into auth.users (id, email) values (usr, 'teste-caixa-por-conta@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (usr) on conflict (id) do nothing;
  select id into ws from public.workspaces where owner_id = usr order by created_at limit 1;
  if ws is null then
    insert into public.workspaces (name, owner_id) values ('teste caixa', usr) returning id into ws;
    insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');
  end if;
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'A', 'checking', 100000) returning id into a;
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'B', 'savings', 0) returning id into b;
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents, payment_account_id)
    values (ws, usr, 'C', 'credit_card', 3, 10, 500000, a) returning id into c;
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
    values (ws, usr, 'D', 'credit_card', 3, 10) returning id into d;

  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, status)
    values (ws, usr, 'expense', 5000, 'gasto A', a, hoje + 5, 'pending');
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, counterparty_account_id, occurred_at, status)
    values (ws, usr, 'transfer', 20000, 'A para B', a, b, hoje + 6, 'pending');
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, status)
    values (ws, usr, 'expense', 30000, 'compra C', c, hoje, 'pending');
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, status)
    values (ws, usr, 'expense', 7000, 'compra D', d, hoje, 'pending');
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, status)
    values (ws, usr, 'expense', 1000, 'sem conta', null, hoje + 2, 'pending');
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents, remaining_cents,
                            interest_rate_monthly, installments, installments_paid, installment_cents, account_id, due_day, first_due_date)
    values (ws, usr, 'Dívida B', 'financing', 'fixed_installments', 12000, 12000, 0, 10, 0, 1200, b,
            extract(day from hoje + 10)::int, hoje + 10);
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, account_id, rrule, next_run_at, dtstart)
    values (ws, usr, 'expense', 800, 'série A', a, 'FREQ=MONTHLY;BYMONTHDAY=' || least(extract(day from hoje + 15)::int, 28),
            (hoje + 15)::timestamptz, (hoje + 15)::timestamptz);
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f1b1', true);
set local role authenticated;

do $$
declare
  ws uuid[] := array(select private.my_workspace_ids());
  dif int;
begin
  -- 1. caixa por conta soma o cash_total — o das contas que entram no que dá para gastar
  -- (20261010170000: investimento e conta tirada pela pessoa ficam fora)
  if (select coalesce(sum(c.cents), 0) from private.caixa_das_contas(ws, current_date) c
        left join public.accounts a on a.id = c.account_id
       where private.conta_no_disponivel(a.type, a.spendable))
     <> private.cash_total(ws, current_date) then
    raise exception '1. caixa_das_contas não soma o cash_total';
  end if;
  -- 2. dia a dia, saldo inicial + eventos por conta = cash_flow_forecast
  select count(*) into dif from public.cash_flow_forecast(400) f
  where f.balance_cents <> private.cash_total(ws, current_date)
        + coalesce((select sum(e.in_cents - e.out_cents) from private.eventos_disponiveis(ws, current_date + 400) e
                    where e.day <= f.day), 0);
  if dif > 0 then raise exception '2. % dias divergem da projeção', dif; end if;
  -- 3. a fatura de C sai de A; a de D não tem conta
  if not exists (select 1 from private.eventos_de_caixa(ws, current_date + 400) e
                 where e.account_id = (select id from public.accounts where name = 'A' and workspace_id = any(ws))
                   and e.out_cents = 30000) then
    raise exception '3. a fatura do cartão C deveria sair da conta A';
  end if;
  if not exists (select 1 from private.eventos_de_caixa(ws, current_date + 400) e
                 where e.account_id is null and e.out_cents = 7000) then
    raise exception '3. a fatura do cartão D (sem conta de pagamento) deveria vir sem conta';
  end if;
  -- 4. a transferência A → B soma zero e aparece nos dois lados
  if (select count(*) from private.eventos_de_caixa(ws, current_date + 400) e
      where (e.out_cents = 20000 and e.account_id = (select id from public.accounts where name = 'A' and workspace_id = any(ws)))
         or (e.in_cents = 20000 and e.account_id = (select id from public.accounts where name = 'B' and workspace_id = any(ws)))) <> 2 then
    raise exception '4. a transferência deveria aparecer nos dois lados';
  end if;
  -- 5. a parcela da dívida sai de B
  if not exists (select 1 from private.eventos_de_caixa(ws, current_date + 400) e
                 where e.account_id = (select id from public.accounts where name = 'B' and workspace_id = any(ws))
                   and e.out_cents = 1200) then
    raise exception '5. a parcela da dívida deveria sair de B';
  end if;
  -- 6. a recorrente projetada sai de A
  if not exists (select 1 from private.eventos_de_caixa(ws, current_date + 400) e
                 where e.account_id = (select id from public.accounts where name = 'A' and workspace_id = any(ws))
                   and e.out_cents = 800) then
    raise exception '6. a recorrente deveria sair de A';
  end if;
end $$;

select 'caixa_por_conta: ok' as resultado;
rollback;
