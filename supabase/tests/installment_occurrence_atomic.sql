-- docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/installment_occurrence_atomic.sql
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000a7e1';
  w uuid := '00000000-0000-0000-0000-00000000b7e1';
  a uuid := '00000000-0000-0000-0000-00000000c7e1';
  p uuid := '00000000-0000-0000-0000-00000000d7e1';
  card uuid := '00000000-0000-0000-0000-00000000c7e2';
  card_plan uuid := '00000000-0000-0000-0000-00000000d7e2';
begin
  insert into auth.users (id, email) values (u, 'installment-atomic@example.invalid');
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Atomic installment');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (a, w, u, 'Checking', 'checking', 0);
  insert into public.accounts
    (id, workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents)
    values (card, w, u, 'Card', 'credit_card', 3, 10, 500000);
  insert into public.installment_plans
    (id, workspace_id, user_id, account_id, description, category, total_cents, installments, first_occurred_at)
    values (p, w, u, a, 'Original plan', 'original', 30000, 3, current_date);
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, category,
     occurred_at, source, status, installment_plan_id, installment_no)
    values
      (w, u, a, 'expense', 10000, 'First', 'original', current_date, 'app', 'cleared', p, 1),
      (w, u, a, 'expense', 10000, 'Second', 'original', current_date + 30, 'app', 'pending', p, 2),
      (w, u, a, 'expense', 10000, 'Third', 'original', current_date + 60, 'app', 'pending', p, 3);
  insert into public.installment_plans
    (id, workspace_id, user_id, account_id, description, total_cents, installments, first_occurred_at)
    values (card_plan, w, u, card, 'Card plan', 20000, 2, current_date);
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description,
     occurred_at, source, status, installment_plan_id, installment_no)
    values
      (w, u, card, 'expense', 10000, 'Card first', current_date, 'app', 'pending', card_plan, 1),
      (w, u, card, 'expense', 10000, 'Card second', current_date + 30, 'app', 'pending', card_plan, 2);
  update public.card_invoices set status = 'paid', paid_at = due_date
    where id = (select invoice_id from public.transactions
                where installment_plan_id = card_plan and installment_no = 1);
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7e1', true);
set local role authenticated;

-- RED: the dedicated RPC is missing before the migration. The first edit must leave the
-- untouched installments and plan metadata intact while changing the plan sum atomically.
do $$
declare
  p uuid := '00000000-0000-0000-0000-00000000d7e1';
  anchor uuid;
  sibling uuid;
  before_revision bigint;
begin
  select id into anchor from public.transactions where installment_plan_id = p and installment_no = 2;
  perform set_config('app.test_installment_anchor', anchor::text, true);
  select id into sibling from public.transactions where installment_plan_id = p and installment_no = 3;
  perform public.update_installment_occurrence(anchor,
    jsonb_build_object('amount_cents', 12500, 'description', 'Only second',
                       'category', 'special', 'occurred_at', current_date + 31,
                       'status', 'cleared', 'due_at', null, 'auto_confirm', false));
  assert (select amount_cents from public.transactions where id = anchor) = 12500;
  assert (select description from public.transactions where id = anchor) = 'Only second';
  assert (select occurred_at from public.transactions where id = anchor) = current_date + 31;
  assert (select status from public.transactions where id = anchor) = 'cleared';
  assert (select amount_cents from public.transactions where id = sibling) = 10000;
  assert (select total_cents from public.installment_plans where id = p) = 32500;
  assert (select description from public.installment_plans where id = p) = 'Original plan';
  assert (select category from public.installment_plans where id = p) = 'original';
  select edit_revision into before_revision from public.transactions where id = anchor;
  perform public.update_installment_occurrence(anchor,
    jsonb_build_object('amount_cents', 12500, 'description', 'Only second',
                       'category', 'special', 'occurred_at', current_date + 31,
                       'status', 'cleared', 'due_at', null, 'auto_confirm', false));
  assert (select edit_revision from public.transactions where id = anchor) = before_revision,
    'same save must be idempotent';
  assert (select total_cents from public.installment_plans where id = p) = 32500;
  -- The first line is also the purchase's calendar anchor. A later whole-purchase edit
  -- derives its dates from this column, so it must follow the first occurrence only.
  select id into anchor from public.transactions where installment_plan_id = p and installment_no = 1;
  perform public.update_installment_occurrence(anchor,
    jsonb_build_object('occurred_at', current_date + 1));
  assert (select occurred_at from public.transactions where id = anchor) = current_date + 1;
  assert (select first_occurred_at from public.installment_plans where id = p) = current_date + 1;
  begin
    perform public.update_installment_occurrence(anchor,
      '{"account_id":"00000000-0000-0000-0000-00000000c7e2"}'::jsonb);
    raise exception 'one installment accepted account reassignment';
  exception when others then
    if sqlerrm not like '%Campo não permitido%' then raise; end if;
  end;
  assert (select account_id from public.transactions where id = anchor) =
    '00000000-0000-0000-0000-00000000c7e1'::uuid,
    'one installment must keep the purchase account';
end $$;

-- A protected card invoice keeps its value, date and settlement status, but changing its
-- title remains a line-only edit. The database must enforce this even if the UI is bypassed.
do $$
declare
  p uuid := '00000000-0000-0000-0000-00000000d7e2';
  anchor uuid;
begin
  select id into anchor from public.transactions where installment_plan_id = p and installment_no = 1;
  perform public.update_installment_occurrence(anchor, '{"description":"Card first corrected"}'::jsonb);
  assert (select description from public.transactions where id = anchor) = 'Card first corrected';
  begin
    perform public.update_installment_occurrence(anchor, '{"due_at":"2026-12-31"}'::jsonb);
    raise exception 'protected invoice accepted due date change';
  exception when others then
    if sqlerrm not like '%fatura%' then raise; end if;
  end;
  begin
    perform public.update_installment_occurrence(anchor, '{"amount_cents":11000}'::jsonb);
    raise exception 'protected invoice accepted amount change';
  exception when others then
    if sqlerrm not like '%fatura%' then raise; end if;
  end;
  begin
    perform public.update_installment_occurrence(anchor,
      jsonb_build_object('occurred_at', current_date + 1));
    raise exception 'protected invoice accepted date change';
  exception when others then
    if sqlerrm not like '%fatura%' then raise; end if;
  end;
  begin
    perform public.update_installment_occurrence(anchor, '{"status":"cleared"}'::jsonb);
    raise exception 'card line accepted manual settlement';
  exception when others then
    if sqlerrm not like '%fatura%' then raise; end if;
  end;
  -- Moving an open occurrence into an already paid invoice is also forbidden. The old
  -- invoice was open, so this catches a missing check on the trigger's resulting invoice.
  select id into anchor from public.transactions where installment_plan_id = p and installment_no = 2;
  begin
    perform public.update_installment_occurrence(anchor,
      jsonb_build_object('occurred_at', current_date));
    raise exception 'move into paid invoice was accepted';
  exception when others then
    if sqlerrm not like '%fatura%' then raise; end if;
  end;
  assert (select occurred_at from public.transactions where id = anchor) = current_date + 30;
  assert (select total_cents from public.installment_plans where id = p) = 20000;
end $$;

-- Simulate a plan-write failure after the line update. PL/pgSQL's caught subtransaction
-- must roll the line back as well.
reset role;
create function pg_temp.reject_installment_total() returns trigger language plpgsql as $$
begin
  raise exception 'injected plan failure';
end $$;
create trigger reject_installment_total before update of total_cents on public.installment_plans
  for each row execute function pg_temp.reject_installment_total();
set local role authenticated;

do $$
declare
  p uuid := '00000000-0000-0000-0000-00000000d7e1';
  anchor uuid;
begin
  select id into anchor from public.transactions where installment_plan_id = p and installment_no = 2;
  begin
    perform public.update_installment_occurrence(anchor,
      '{"amount_cents":15000,"description":"Must roll back"}'::jsonb);
    raise exception 'injected failure did not fire';
  exception when others then
    if sqlerrm <> 'injected plan failure' then raise; end if;
  end;
  assert (select amount_cents from public.transactions where id = anchor) = 12500;
  assert (select description from public.transactions where id = anchor) = 'Only second';
  assert (select total_cents from public.installment_plans where id = p) = 32500;
end $$;

-- RLS: a second identity cannot edit another workspace through the exposed RPC.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a7e3', true);
do $$
declare
  anchor uuid := current_setting('app.test_installment_anchor')::uuid;
begin
  begin
    perform public.update_installment_occurrence(anchor, '{"description":"Wrong workspace"}'::jsonb);
    raise exception 'other workspace edit was accepted';
  exception when others then
    if sqlerrm not like '%não encontrad%' then raise; end if;
  end;
end $$;
reset role;
do $$
begin
  assert (select description from public.transactions
          where id = current_setting('app.test_installment_anchor')::uuid) = 'Only second',
    'unauthorized call changed the line';
end $$;

rollback;
