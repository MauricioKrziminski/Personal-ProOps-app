-- Run only against a disposable local database with migrations applied. Fixture rolls back.
\set ON_ERROR_STOP on
begin;

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000c8a1';
  w uuid := '00000000-0000-0000-0000-00000000c8b1';
  d uuid := '00000000-0000-0000-0000-00000000c8d1';
  revision bigint;
  req uuid := gen_random_uuid();
  reply jsonb;
begin
  insert into auth.users(id,email) values (u,'debt-historical-dates@example.invalid');
  insert into public.profiles(id) values (u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Historical dates');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner');
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,
    principal_cents,remaining_cents,interest_rate_monthly,installments,installments_paid,
    installment_cents,due_day,first_due_date)
  values (d,w,u,'Carro','financing','fixed_installments',40000,20000,0,4,2,
    10000,-1,date '2026-08-31');
  assert (select array_agg(due_date order by installment_no)
    from public.debt_declared_due_dates where debt_id=d)
    = array[date '2026-08-31',date '2026-09-30'],
    'creation snapshots declared dates with last-day semantics';
  assert not exists(select 1 from public.transactions where debt_id=d),
    'date snapshots are not invented payments';
  assert not exists(select 1 from public.debt_declared_estimates where debt_id=d),
    'date snapshots leave sparse amount overrides alone';

  perform set_config('request.jwt.claim.sub',u::text,true);
  select edit_revision into revision from public.debts where id=d;
  reply := public.update_debt_contract_scoped(d,3,'future',
    '{"installment_cents":12000,"due_day":30,"first_due_date":"2026-08-30"}'::jsonb,
    revision,'{}'::jsonb,req);
  assert (select array_agg(due_date order by installment_no)
    from public.debt_declared_due_dates where debt_id=d)
    = array[date '2026-08-31',date '2026-09-30'],
    'future scope preserves the two older dates';
  assert (select due_date from public.debt_schedule(d) where installment_no=3)
    = date '2026-10-30', 'future scope moves the first upcoming installment';
  assert public.update_debt_contract_scoped(d,3,'future',
    '{"installment_cents":12000,"due_day":30,"first_due_date":"2026-08-30"}'::jsonb,
    revision,'{}'::jsonb,req)=reply, 'retry is idempotent';

  select edit_revision into revision from public.debts where id=d;
  perform public.update_debt_contract_scoped(d,3,'all',
    '{"installment_cents":13000,"name":"Carro novo"}'::jsonb,
    revision,'{}'::jsonb,gen_random_uuid());
  assert (select array_agg(due_date order by installment_no)
    from public.debt_declared_due_dates where debt_id=d)
    = array[date '2026-08-31',date '2026-09-30'],
    'all without a date patch leaves historical dates untouched';

  select edit_revision into revision from public.debts where id=d;
  perform public.update_debt_contract_scoped(d,3,'all',
    '{"due_day":31,"first_due_date":"2026-08-31"}'::jsonb,
    revision,'{}'::jsonb,gen_random_uuid());
  assert (select array_agg(due_date order by installment_no)
    from public.debt_declared_due_dates where debt_id=d)
    = array[date '2026-08-31',date '2026-09-30'],
    'fixed day 31 clamps in September';
  assert (select due_date from public.debt_schedule(d) where installment_no=3)
    = date '2026-10-31', 'fixed day 31 resumes in October';

  select edit_revision into revision from public.debts where id=d;
  perform public.update_debt_contract_scoped(d,3,'all',
    '{"due_day":30,"first_due_date":"2026-08-30"}'::jsonb,
    revision,'{}'::jsonb,gen_random_uuid());
  assert (select array_agg(due_date order by installment_no)
    from public.debt_declared_due_dates where debt_id=d)
    = array[date '2026-08-30',date '2026-09-30'],
    'all with date fields intentionally recalculates declared history';
  assert (select due_date from public.debt_schedule(d) where installment_no=3)
    = date '2026-10-30', 'first future installment follows date patch';
end $$;

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000c8a1';
  w uuid := '00000000-0000-0000-0000-00000000c8b1';
  d uuid;
  day_rule int;
  expected date[];
begin
  for day_rule in select unnest(array[30,31,-1]) loop
    d := gen_random_uuid();
    insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,
      principal_cents,remaining_cents,interest_rate_monthly,installments,installments_paid,
      installment_cents,due_day,first_due_date)
    values (d,w,u,'Month end ' || day_rule::text,'financing','fixed_installments',
      30000,10000,0,3,2,10000,day_rule,date '2027-01-31');
    expected := case when day_rule=30
      then array[date '2027-01-30',date '2027-02-28']
      else array[date '2027-01-31',date '2027-02-28'] end;
    assert (select array_agg(due_date order by installment_no)
      from public.debt_declared_due_dates where debt_id=d)=expected,
      'historical dates clamp fixed 30/31 and explicit last day';
    assert (select due_date from public.debt_schedule(d) where installment_no=3)
      = case when day_rule=30 then date '2027-03-30' else date '2027-03-31' end,
      'first future date resumes the chosen day in March';
  end loop;
end $$;

set local role authenticated;
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000c8a1';
  w uuid := '00000000-0000-0000-0000-00000000c8b1';
  d uuid := '00000000-0000-0000-0000-00000000c8d2';
  revision bigint;
begin
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,
    principal_cents,remaining_cents,interest_rate_monthly,installments,installments_paid,
    installment_cents,due_day,first_due_date)
  values (d,w,u,'One and payment','financing','fixed_installments',30000,30000,0,3,0,
    10000,-1,date '2026-10-31');
  select edit_revision into revision from public.debts where id=d;
  perform public.update_debt_contract_scoped(d,1,'one',
    '{"due_date":"2026-10-30"}'::jsonb,revision,'{}'::jsonb,gen_random_uuid());
  assert (select due_date from public.debt_schedule(d) where installment_no=1)
    = date '2026-10-30';
  perform public.pay_debt_installment(d,10000,null,date '2026-10-29');
  assert (select due_date from public.debt_declared_due_dates
    where debt_id=d and installment_no=1)=date '2026-10-30',
    'payment advancement snapshots the one-parcel projected due date';
  assert (select occurred_at from public.transactions
    where debt_id=d and debt_payment_no=1)=date '2026-10-29',
    'registered payment retains its own real date';
end $$;
reset role;

set local role authenticated;
do $$
declare
  d uuid := '00000000-0000-0000-0000-00000000c8d1';
  revision bigint;
begin
  select edit_revision into revision from public.debts where id=d;
  perform public.update_debt_contract_scoped(d,3,'all',
    '{"due_day":31,"first_due_date":"2026-08-31"}'::jsonb,
    revision,'{}'::jsonb,gen_random_uuid());
  assert (select due_date from public.debt_declared_due_dates
    where debt_id=d and installment_no=1)=date '2026-08-31',
    'authenticated owner can recalculate historical dates via All under RLS';
end $$;
reset role;

rollback;
