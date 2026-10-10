-- `transactions_summary.realizado_*` é a régua da DATA da lista de Lançamentos (chip "Aconteceu",
-- `filtroDoEstado('cleared')`): efetivado OU compra com fatura e data até hoje. Prende o caso que
-- o `status` erra: a compra de cartão de ontem (pending, na fatura aberta) já aconteceu, e a
-- atrasada pending sem fatura continua prevista.
-- Roda como `authenticated`.
--
--     agent/.venv/bin/python scripts/sql-test.py supabase/tests/tx_summary_realizado.sql
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000e5a1';
  w uuid := '00000000-0000-0000-0000-00000000e5b1';
  card uuid := '00000000-0000-0000-0000-00000000e5c1';
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
  via_lista bigint;
begin
  insert into auth.users(id,email) values (u,'tx-summary-realizado@example.invalid') on conflict(id) do nothing;
  insert into public.profiles(id) values (u) on conflict(id) do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Realizado');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type,closing_day,due_day)
    values (card,w,u,'Cartão','credit_card',28,10);

  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,occurred_at,source,status,account_id) values
    (w,u,'expense',1000,'pago',hoje - 5,'app','cleared',null),
    (w,u,'expense', 500,'atrasada sem fatura',hoje - 5,'app','pending',null),
    (w,u,'expense', 300,'futura',hoje + 5,'app','pending',null),
    (w,u,'expense', 700,'cartão de ontem',hoje - 1,'app','pending',card),
    (w,u,'expense', 900,'cartão futuro',hoje + 3,'app','pending',card),
    (w,u,'income', 4000,'salário',hoje - 2,'app','cleared',null),
    (w,u,'income',  200,'a receber',hoje + 4,'app','pending',null);
  -- cartão futuro nascido cleared (o que o app grava): pela data, é previsto
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,occurred_at,source,status,account_id)
    values (w,u,'expense',1100,'cartão futuro cleared',hoje + 2,'app','cleared',card);

  assert (select count(*) from public.transactions where workspace_id = w and invoice_id is not null) = 3,
    'as três compras de cartão caíram numa fatura (senão o teste não prova nada)';

  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);

  select sum(total_cents) filter (where kind='expense') as t, sum(realizado_cents) filter (where kind='expense') as re,
         sum(realizado_count) filter (where kind='expense') as rc, sum(pending_cents) filter (where kind='expense') as p,
         sum(realizado_cents) filter (where kind='income') as ri, sum(realizado_count) filter (where kind='income') as rci
    into r from public.transactions_summary(hoje - 10, hoje + 10);

  assert r.t = 4500, format('total de gasto %s', r.t);
  assert r.re = 1700 and r.rc = 2, format('realizado: pago 1000 + cartão de ontem 700 (veio %s em %s linhas)', r.re, r.rc);
  assert r.p = 2400, format('por status o cartão de ontem seria previsto (veio %s)', r.p);
  assert r.ri = 4000 and r.rci = 1, format('entrada realizada %s em %s', r.ri, r.rci);

  -- a soma bate com as linhas que a lista mostra em "Aconteceu" (mesmo predicado da consulta do app)
  select coalesce(sum(amount_cents),0) into via_lista from public.transactions
   where kind = 'expense' and occurred_at between hoje - 10 and hoje + 10
     and case when invoice_id is not null then occurred_at <= hoje else status = 'cleared' end;
  assert via_lista = r.re, format('lista %s vs realizado %s', via_lista, r.re);

  -- sem permissão para anon
  perform set_config('role','postgres',true);
  assert not has_function_privilege('anon','public.transactions_summary(date,date)','execute'), 'anon não executa';
  assert has_function_privilege('authenticated','public.transactions_summary(date,date)','execute');
end $$;
rollback;
