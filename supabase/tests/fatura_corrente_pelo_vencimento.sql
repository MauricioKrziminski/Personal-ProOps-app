-- Fatura corrente = a não paga de menor vencimento a partir de hoje (`20261005220000`).
-- Cartão A fecha dia 3 e vence dia 10 do mesmo mês; B fecha no último dia e vence dia 10 do seguinte.
-- Faturas inseridas com datas relativas a hoje: o "hoje" é o do teste, sem mexer no relógio.

\set ON_ERROR_STOP on
begin;

do $$
declare
  usr uuid := '00000000-0000-0000-0000-000000000c31';
  ws uuid; ca uuid; cb uuid; a_ant uuid; a_cur uuid; b_set uuid; b_out uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r record;
begin
  insert into auth.users (id, email) values (usr, 'teste-fatura-corrente@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (usr) on conflict (id) do nothing;
  insert into public.workspaces (name, owner_id) values ('teste fatura corrente', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
    values (ws, usr, 'A', 'credit_card', 3, 10) returning id into ca;
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
    values (ws, usr, 'B', 'credit_card', 31, 10) returning id into cb;

  -- B: a que fechou ontem e vence daqui a 5 dias (mês de referência ANTERIOR ao de hoje ou igual)
  -- e a seguinte, que fecha daqui a 30 dias.
  insert into public.card_invoices (workspace_id, user_id, account_id, reference_month, closing_date, due_date, status)
    values (ws, usr, cb, date_trunc('month', hoje - 1)::date, hoje - 1, hoje + 5, 'closed') returning id into b_set;
  insert into public.card_invoices (workspace_id, user_id, account_id, reference_month, closing_date, due_date, status)
    values (ws, usr, cb, (date_trunc('month', hoje - 1) + interval '1 month')::date, hoje + 30, hoje + 36, 'open') returning id into b_out;
  -- A: a anterior (já vencida e paga) e a corrente, aberta, que vence daqui a 3 dias
  insert into public.card_invoices (workspace_id, user_id, account_id, reference_month, closing_date, due_date, status)
    values (ws, usr, ca, date_trunc('month', hoje - 40)::date, hoje - 38, hoje - 30, 'paid') returning id into a_ant;
  insert into public.card_invoices (workspace_id, user_id, account_id, reference_month, closing_date, due_date, status)
    values (ws, usr, ca, date_trunc('month', hoje)::date, hoje - 2, hoje + 3, 'closed') returning id into a_cur;

  select invoice_id into r from public._card_summary(usr) where account_id = cb;
  if r.invoice_id is distinct from b_set then raise exception '1. B deveria mostrar a que fechou e vence em 5 dias'; end if;
  select invoice_id into r from public._card_summary(usr) where account_id = ca;
  if r.invoice_id is distinct from a_cur then raise exception '2. A deveria mostrar a corrente'; end if;

  -- vencida e sem pagar: vai para atrasadas, a corrente passa a ser a seguinte
  update public.card_invoices set due_date = hoje - 1 where id = b_set;
  select * into r from public._card_summary(usr) where account_id = cb;
  if r.invoice_id is distinct from b_out then raise exception '3. vencida sem pagar: corrente deveria ser a seguinte'; end if;
  if r.overdue_count <> 1 or r.oldest_overdue_invoice_id is distinct from b_set then
    raise exception '3b. a vencida deveria estar em atrasadas';
  end if;

  -- paga: a corrente é a seguinte
  update public.card_invoices set due_date = hoje + 5, status = 'paid' where id = b_set;
  select * into r from public._card_summary(usr) where account_id = cb;
  if r.invoice_id is distinct from b_out or r.overdue_count <> 0 then raise exception '4. paga: corrente deveria ser a seguinte'; end if;

  -- a wrapper (security invoker) concorda com a interna: mesma ordem, lida no texto da função
  raise notice 'ok fatura_corrente_pelo_vencimento';
end $$;

rollback;
