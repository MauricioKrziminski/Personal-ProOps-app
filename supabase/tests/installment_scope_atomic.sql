-- Local only: docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/installment_scope_atomic.sql
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000a8e1';
  w uuid := '00000000-0000-0000-0000-00000000b8e1';
  a uuid := '00000000-0000-0000-0000-00000000c8e1';
  card uuid := '00000000-0000-0000-0000-00000000c8e2';
  p uuid := '00000000-0000-0000-0000-00000000d8e1';
  card_plan uuid := '00000000-0000-0000-0000-00000000d8e2';
begin
  insert into auth.users (id, email) values (u, 'installment-scope@example.invalid');
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Scoped installments');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (a, w, u, 'Checking', 'checking', 0);
  insert into public.accounts
    (id, workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents)
    values (card, w, u, 'Card', 'credit_card', 3, 10, 500000);
  insert into public.installment_plans
    (id, workspace_id, user_id, account_id, description, total_cents, installments, first_occurred_at)
    values (p, w, u, a, 'Original', 40000, 4, '2026-01-15');
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description,
     occurred_at, source, status, installment_plan_id, installment_no)
    values
      (w,u,a,'expense',10000,'Original (1/4)','2026-01-15','app','cleared',p,1),
      (w,u,a,'expense',10000,'Original (2/4)','2026-02-15','app','pending',p,2),
      (w,u,a,'expense',10000,'Original (3/4)','2026-03-15','app','pending',p,3),
      (w,u,a,'expense',10000,'Original (4/4)','2026-04-15','app','pending',p,4);
  insert into public.installment_plans
    (id, workspace_id, user_id, account_id, description, total_cents, installments, first_occurred_at)
    values (card_plan, w, u, card, 'Card', 30000, 3, '2026-01-15');
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description,
     occurred_at, source, status, installment_plan_id, installment_no)
    values
      (w,u,card,'expense',10000,'Card (1/3)','2026-01-15','app','pending',card_plan,1),
      (w,u,card,'expense',10000,'Card (2/3)','2026-02-15','app','pending',card_plan,2),
      (w,u,card,'expense',10000,'Card (3/3)','2026-03-15','app','pending',card_plan,3);
  update public.card_invoices i set status = 'paid', paid_at = due_date
    where i.id = (select invoice_id from public.transactions
                   where installment_plan_id = card_plan and installment_no = 1);
  update public.card_invoices i set status = 'rolled'
    where i.id = (select invoice_id from public.transactions
                   where installment_plan_id = card_plan and installment_no = 2);
  update public.card_invoices i set paid_cents = 100
    where i.id = (select invoice_id from public.transactions
                   where installment_plan_id = card_plan and installment_no = 3);
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a8e1', true);
set local role authenticated;

-- RED before migration: function is missing. Future starts at installment_no, not the date.
do $$
declare
  p uuid := '00000000-0000-0000-0000-00000000d8e1';
  anchor uuid;
  rev bigint;
begin
  select id into anchor from public.transactions where installment_plan_id = p and installment_no = 2;
  assert public.update_installment_scope(anchor, 'future',
    '{"amount_cents":12000,"description":"Revised","occurred_at":"2026-02-20"}'::jsonb) = 3;
  assert (select array_agg(amount_cents order by installment_no) from public.transactions
          where installment_plan_id = p) = array[10000,12000,12000,12000]::bigint[];
  assert (select array_agg(occurred_at order by installment_no) from public.transactions
          where installment_plan_id = p) = array['2026-01-15','2026-02-20','2026-03-20','2026-04-20']::date[];
  assert (select array_agg(description order by installment_no) from public.transactions
          where installment_plan_id = p) = array['Original (1/4)','Revised (2/4)','Revised (3/4)','Revised (4/4)'];
  assert (select total_cents from public.installment_plans where id = p) = 46000;
  select edit_revision into rev from public.transactions where id = anchor;
  assert public.update_installment_scope(anchor, 'future',
    '{"amount_cents":12000,"description":"Revised","occurred_at":"2026-02-20"}'::jsonb) = 0;
  assert (select edit_revision from public.transactions where id = anchor) = rev;

  -- The requested total is distributed over the selected suffix; the closed prefix stays exact.
  assert public.update_installment_scope(anchor, 'future', '{"total_cents":50001}'::jsonb) = 3;
  assert (select array_agg(amount_cents order by installment_no) from public.transactions
          where installment_plan_id = p) = array[10000,13333,13333,13335]::bigint[];
  assert (select total_cents from public.installment_plans where id = p) = 50001;

  -- All really includes the paid past outside a credit card; keep its cleared status.
  assert public.update_installment_scope(anchor, 'all', '{"amount_cents":9000}'::jsonb) = 4;
  assert (select array_agg(amount_cents order by installment_no) from public.transactions
          where installment_plan_id = p) = array[9000,9000,9000,9000]::bigint[];
  assert (select total_cents from public.installment_plans where id = p) = 36000;
  assert (select status from public.transactions where installment_plan_id = p and installment_no = 1) = 'cleared';
  assert public.update_installment_scope(anchor, 'all', '{"total_cents":8000}'::jsonb) = 4;
  assert (select array_agg(amount_cents order by installment_no) from public.transactions
          where installment_plan_id = p) = array[2000,2000,2000,2000]::bigint[];
  assert (select total_cents from public.installment_plans where id = p) = 8000;
  assert (select status from public.transactions where installment_plan_id = p and installment_no = 1) = 'cleared';
  begin
    perform public.update_installment_scope(anchor, 'all', '{"status":"pending"}'::jsonb);
    raise exception 'all reopened an already paid installment';
  exception when others then
    if sqlerrm not like '%paga%' then raise; end if;
  end;
  assert (select status from public.transactions where installment_plan_id = p and installment_no = 1) = 'cleared';

  -- Nonfinancial corrections can cover past, including the plan title.
  assert public.update_installment_scope(anchor, 'all', '{"description":"Every month"}'::jsonb) = 4;
  assert (select description from public.transactions where installment_plan_id = p and installment_no = 1) = 'Every month (1/4)';
  assert (select description from public.installment_plans where id = p) = 'Every month';
  assert public.update_installment_scope(anchor, 'one', '{"description":"Just second"}'::jsonb) = 1;
  assert (select description from public.transactions where installment_plan_id = p and installment_no = 3) = 'Every month (3/4)';
end $$;

-- Failure on the last selected line rolls the earlier line and plan-total writes back.
reset role;
create function pg_temp.reject_fourth_installment() returns trigger language plpgsql as $$
begin
  if new.installment_no = 4 and new.amount_cents = 15000 then
    raise exception 'injected fourth-line failure';
  end if;
  return new;
end $$;
create trigger reject_fourth_installment before update of amount_cents on public.transactions
  for each row execute function pg_temp.reject_fourth_installment();
set local role authenticated;
do $$
declare
  p uuid := '00000000-0000-0000-0000-00000000d8e1';
  anchor uuid;
begin
  select id into anchor from public.transactions where installment_plan_id = p and installment_no = 2;
  begin
    perform public.update_installment_scope(anchor, 'future', '{"amount_cents":15000}'::jsonb);
    raise exception 'injected failure did not fire';
  exception when others then
    if sqlerrm <> 'injected fourth-line failure' then raise; end if;
  end;
  assert (select array_agg(amount_cents order by installment_no) from public.transactions
          where installment_plan_id = p) = array[2000,2000,2000,2000]::bigint[];
  assert (select total_cents from public.installment_plans where id = p) = 8000;
end $$;

-- A paid, rolled, or partly paid card invoice accepts a corrected AMOUNT (20260928235000, the
-- invoice follows through `valor_corrigido_na_fatura`), but its date stays put.
do $$
declare
  p uuid := '00000000-0000-0000-0000-00000000d8e2';
  n integer;
  anchor uuid;
begin
  select id into anchor from public.transactions where installment_plan_id = p and installment_no = 1;
  perform public.update_installment_scope(anchor, 'all', '{"amount_cents":11000}'::jsonb);
  assert (select array_agg(amount_cents order by installment_no) from public.transactions
          where installment_plan_id = p) = array[11000,11000,11000]::bigint[];
  assert (select total_cents from public.installment_plans where id = p) = 33000;
  for n in 1..3 loop
    select id into anchor from public.transactions where installment_plan_id = p and installment_no = n;
    begin
      perform public.update_installment_scope(anchor, 'one', '{"occurred_at":"2026-01-20"}'::jsonb);
      raise exception 'protected card installment % moved date', n;
    exception when others then
      if sqlerrm not like '%fatura%' then raise; end if;
    end;
  end loop;
end $$;

-- RLS: other workspace cannot reach this plan through the RPC.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a8e2', true);
do $$
declare anchor uuid;
begin
  select id into anchor from public.transactions where installment_plan_id = '00000000-0000-0000-0000-00000000d8e1' and installment_no = 2;
  begin
    perform public.update_installment_scope(anchor, 'all', '{"description":"Intrusion"}'::jsonb);
    raise exception 'cross-workspace edit succeeded';
  exception when others then
    if sqlerrm not like '%não encontrad%' then raise; end if;
  end;
end $$;
rollback;
