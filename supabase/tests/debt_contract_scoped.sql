-- Run in a local disposable database after the migration. The whole fixture rolls back.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000b9a1';
  w uuid := '00000000-0000-0000-0000-00000000b9b1';
  d uuid := '00000000-0000-0000-0000-00000000b9d1';
  v bigint;
  r jsonb;
  req uuid := gen_random_uuid();
begin
  insert into auth.users(id,email) values (u,'debt-contract-scopes@example.invalid');
  insert into public.profiles(id) values (u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Contract scopes');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner');
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,
    principal_cents,remaining_cents,interest_rate_monthly,installments,installments_paid,
    installment_cents,due_day,first_due_date)
  values (d,w,u,'Carro','financing','fixed_installments',40000,40000,0,4,0,
    10000,4,'2026-10-04');
  perform set_config('request.jwt.claim.sub',u::text,true);
  select edit_revision into v from public.debts where id=d;
  r := public.update_debt_contract_scoped(d,1,'one',
    '{"installment_cents":11000,"due_date":"2026-10-31"}'::jsonb,v,'{}'::jsonb,req);
  assert r->>'scope'='one';
  assert (select payment_cents from public.debt_schedule(d) where installment_no=1)=11000;
  assert (select due_date from public.debt_schedule(d) where installment_no=1)='2026-10-31'::date;
  assert (select payment_cents from public.debt_schedule(d) where installment_no=2)=10000;
  assert (select installment_cents from public.debts where id=d)=10000;
  assert public.update_debt_contract_scoped(d,1,'one',
    '{"installment_cents":11000,"due_date":"2026-10-31"}'::jsonb,v,'{}'::jsonb,req)=r,
    'same request id replays the committed result';

  select edit_revision into v from public.debts where id=d;
  perform public.update_debt_contract_scoped(d,1,'future',
    '{"installment_cents":12000,"due_day":-1,"first_due_date":"2026-10-31"}'::jsonb,
    v,'{}'::jsonb,gen_random_uuid());
  assert (select installment_cents from public.debts where id=d)=12000;
  assert (select due_day from public.debts where id=d)=-1;
  assert (select due_date from public.debt_schedule(d) where installment_no=2)='2026-11-30'::date;
  assert (select count(*) from public.debt_installment_edits where debt_id=d)=0,
    'future supersedes the old one-parcel exception at the anchor';
end $$;

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000b9a1';
  w uuid := '00000000-0000-0000-0000-00000000b9b1';
  d uuid := '00000000-0000-0000-0000-00000000b9d3';
  v bigint;
begin
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,
    principal_cents,remaining_cents,interest_rate_monthly,installments,installments_paid,
    installment_cents,due_day,first_due_date)
  values (d,w,u,'Declared past','financing','fixed_installments',40000,30000,0,4,1,
    10000,4,'2026-08-04');
  select edit_revision into v from public.debts where id=d;
  perform public.update_debt_contract_scoped(d,2,'future',
    '{"installment_cents":12000}'::jsonb,v,'{}'::jsonb,gen_random_uuid());
  assert (select amount_cents from public.debt_declared_estimates
    where debt_id=d and installment_no=1)=10000,
    'future keeps the earlier declared estimate';
  assert (select installment_cents from public.debts where id=d)=12000;
end $$;

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000b9a1';
  w uuid := '00000000-0000-0000-0000-00000000b9b1';
  d uuid := '00000000-0000-0000-0000-00000000b9d2';
  v bigint;
  versions jsonb;
  paid_date date := current_date - 3;
  req uuid := gen_random_uuid();
  r jsonb;
begin
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,
    principal_cents,remaining_cents,interest_rate_monthly,installments,installments_paid,
    installment_cents,due_day,first_due_date)
  values (d,w,u,'Fundacred','financing','fixed_installments',40000,30000,0,4,1,
    10000,4,'2026-07-04');
  insert into public.debt_declared_estimates(debt_id,installment_no,amount_cents)
    values (d,1,9500);
  perform public.pay_debt_installment(d,10000,null,paid_date);
  select edit_revision into v from public.debts where id=d;
  select jsonb_object_agg(id::text,edit_revision) into versions
    from public.transactions where debt_id=d;
  r := public.update_debt_contract_scoped(d,3,'all',
    '{"installment_cents":11000,"due_day":-1}'::jsonb,v,versions,req);
  assert r->>'recorded_changed'='1';
  assert (select amount_cents from public.transactions where debt_id=d)=11000,
    'all corrects recorded cash';
  assert (select occurred_at from public.transactions where debt_id=d)=paid_date,
    'real payment date is historical fact';
  assert (select count(*) from public.debt_declared_estimates where debt_id=d)=0,
    'all recalculates declared historical estimates';
  assert (select remaining_cents from public.debts where id=d)=22000,
    'future principal follows new fixed amount, not cash fee';
  assert public.update_debt_contract_scoped(d,3,'all',
    '{"installment_cents":11000,"due_day":-1}'::jsonb,v,versions,req)=r,
    'same request remains idempotent after revisions changed';
  begin
    perform public.update_debt_contract_scoped(d,3,'all',
      '{"installment_cents":12000}'::jsonb,v,versions,gen_random_uuid());
    raise exception 'stale revision was accepted';
  exception when others then
    if sqlerrm='stale revision was accepted' then raise; end if;
    assert sqlerrm like '%mudou enquanto%', 'stale revision must fail before writing';
  end;
  select edit_revision into v from public.debts where id=d;
  select jsonb_object_agg(id::text,edit_revision) into versions
    from public.transactions where debt_id=d;
  perform public.update_debt_contract_scoped(d,3,'all',
    '{"name":"Fundacred corrigida","installments":5}'::jsonb,
    v,versions,gen_random_uuid());
  assert (select name from public.debts where id=d)='Fundacred corrigida';
  assert (select installments from public.debts where id=d)=5;
  assert (select description from public.transactions where debt_id=d)='Parcela Fundacred corrigida',
    'all follows the contract rename on generated past payment titles';
end $$;
set local role authenticated;
do $$
declare v bigint;
begin
  select edit_revision into v from public.debts where id=
    '00000000-0000-0000-0000-00000000b9d1'::uuid;
  perform public.update_debt_contract_scoped(
    '00000000-0000-0000-0000-00000000b9d1'::uuid,1,'one',
    '{"due_date":"2026-10-30"}'::jsonb,v,'{}'::jsonb,gen_random_uuid());
  assert (select payment_cents from public.debt_schedule(
    '00000000-0000-0000-0000-00000000b9d1'::uuid)
    where installment_no=1)=12000,
    'authenticated schedule sees scoped edits under workspace RLS';
  assert (select due_date from public.debt_schedule(
    '00000000-0000-0000-0000-00000000b9d1'::uuid)
    where installment_no=1)='2026-10-30'::date,
    'authenticated RPC may edit the owned installment';
end $$;
reset role;
rollback;
