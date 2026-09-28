-- Pix no crédito para conta própria (`20260928230000`): a transferência que SAI do cartão.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/pix_no_credito.sql
--
-- O que prende: a fatura SOMA o transfer (total, aberto, o que vence), o orçamento NÃO (não é
-- gasto), e o caixa conta o dinheiro UMA vez de cada lado — entra na conta no dia, sai na fatura
-- no vencimento, e o saldo no fim do horizonte não muda.

\set ON_ERROR_STOP on
begin;

do $$
declare
  usr uuid := '00000000-0000-0000-0000-000000000c12';
  ws uuid; conta uuid; itau uuid; cartao uuid;
  fat uuid; fat_pix uuid; pix uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  vence date;
  total_antes bigint; aberto_antes bigint; total_depois bigint; aberto_depois bigint;
  gasto_antes bigint; gasto_depois bigint;
  caixa_antes bigint; caixa_depois bigint;
  fim_antes bigint; fim_depois bigint;
  conta_antes bigint;
  v bigint; n int;
begin
  insert into auth.users (id, email) values (usr, 'teste-pix-credito@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (usr) on conflict (id) do nothing;
  insert into public.workspaces (name, owner_id) values ('teste pix no credito', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');

  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Conta', 'checking', 500000) returning id into conta;
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Itau', 'checking', 0) returning id into itau;
  insert into public.accounts
    (workspace_id, user_id, name, type, closing_day, due_day, payment_account_id)
    values (ws, usr, 'Cartao', 'credit_card', 3, 10, conta) returning id into cartao;

  insert into public.budgets (workspace_id, user_id, category, limit_cents)
    values (ws, usr, 'outros', 100000);

  -- uma compra de hoje: a fatura dela vence no futuro
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, category, description, occurred_at, status)
    values (ws, usr, cartao, 'expense', 10000, 'outros', 'Compra', hoje, 'pending');
  select invoice_id into fat from public.transactions where workspace_id = ws and description = 'Compra';
  select due_date into vence from public.card_invoices where id = fat;

  select invoice_total_cents, invoice_open_cents into total_antes, aberto_antes
    from public._card_summary(usr) where account_id = cartao;
  select coalesce(sum(spent_cents), 0) into gasto_antes
    from private.budgets_status_for(array[ws], date_trunc('month', hoje)::date, 'civil');
  caixa_antes := private.cash_total(array[ws]);
  select balance_cents into fim_antes from public._cash_flow_forecast(usr, 90) order by day desc limit 1;
  select coalesce(sum(case when e.origin = 'invoice' then e.out_cents end), 0) into conta_antes
    from private.cash_events(array[ws], hoje, vence + 1) e;

  -- o Pix no crédito: 340 do cartão para o Itaú, pago (o dinheiro chegou)
  insert into public.transactions
    (workspace_id, user_id, account_id, counterparty_account_id, kind, amount_cents, category,
     description, occurred_at, status, paid_at)
    values (ws, usr, cartao, itau, 'transfer', 34000, 'outros', 'Pix no credito', hoje, 'cleared', hoje)
    returning id, invoice_id into pix, fat_pix;

  -- 1. cai na MESMA fatura da compra
  if fat_pix is distinct from fat then
    raise exception '1: o Pix caiu em outra fatura (%, esperada %)', fat_pix, fat;
  end if;

  -- 2. a fatura SOMA o Pix: total e aberto
  select invoice_total_cents, invoice_open_cents into total_depois, aberto_depois
    from public._card_summary(usr) where account_id = cartao;
  if total_depois - total_antes <> 34000 or aberto_depois - aberto_antes <> 34000 then
    raise exception '2: total %→% e aberto %→%, esperado +34000 nos dois',
      total_antes, total_depois, aberto_antes, aberto_depois;
  end if;
  if private.invoice_open_cents(fat) <> 44000 then
    raise exception '2b: invoice_open_cents = %, esperado 44000', private.invoice_open_cents(fat);
  end if;

  -- 3. o que vence mostra a fatura com o Pix
  select amount_cents into v from public._upcoming_bills(usr, 60) where ref_id = fat;
  if v is distinct from 44000 then
    raise exception '3: upcoming_bills da fatura = %, esperado 44000', v;
  end if;

  -- 4. NÃO é gasto: o orçamento não muda (mesmo com categoria no transfer)
  select coalesce(sum(spent_cents), 0) into gasto_depois
    from private.budgets_status_for(array[ws], date_trunc('month', hoje)::date, 'civil');
  if gasto_depois <> gasto_antes then
    raise exception '4: o orçamento contou o Pix (% → %)', gasto_antes, gasto_depois;
  end if;

  -- 5. caixa: +340 no Itaú hoje (cash_total) e +340 na fatura no vencimento — UMA vez cada
  caixa_depois := private.cash_total(array[ws]);
  if caixa_depois - caixa_antes <> 34000 then
    raise exception '5: cash_total %→%, esperado +34000', caixa_antes, caixa_depois;
  end if;
  select count(*), coalesce(sum(e.in_cents), 0) into n, v
    from private.cash_events(array[ws], hoje, vence + 1) e where e.ref_id = pix;
  if n <> 1 or v <> 34000 then
    raise exception '5b: o ciclo tem % entrada(s) do Pix somando %, esperado 1 de 34000', n, v;
  end if;
  select coalesce(sum(case when e.origin = 'invoice' then e.out_cents end), 0) into v
    from private.cash_events(array[ws], hoje, vence + 1) e;
  if v - conta_antes <> 34000 then
    raise exception '5c: a saída da fatura no ciclo foi % → %, esperado +34000', conta_antes, v;
  end if;

  -- 6. a projeção fecha igual: entra 340 hoje, sai 340 no vencimento
  select balance_cents into fim_depois from public._cash_flow_forecast(usr, 90) order by day desc limit 1;
  if fim_depois <> fim_antes then
    raise exception '6: saldo no fim da projeção % → %, esperado igual', fim_antes, fim_depois;
  end if;

  raise notice 'pix_no_credito: 6 asserções OK';
end $$;

rollback;
