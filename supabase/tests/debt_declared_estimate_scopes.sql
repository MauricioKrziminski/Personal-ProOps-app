-- docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/debt_declared_estimate_scopes.sql
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000a8a1';
  w uuid := '00000000-0000-0000-0000-00000000a8b1';
  d uuid := '00000000-0000-0000-0000-00000000a8d1';
  anchor uuid;
  av bigint;
  dv bigint;
  versions jsonb;
  result jsonb;
begin
  insert into auth.users(id,email) values (u,'debt-estimate-scopes@example.invalid');
  insert into public.profiles(id) values (u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Estimate scopes');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner');
  insert into public.debts
    (id,workspace_id,user_id,name,kind,calculation_mode,principal_cents,remaining_cents,
     interest_rate_monthly,installments,installments_paid,installment_cents)
  values (d,w,u,'Fixed estimate scope','financing','fixed_installments',40000,30000,0,4,1,10000);
  perform public.pay_debt_installment(d,10000,null,current_date - 30);
  perform public.pay_debt_installment(d,10000,null,current_date);
  perform set_config('request.jwt.claim.sub',u::text,true);
  select id,edit_revision into anchor,av from public.transactions where debt_id=d and debt_payment_no=2;
  select edit_revision into dv from public.debts where id=d;
  select jsonb_object_agg(id::text,edit_revision) into versions from public.transactions where debt_id=d;

  result := public.update_debt_payment_scoped(anchor,'from_here','{"amount_cents":11000}'::jsonb,
    dv,av,versions,gen_random_uuid());
  assert (select amount_cents from public.debt_declared_estimates where debt_id=d and installment_no=1)=10000,
    'an earlier estimate must retain its old displayed amount';
  assert (select count(*) from public.transactions where debt_id=d and amount_cents=11000)=2,
    'from_here must correct selected recorded payments';
  assert (select installment_cents from public.debts where id=d)=11000,
    'future installment target must change';
  assert result->>'declared_estimates_recalculated'='0',
    'from_here must not claim an earlier estimate was recalculated';

  select edit_revision into av from public.transactions where id=anchor;
  select edit_revision into dv from public.debts where id=d;
  select jsonb_object_agg(id::text,edit_revision) into versions from public.transactions where debt_id=d;
  result := public.update_debt_payment_scoped(anchor,'all','{"amount_cents":12000}'::jsonb,
    dv,av,versions,gen_random_uuid());
  assert not exists(select 1 from public.debt_declared_estimates where debt_id=d),
    'all removes historical overrides so the declared estimate follows the new contract';
  assert result->>'declared_estimates_recalculated'='1';
  assert (select installment_cents from public.debts where id=d)=12000;
end $$;

-- An amortized one-payment correction changes the Price projection. The earlier
-- declared-only estimate still belongs outside one, so store its old displayed amount.
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000a8a1';
  w uuid := '00000000-0000-0000-0000-00000000a8b1';
  d uuid := '00000000-0000-0000-0000-00000000a8d2';
  anchor uuid;
  av bigint;
  dv bigint;
  versions jsonb;
  old_estimate bigint;
begin
  insert into public.debts
    (id,workspace_id,user_id,name,kind,calculation_mode,principal_cents,remaining_cents,
     interest_rate_monthly,installments,installments_paid)
  values (d,w,u,'Price estimate scope','financing','amortized',100000,75000,0.01,4,1);
  perform public.pay_debt_installment(d,26000,null,current_date);
  select payment_cents into old_estimate from public.debt_schedule(d) order by installment_no limit 1;
  select id,edit_revision into anchor,av from public.transactions where debt_id=d;
  select edit_revision into dv from public.debts where id=d;
  select jsonb_object_agg(id::text,edit_revision) into versions from public.transactions where debt_id=d;
  perform public.update_debt_payment_scoped(anchor,'one','{"amount_cents":26500}'::jsonb,
    dv,av,versions,gen_random_uuid());
  assert (select amount_cents from public.debt_declared_estimates where debt_id=d and installment_no=1)=old_estimate,
    'one must keep the earlier estimate visible at its pre-edit value';
end $$;
rollback;
