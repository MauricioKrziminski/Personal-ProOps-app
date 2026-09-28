-- Unrecorded dates are visible in the bounded ledger read, not inserted into transactions.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000c9a1';
  stranger uuid := '00000000-0000-0000-0000-00000000c9a2';
  w uuid := '00000000-0000-0000-0000-00000000c9b1';
  series_id uuid := '00000000-0000-0000-0000-00000000c9c1';
  debt_ref uuid := '00000000-0000-0000-0000-00000000c9d1';
  base date := date_trunc('month',current_date)::date;
  recurring_due date := private.add_months(base,1) + 7;
  recurring_next date := private.add_months(base,2) + 7;
  history_due date := private.day_in_month(private.add_months(base,-2),30);
  scheduled_due date;
  count_rows int;
begin
  insert into auth.users(id,email) values
    (u,'ledger-expected-owner@example.invalid'),
    (stranger,'ledger-expected-stranger@example.invalid') on conflict(id) do nothing;
  insert into public.profiles(id) values (u),(stranger) on conflict(id) do nothing;
  insert into public.workspaces(id,owner_id,name) values(w,u,'Expected ledger');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  insert into public.recurring_transactions
    (id,workspace_id,user_id,kind,amount_cents,description,rrule,dtstart,next_run_at)
  values(series_id,w,u,'expense',5590,'Assinatura de streaming',
    'FREQ=MONTHLY;BYMONTHDAY=8',recurring_due,recurring_due);
  insert into public.transactions
    (workspace_id,user_id,kind,amount_cents,description,occurred_at,source,status,recurring_id)
  values(w,u,'expense',5590,'Assinatura de streaming',recurring_due,'recurring','pending',series_id);
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,
    principal_cents,remaining_cents,interest_rate_monthly,installments,installments_paid,
    installment_cents,due_day,first_due_date)
  values(debt_ref,w,u,'Carro','financing','fixed_installments',40000,20000,0,4,2,
    10000,30,history_due);
  select min(due_date) into scheduled_due from public.debt_schedule(debt_ref);
  assert scheduled_due is not null;

  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);
  assert not exists (
    select 1 from public.ledger_expected_lines(recurring_due,recurring_due,series_id)
    where origin='recurring'), 'recorded recurrence must not be duplicated';
  assert (select count(*) from public.ledger_expected_lines(recurring_next,recurring_next,series_id)
    where origin='recurring' and ref_id=series_id and amount_cents=5590)=1,
    'next unmaterialized recurrence must be visible in Ver ocorrências';
  assert (select count(*) from public.ledger_expected_lines(scheduled_due,scheduled_due)
    where origin='debt_schedule' and ref_id=debt_ref and amount_cents=10000)=1,
    'future debt installment must appear without a transaction';
  assert (select count(*) from public.ledger_expected_lines(history_due,history_due)
    where origin='debt_estimate' and ref_id=debt_ref and installment_no=1)=1,
    'previous declared installment must appear as an estimate';
  assert (select count(*) from public.transactions t where t.debt_id=debt_ref)=0,
    'the read must never create a payment';
  assert not exists (
    select 1 from public.ledger_expected_lines(history_due,history_due,series_id)
    where origin like 'debt%'), 'a recurring filter must not include debt';
  begin
    perform 1 from public.ledger_expected_lines(base,base+62);
    raise exception 'unbounded period accepted';
  exception when others then
    if sqlerrm='unbounded period accepted' then raise; end if;
    assert sqlerrm like '%62 dias%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub',stranger::text,true);
  select count(*) into count_rows from public.ledger_expected_lines(history_due,history_due);
  assert count_rows=0, 'workspace isolation must apply to all projected origins';
end $$;
rollback;
