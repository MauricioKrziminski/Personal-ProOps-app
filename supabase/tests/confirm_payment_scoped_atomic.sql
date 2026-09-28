-- docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/confirm_payment_scoped_atomic.sql
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000a8f1';
  w uuid := '00000000-0000-0000-0000-00000000b8f1';
  a uuid := '00000000-0000-0000-0000-00000000c8f1';
  card uuid := '00000000-0000-0000-0000-00000000c8f2';
  p uuid := '00000000-0000-0000-0000-00000000d8f1';
begin
  insert into auth.users (id, email) values (u, 'confirm-payment-atomic@example.invalid');
  insert into public.profiles (id) values (u) on conflict (id) do nothing;
  insert into public.workspaces (id, owner_id, name) values (w, u, 'Confirm payment atomic');
  insert into public.workspace_members (workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.accounts (id, workspace_id, user_id, name, type, initial_balance_cents)
    values (a, w, u, 'Checking', 'checking', 0);
  insert into public.accounts
    (id, workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents)
    values (card, w, u, 'Card', 'credit_card', 3, 10, 500000);
  insert into public.installment_plans
    (id, workspace_id, user_id, account_id, description, total_cents, installments, first_occurred_at)
    values (p, w, u, a, 'Plan', 50000, 5, current_date - 30);
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description,
     occurred_at, source, status, installment_plan_id, installment_no)
    values
      (w, u, a, 'expense', 10000, 'Past', current_date - 30, 'app', 'pending', p, 1),
      (w, u, a, 'expense', 10000, 'Anchor', current_date, 'app', 'pending', p, 2),
      (w, u, a, 'expense', 10000, 'Next', current_date + 30, 'app', 'pending', p, 3),
      (w, u, a, 'expense', 10000, 'Future', current_date + 60, 'app', 'pending', p, 4),
      (w, u, a, 'expense', 10000, 'Already paid', current_date + 90, 'app', 'cleared', p, 5);
  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, description, occurred_at, source, status)
    values (w, u, card, 'expense', 7000, 'Card charge', current_date, 'app', 'pending');
  update public.card_invoices set status = 'paid', paid_at = due_date
    where id = (select invoice_id from public.transactions where description = 'Card charge'
                and workspace_id = w);
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a8f1', true);
set local role authenticated;

-- A card charge in a settled invoice cannot be corrected or individually settled.
do $$
declare
  w uuid := '00000000-0000-0000-0000-00000000b8f1';
  charge uuid;
begin
  select id into charge from public.transactions
    where workspace_id = w and description = 'Card charge';
  begin
    perform public.confirm_payment_scoped(charge, current_date, 8000, 'one');
    raise exception 'protected card invoice accepted correction';
  exception when others then
    if sqlerrm not like '%fatura%' then raise; end if;
  end;
  assert (select amount_cents = 7000 and status = 'pending'
          from public.transactions where id = charge);
end $$;

do $$
declare
  p uuid := '00000000-0000-0000-0000-00000000d8f1';
  anchor uuid;
  changed bigint;
begin
  select id into anchor from public.transactions where installment_plan_id = p and installment_no = 2;
  perform set_config('app.test_payment_anchor', anchor::text, true);
  changed := public.confirm_payment_scoped(anchor, current_date, 12500, 'one');
  assert changed = 1, 'one confirmation must update one line';
  assert (select status = 'cleared' and amount_cents = 12500 and paid_at = current_date
          from public.transactions where id = anchor), 'anchor must be corrected and paid';
  assert (select amount_cents from public.transactions where installment_plan_id = p and installment_no = 3) = 10000;
  assert (select total_cents from public.installment_plans where id = p) = 52500;
  changed := public.confirm_payment_scoped(anchor, current_date, 12500, 'one');
  assert changed = 0, 'same confirmation must be idempotent';
  begin
    perform public.confirm_payment_scoped(anchor, current_date, 13000, 'one');
    raise exception 'different replay was accepted';
  exception when others then
    if sqlerrm not like '%já%' then raise; end if;
  end;
  assert (select total_cents from public.installment_plans where id = p) = 52500;
end $$;

do $$
declare
  p uuid := '00000000-0000-0000-0000-00000000d8f1';
  anchor uuid;
  changed bigint;
begin
  select id into anchor from public.transactions where installment_plan_id = p and installment_no = 3;
  changed := public.confirm_payment_scoped(anchor, current_date + 1, 15000, 'future');
  assert changed = 2, 'future scope must correct anchor and next pending installment';
  assert (select status = 'cleared' and amount_cents = 15000 and paid_at = current_date + 1
          from public.transactions where id = anchor);
  assert (select amount_cents from public.transactions where installment_plan_id = p and installment_no = 1) = 10000;
  assert (select status = 'pending' and amount_cents = 15000
          from public.transactions where installment_plan_id = p and installment_no = 4),
    'future amount changes but only the anchor is paid';
  assert (select amount_cents from public.transactions where installment_plan_id = p and installment_no = 5) = 10000;
  assert (select total_cents from public.installment_plans where id = p) = 62500;
end $$;

-- A second write failing must roll back both the correction and plan total.
reset role;
create function pg_temp.reject_payment_status() returns trigger language plpgsql as $$
begin
  raise exception 'injected payment failure';
end $$;
create trigger reject_payment_status before update of status on public.transactions
  for each row execute function pg_temp.reject_payment_status();
set local role authenticated;

do $$
declare
  p uuid := '00000000-0000-0000-0000-00000000d8f1';
  anchor uuid;
begin
  select id into anchor from public.transactions where installment_plan_id = p and installment_no = 1;
  begin
    perform public.confirm_payment_scoped(anchor, current_date, 16000, 'future');
    raise exception 'injected failure did not fire';
  exception when others then
    if sqlerrm <> 'injected payment failure' then raise; end if;
  end;
  assert (select amount_cents = 10000 and status = 'pending' and paid_at is null
          from public.transactions where id = anchor), 'failed payment persisted correction';
  assert (select amount_cents = 15000 and status = 'pending'
          from public.transactions where installment_plan_id = p and installment_no = 4),
    'failed payment persisted future correction';
  assert (select total_cents from public.installment_plans where id = p) = 62500,
    'failed payment persisted plan correction';
end $$;

-- The invoker must see only its own workspace under RLS.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a8f2', true);
do $$
begin
  begin
    perform public.confirm_payment_scoped(current_setting('app.test_payment_anchor')::uuid,
                                          current_date, 12500, 'one');
    raise exception 'other user confirmed the payment';
  exception when others then
    if sqlerrm not like '%não encontrad%' then raise; end if;
  end;
end $$;

reset role;
rollback;
