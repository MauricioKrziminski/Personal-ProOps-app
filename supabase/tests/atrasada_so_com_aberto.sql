-- Fatura vencida sem nada em aberto não é atrasada (`20261010235000`): vazia (compras apagadas)
-- ou com tudo pago, ela fica fora de `overdue_count`/`overdue_total_cents`/`oldest_overdue_invoice_id`.
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/atrasada_so_com_aberto.sql

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  usr uuid := '00000000-0000-0000-0000-000000000c81';
  ws uuid; cartao uuid; fat uuid; tx uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
begin
  insert into auth.users (id, email) values (usr, 'teste-atrasada-aberto@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (usr) on conflict (id) do nothing;
  insert into public.workspaces (name, owner_id) values ('teste atrasada aberto', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
    values (ws, usr, 'Cartao', 'credit_card', 3, 10) returning id into cartao;
  insert into public.card_invoices (workspace_id, user_id, account_id, reference_month, closing_date, due_date, status)
    values (ws, usr, cartao, date_trunc('month', hoje - 40)::date, hoje - 38, hoje - 30, 'closed') returning id into fat;

  select * into r from public._card_summary(usr) where account_id = cartao;
  if r.overdue_count <> 0 or r.overdue_total_cents <> 0 or r.oldest_overdue_invoice_id is not null then
    raise exception '1. vencida e vazia não é atrasada: %', r;
  end if;

  -- com uma compra em aberto ela passa a ser atrasada
  insert into public.transactions (workspace_id, user_id, account_id, kind, amount_cents, category, description, occurred_at, status)
    values (ws, usr, cartao, 'expense', 7000, 'outros', 'Compra', hoje - 40, 'pending') returning id into tx;
  update public.transactions set invoice_id = fat where id = tx;
  select * into r from public._card_summary(usr) where account_id = cartao;
  if r.overdue_count <> 1 or r.overdue_total_cents <> 7000 or r.oldest_overdue_invoice_id is distinct from fat then
    raise exception '2. vencida com aberto é atrasada: %', r;
  end if;

  -- tudo pago (sem quitar o status): nada em aberto, deixa de ser atrasada
  update public.card_invoices set paid_cents = 7000 where id = fat;
  select * into r from public._card_summary(usr) where account_id = cartao;
  if r.overdue_count <> 0 or r.overdue_total_cents <> 0 then raise exception '3. nada em aberto: %', r; end if;

  raise notice 'ok atrasada_so_com_aberto';
end $$;

rollback;
