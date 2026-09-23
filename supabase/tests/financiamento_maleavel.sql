-- `20260923160000`: o financiamento maleável.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/financiamento_maleavel.sql
--
-- 1–3: a âncora `first_due_date` move o cronograma (a fonte única de toda parcela futura).
-- 4: o contrato de parcela fixa muda mesmo com pagamento registrado, e o pagamento NOVO sai
--    coerente com o contrato novo. 5: `delete_debt` apaga pagamentos e dívida, e é idempotente.
-- 6: privilégio medido como `authenticated`/`anon`, nunca como dono (a lição da `20260911220000`).

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  ws uuid; u uuid; conta uuid; d1 uuid; d2 uuid;
  primeira date := (date_trunc('month', current_date) + interval '3 months')::date + 4; -- dia 5
  l record; n int;
begin
  select w.id, m.user_id into ws, u
  from public.workspaces w join public.workspace_members m on m.workspace_id = w.id
  order by w.created_at limit 1;
  select id into conta from public.accounts
  where workspace_id = ws and type <> 'credit_card' and not archived limit 1;
  if ws is null or conta is null then raise exception 'sem workspace/conta para testar'; end if;

  -- 1. primeira parcela daqui a 3 meses: o cronograma começa NELA
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents,
    remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents,
    due_day, first_due_date)
  values (ws, u, 'teste maleável 1', 'financing', 'fixed_installments', 120000, 120000, 0, 12, 0,
    10000, 5, primeira)
  returning id into d1;
  select * into l from private.debt_schedule_for(d1) order by installment_no limit 1;
  if l.installment_no <> 1 or l.due_date <> primeira then
    raise exception '1: primeira linha %ª em %, esperado 1ª em %', l.installment_no, l.due_date, primeira;
  end if;

  -- 2. uma paga (adiantada): a próxima é a 2ª, um mês depois da primeira — não a data original
  update public.debts set installments_paid = 1, remaining_cents = 110000 where id = d1;
  select * into l from private.debt_schedule_for(d1) order by installment_no limit 1;
  if l.installment_no <> 2 or l.due_date <> (primeira + interval '1 month')::date then
    raise exception '2: primeira linha %ª em %', l.installment_no, l.due_date;
  end if;

  -- 3. pagas 1 → 10: a numeração e a data andam pelo contrato
  update public.debts set installments_paid = 10, remaining_cents = 20000 where id = d1;
  select * into l from private.debt_schedule_for(d1) order by installment_no limit 1;
  if l.installment_no <> 11 or l.due_date <> (primeira + interval '10 months')::date then
    raise exception '3: primeira linha %ª em %', l.installment_no, l.due_date;
  end if;

  -- 4. contrato fixo com pagamento registrado: muda, e o pagamento novo sai coerente
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents,
    remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents, due_day)
  values (ws, u, 'teste maleável 2', 'financing', 'fixed_installments', 120000, 120000, 0, 12, 0, 10000, 10)
  returning id into d2;
  perform public.pay_debt_installment(d2, 10000, conta, current_date);
  update public.debts set installment_cents = 20000, principal_cents = 240000, remaining_cents = 220000
  where id = d2;
  perform public.pay_debt_installment(d2, 20000, conta, current_date);
  select installments_paid, remaining_cents into l from public.debts where id = d2;
  if l.installments_paid <> 2 or l.remaining_cents <> 200000 then
    raise exception '4: pagas % saldo %, esperado 2 e 200000', l.installments_paid, l.remaining_cents;
  end if;
  if not exists (select 1 from public.transactions where debt_id = d2 and debt_payment_no = 2
                   and debt_balance_after_cents = 200000) then
    raise exception '4: o pagamento novo não saiu coerente com o contrato novo';
  end if;

  -- 5. excluir por completo: os dois pagamentos e a dívida; a segunda chamada é no-op
  n := public.delete_debt(d2);
  if n <> 2 then raise exception '5: delete_debt devolveu %, esperado 2', n; end if;
  if exists (select 1 from public.debts where id = d2)
     or exists (select 1 from public.transactions where debt_id = d2) then
    raise exception '5: sobrou dívida ou pagamento';
  end if;
  if exists (select 1 from private.debt_schedule_for(d2)) then
    raise exception '5: o cronograma ainda devolve parcela';
  end if;
  n := public.delete_debt(d2);
  if n <> 0 then raise exception '5: a segunda chamada devolveu %', n; end if;
  n := public.delete_debt(d1);
  if n <> 0 or exists (select 1 from public.debts where id = d1) then
    raise exception '5: dívida sem pagamento não saiu limpa';
  end if;

  -- 7. RLS: quem não é do workspace chama e não apaga nada (a RPC é `security invoker`)
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents,
    remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents, due_day)
  values (ws, u, 'teste maleável 3', 'financing', 'fixed_installments', 120000, 120000, 0, 12, 0, 10000, 10)
  returning id into d2;
  perform public.pay_debt_installment(d2, 10000, conta, current_date);
  perform set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
  execute 'set local role authenticated';
  n := public.delete_debt(d2);
  execute 'reset role';
  if n <> 0 or not exists (select 1 from public.debts where id = d2)
     or not exists (select 1 from public.transactions where debt_id = d2) then
    raise exception '7: um estranho apagou % pagamentos de outro workspace', n;
  end if;

  -- 6. privilégio
  if not has_function_privilege('authenticated', 'public.delete_debt(uuid)', 'execute')
     or has_function_privilege('anon', 'public.delete_debt(uuid)', 'execute') then
    raise exception '6: execute de delete_debt errado';
  end if;
end $$;

rollback;
