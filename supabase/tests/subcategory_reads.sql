\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$
declare
  u uuid:='00000000-0000-4000-8000-00000000f951';
  w uuid:='00000000-0000-4000-8000-00000000f952';
  bank uuid:='00000000-0000-4000-8000-00000000f953';
  a uuid:='00000000-0000-4000-8000-00000000f954';
  b uuid:='00000000-0000-4000-8000-00000000f955';
  other_parent uuid:='00000000-0000-4000-8000-00000000f956';
  rid uuid;did uuid;result jsonb;payload jsonb;total bigint;rev bigint;
  first_day date:=date_trunc('month',current_date)::date+14;
  second_day date:=(date_trunc('month',current_date)+interval '1 month')::date+14;
begin
  insert into auth.users(id,email) values(u,'subcategory-read@example.invalid');
  insert into public.profiles(id) values(u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name,created_at) values(w,u,'F09 report space',now()-interval '2 days');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  insert into public.accounts(id,user_id,workspace_id,name,type) values(bank,u,w,'F09 report bank','checking');
  insert into public.subcategories(id,user_id,workspace_id,parent_category,name)
    values(a,u,w,'alimentação','mercado'),(b,u,w,'alimentação','restaurante'),(other_parent,u,w,'saúde','consulta');
  insert into public.transactions(user_id,workspace_id,kind,amount_cents,category,subcategory_id,description,account_id,occurred_at,status)
    values(u,w,'expense',101,'alimentação',a,'F09 a',bank,current_date,'cleared'),
      (u,w,'expense',202,'alimentação',b,'F09 b',bank,current_date,'cleared'),
      (u,w,'expense',303,'alimentação',null,'F09 legacy null',bank,current_date,'cleared'),
      (u,w,'expense',999,'alimentação',a,'F09 pending',bank,current_date,'pending'),
      (u,w,'income',404,'alimentação',a,'F09 income',bank,current_date,'cleared'),
      (u,w,'expense',505,'alimentacao',a,'F09 exact parent alias',bank,current_date,'cleared'),
      (u,w,'expense',606,null,null,'F09 parent null',bank,current_date,'cleared');
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);
  result:=public.category_detail_breakdown(current_date,current_date,'expense','alimentação',w);
  assert result->>'total_cents'='606' and jsonb_array_length(result->'lines')=3,'report eligibility or grouping changed';
  select sum((x->>'total_cents')::bigint) into total from jsonb_array_elements(result->'lines') x;
  assert total=(result->>'total_cents')::bigint,'parent != children plus Sem detalhe';
  assert (select x->>'name' from jsonb_array_elements(result->'lines') x where x->>'subcategory_id'=a::text)='mercado';
  assert (select x->>'total_cents' from jsonb_array_elements(result->'lines') x where x->>'subcategory_id' is null)='303';
  assert public.category_detail_breakdown(current_date,current_date,'income','alimentação',w)->>'total_cents'='404';
  assert public.category_detail_breakdown(current_date,current_date,'expense','outros',w)->>'total_cents'='606';
  assert public.category_detail_breakdown(current_date,current_date,'expense','vazio',w)->>'total_cents'='0';
  begin
    perform public.category_detail_breakdown(current_date,current_date,'expense','alimentação',gen_random_uuid());
    raise exception 'unrelated report workspace accepted';
  exception when insufficient_privilege then null;end;
  begin
    perform public.category_detail_breakdown(current_date,current_date+367,'expense','alimentação',w);
    raise exception 'unbounded report accepted';
  exception when invalid_parameter_value then null;end;

  payload:=jsonb_build_object('kind','expense','amount_cents',125,'category','alimentação','subcategory_id',a,
    'description','F09 dated read','account_id',bank,'rrule','FREQ=MONTHLY;BYMONTHDAY=15',
    'next_run_at',first_day::text||'T12:00:00-03:00','end_date',null,'auto_confirm',false);
  result:=public.create_recurring_payment(payload,gen_random_uuid());rid:=(result->>'id')::uuid;
  -- A selected future occurrence produces a new version; the absent earlier date stays old.
  did:=public.materialize_recurring_occurrence(rid,second_day);
  select edit_revision into rev from public.recurring_transactions where id=rid;
  perform public.update_recurring_future(did,rid,'{}',jsonb_build_object('subcategory_id',b),rev,gen_random_uuid());
  assert (select subcategory_id=a and subcategory_name='mercado' and workspace_id=w
    from public.ledger_expected_lines_detailed(first_day,first_day,rid)),'read used current template instead of dated snapshot';
  assert not exists(select 1 from public.ledger_expected_lines_detailed(second_day,second_day,rid)),
    'read duplicated materialized occurrence';
  -- Legacy API shape remains exactly 17 columns, without the new metadata.
  assert (select count(*) from jsonb_object_keys((select to_jsonb(l) from public.ledger_expected_lines_classified(first_day,first_day,rid) l)))=17;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.category_detail_breakdown(current_date,current_date,'expense','alimentação',w);
    raise exception 'unauthenticated report accepted';
  exception when insufficient_privilege then null;end;
end $$;
rollback;
