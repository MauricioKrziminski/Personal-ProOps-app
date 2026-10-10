-- "Ainda vai entrar" na fatura (`20261010233000`): `private.invoice_future_cents` é a parte do total
-- da fatura com data DEPOIS de hoje (dia do Brasil), e o total continua sendo a soma de tudo.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/fatura_ainda_vai_entrar.sql
--   (ou) agent/.venv/bin/python scripts/sql-test.py supabase/tests/fatura_ainda_vai_entrar.sql
--
-- O que prende: só a linha futura conta (hoje e passado não), o total segue somando tudo, fatura
-- sem futura dá 0, o `card_summary` e o `upcoming_bills` leem a MESMA função, e as linhas que não
-- são fatura (boleto avulso) vêm com `future_cents` nulo.

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  usr uuid := '00000000-0000-0000-0000-000000000c77';
  ws uuid; conta uuid; cartao uuid; cartao2 uuid;
  fat uuid; fat2 uuid; boleto uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record; v bigint;
begin
  insert into auth.users (id, email) values (usr, 'teste-ainda-vai-entrar@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (usr) on conflict (id) do nothing;
  insert into public.workspaces (name, owner_id) values ('teste ainda vai entrar', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');

  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Conta', 'checking', 500000) returning id into conta;
  -- fecha 5 dias à frente: ontem, hoje e amanhã caem na MESMA fatura, qualquer que seja o dia do mês
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day, payment_account_id)
    values (ws, usr, 'Cartao', 'credit_card', extract(day from hoje + 5)::int, 10, conta) returning id into cartao;
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day, payment_account_id)
    values (ws, usr, 'Cartao2', 'credit_card', extract(day from hoje + 5)::int, 10, conta) returning id into cartao2;

  insert into public.transactions (workspace_id, user_id, account_id, kind, amount_cents, category, description, occurred_at, status)
    values (ws, usr, cartao, 'expense', 10000, 'outros', 'Passada', hoje - 1, 'pending'),
           (ws, usr, cartao, 'expense', 5000,  'outros', 'De hoje',  hoje,     'pending'),
           (ws, usr, cartao, 'expense', 3000,  'outros', 'Futura',   hoje + 1, 'pending'),
           (ws, usr, cartao2, 'expense', 7000, 'outros', 'So passada', hoje - 1, 'pending');
  select invoice_id into fat  from public.transactions where workspace_id = ws and description = 'Futura';
  select invoice_id into fat2 from public.transactions where workspace_id = ws and description = 'So passada';
  assert fat is not null and fat2 is not null, 'as compras entram em fatura';
  assert (select count(distinct invoice_id) from public.transactions where account_id = cartao) = 1,
    'passada, hoje e futura caem na mesma fatura';

  -- um boleto avulso (sem fatura), para o `future_cents` nulo
  insert into public.transactions (workspace_id, user_id, account_id, kind, amount_cents, category, description, occurred_at, due_at, status)
    values (ws, usr, conta, 'expense', 900, 'outros', 'Boleto', hoje + 2, hoje + 2, 'pending') returning id into boleto;

  -- 1. só a linha de depois de hoje
  v := private.invoice_future_cents(fat);
  assert v = 3000, format('1: ainda vai entrar deveria ser 3000, é %s', v);

  -- 2. o total continua a soma de TUDO
  select * into r from public._card_summary(usr) where account_id = cartao;
  assert r.invoice_total_cents = 18000, format('2: total deveria ser 18000, é %s', r.invoice_total_cents);
  assert r.invoice_open_cents = 18000, format('2: aberto deveria ser 18000, é %s', r.invoice_open_cents);
  assert r.invoice_future_cents = 3000, format('2: card_summary deveria dizer 3000, diz %s', r.invoice_future_cents);

  -- 3. fatura sem linha futura: zero (nunca nulo)
  select * into r from public._card_summary(usr) where account_id = cartao2;
  assert r.invoice_future_cents = 0, format('3: sem futura deveria ser 0, é %s', r.invoice_future_cents);
  assert private.invoice_future_cents(fat2) = 0, '3: a função dá 0';
  assert private.invoice_future_cents(null) = 0, '3: sem fatura dá 0';

  -- 4. "O que vence": a fatura leva o futuro; o boleto, nulo
  select * into r from public._upcoming_bills(usr, 60) where kind = 'invoice' and ref_id = fat;
  assert r.amount_cents = 18000 and r.future_cents = 3000,
    format('4: upcoming_bills fatura %s / %s, esperado 18000 / 3000', r.amount_cents, r.future_cents);
  assert r.total_cents = 18000, format('4: total bruto %s, esperado 18000', r.total_cents);
  select * into r from public._upcoming_bills(usr, 60) where ref_id = boleto;
  assert r.total_cents is null and r.future_cents is null, '4: o boleto avulso não tem "ainda vai entrar"';

  -- 5. pagamento parcial não mexe no futuro: ele é do total, não do aberto
  update public.card_invoices set paid_cents = 4000 where id = fat;
  select * into r from public._card_summary(usr) where account_id = cartao;
  assert r.invoice_open_cents = 14000 and r.invoice_future_cents = 3000,
    format('5: aberto %s / futuro %s, esperado 14000 / 3000', r.invoice_open_cents, r.invoice_future_cents);
  select * into r from public._upcoming_bills(usr, 60) where kind = 'invoice' and ref_id = fat;
  assert r.amount_cents = 14000 and r.total_cents = 18000,
    format('5: upcoming_bills aberto %s / total %s, esperado 14000 / 18000', r.amount_cents, r.total_cents);

  raise notice 'fatura_ainda_vai_entrar: 5 grupos de asserções OK';
end $$;

rollback;
