-- F08 command acceptance: configuration must persist without moving financial money.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
create function pg_temp.reject_goal_plan(p jsonb, code text default '22023') returns void language plpgsql as $$
begin
 begin perform public.save_goal_plan(p,gen_random_uuid());
 exception when others then
  assert sqlstate=code,format('expected %s got %s: %s',code,sqlstate,sqlerrm);return;
 end;
 raise exception 'Invalid goal plan accepted';
end $$;
do $$
declare
 u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); other_w uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid(); g1 uuid:=gen_random_uuid(); g2 uuid:=gen_random_uuid(); foreign_goal uuid:=gen_random_uuid();
 req uuid:=gen_random_uuid(); cancel_req uuid:=gen_random_uuid(); fake_req uuid:=gen_random_uuid();
 p jsonb; result jsonb; before_money jsonb; after_money jsonb; old_hash text;
begin
 insert into auth.users(id,email) values(u,'f08-'||u||'@example.invalid'),(other_u,'f08-'||other_u||'@example.invalid');
 insert into public.profiles(id) values(u),(other_u) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F08 plan isolated'),(other_w,other_u,'F08 foreign');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(other_w,other_u,'owner');
 insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values(a,w,u,'F08 bank','checking',200000);
 insert into public.goals(id,workspace_id,user_id,name,target_cents,deadline) values
 (g1,w,u,'First',100000,current_date+90),(g2,w,u,'Second',50000,null),(foreign_goal,other_w,other_u,'Foreign',1000,null);
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform public.goal_deposit(g1,10000,current_date);
 perform set_config('role','authenticated',true);
 before_money:=jsonb_build_object('cash',private.cash_total(array[w],current_date),
  'goals',(select jsonb_agg(to_jsonb(t) order by id) from public.goals t where workspace_id=w),
  'contributions',(select jsonb_agg(to_jsonb(t) order by id) from public.goal_contributions t where workspace_id=w),
  'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where workspace_id=w),
  'allocations',(select jsonb_agg(to_jsonb(t) order by id) from public.financial_allocations t where workspace_id=w));
 p:=jsonb_build_object('workspace_id',w,'expected_revision',null,'goals_fingerprint',private.goal_planning_fingerprint(w),
  'items',jsonb_build_array(jsonb_build_object('goal_id',g1,'included',true,'monthly_cents',30000,'first_on',current_date),
                          jsonb_build_object('goal_id',g2,'included',false,'monthly_cents',null,'first_on',null)));
 result:=public.save_goal_plan(p,req);
 assert result=jsonb_build_object('workspace_id',w,'edit_revision',1),result::text;
 assert (select edit_revision from public.goal_plans where workspace_id=w)=1,'Committed plan absent';
 assert (select count(*) from public.goal_plan_items where workspace_id=w)=2,'Plan items were not persisted';
 assert (select monthly_cents from public.goal_plan_items where workspace_id=w and goal_id=g1)=30000;
 assert (select first_on from public.goal_plan_items where workspace_id=w and goal_id=g1)=current_date;
 assert public.save_goal_plan(p,req)=result,'Same intent did not replay before CAS';
 perform pg_temp.reject_goal_plan(p,'PT409');
 perform pg_temp.reject_goal_plan(p||'{"expected_revision":1,"unexpected":true}');
 perform pg_temp.reject_goal_plan(p||'{"expected_revision":"1"}');
 perform pg_temp.reject_goal_plan(p||'{"expected_revision":0}');
 perform pg_temp.reject_goal_plan(p||'{"expected_revision":9007199254740992}');
 perform pg_temp.reject_goal_plan(p||'{"expected_revision":1.5}');
 perform pg_temp.reject_goal_plan(p||'{"expected_revision":1,"goals_fingerprint":"forged"}');
 perform pg_temp.reject_goal_plan(p||jsonb_build_object('expected_revision',1,'goals_fingerprint',repeat('0',32)),'PT409');
 perform pg_temp.reject_goal_plan(p||jsonb_build_object('expected_revision',1,'items','[]'::jsonb),'PT409');
 perform pg_temp.reject_goal_plan(p||jsonb_build_object('expected_revision',1,'items',jsonb_build_array(p->'items'->0,p->'items'->0)));
 perform pg_temp.reject_goal_plan(p||jsonb_build_object('expected_revision',1,'items',jsonb_build_array(p->'items'->0,
  jsonb_build_object('goal_id',foreign_goal,'included',false,'monthly_cents',null,'first_on',null))),'PT409');
 perform pg_temp.reject_goal_plan(p||jsonb_build_object('expected_revision',1,'items',jsonb_build_array((p->'items'->0)||'{"monthly_cents":0}',p->'items'->1)));
 perform pg_temp.reject_goal_plan(p||jsonb_build_object('expected_revision',1,'items',jsonb_build_array((p->'items'->0)||'{"monthly_cents":null}',p->'items'->1)));
 perform pg_temp.reject_goal_plan(p||jsonb_build_object('expected_revision',1,'items',jsonb_build_array((p->'items'->0)||'{"monthly_cents":"100"}',p->'items'->1)));
 perform pg_temp.reject_goal_plan(p||jsonb_build_object('expected_revision',1,'items',jsonb_build_array((p->'items'->0)||'{"monthly_cents":9007199254740992}',p->'items'->1)));
 perform pg_temp.reject_goal_plan(p||jsonb_build_object('expected_revision',1,'items',jsonb_build_array((p->'items'->0)||'{"first_on":"2027-02-29"}',p->'items'->1)));
 perform pg_temp.reject_goal_plan(p||jsonb_build_object('expected_revision',1,'items',jsonb_build_array((p->'items'->0)||'{"first_on":null}',p->'items'->1)));
 perform pg_temp.reject_goal_plan(p||jsonb_build_object('expected_revision',1,'items',jsonb_build_array(p->'items'->0,(p->'items'->1)||'{"monthly_cents":1}')));
 begin perform public.save_goal_plan(p||'{"expected_revision":1}',req);raise exception 'Changed intent reused request id';
 exception when invalid_parameter_value then null;end;
 begin perform public.save_goal_plan(p,null);raise exception 'Null request accepted';
 exception when invalid_parameter_value then null;end;
 begin perform public.save_goal_plan(p||jsonb_build_object('workspace_id',other_w),gen_random_uuid());raise exception 'Foreign workspace accepted';
 exception when insufficient_privilege then null;end;
 assert not exists(select 1 from public.goal_plans where workspace_id=other_w),'RLS leaked foreign workspace';
 begin update public.goal_plans set edit_revision=99 where workspace_id=w;raise exception 'Direct DML allowed';
 exception when insufficient_privilege then null;end;
 -- A caller-written generic receipt cannot impersonate a command-owned commit.
 perform private.reserve_payment_request(fake_req,jsonb_build_object('operation','save_goal_plan','input',p||'{"expected_revision":1}'));
 perform private.finish_payment_request(fake_req,jsonb_build_object('workspace_id',w,'edit_revision',99));
 begin perform public.save_goal_plan(p||'{"expected_revision":1}',fake_req);raise exception 'Forged generic receipt accepted';
 exception when insufficient_privilege then null;end;
 -- Close an ambiguous exact identity, then deliver the late original. No save occurs.
 assert public.resolve_goal_plan_attempt(p||'{"expected_revision":1}',cancel_req)=jsonb_build_object('workspace_id',w,'cancelled',true);
 assert public.save_goal_plan(p||'{"expected_revision":1}',cancel_req)=jsonb_build_object('workspace_id',w,'cancelled',true);
 assert (select edit_revision from public.goal_plans where workspace_id=w)=1,'Late original applied after terminal close';
 assert public.resolve_goal_plan_attempt(p,req)=result,'Resolution failed to return sealed commit';
 -- Financial definition/ledger changes invalidate intent; renaming is financially neutral.
 perform set_config('role','none',true);
 old_hash:=private.goal_planning_fingerprint(w);
 update public.goals set name='Renamed' where id=g1;
 assert private.goal_planning_fingerprint(w)=old_hash;
 before_money:=before_money||jsonb_build_object('goals',(select jsonb_agg(to_jsonb(t) order by id) from public.goals t where workspace_id=w));
 perform set_config('role','authenticated',true);
 p:=p||'{"expected_revision":1}';
 result:=public.save_goal_plan(p,gen_random_uuid());
 assert result->>'edit_revision'='2';
 perform set_config('role','none',true);
 update public.goals set target_cents=110000 where id=g1;
 perform set_config('role','authenticated',true);
 perform pg_temp.reject_goal_plan(p||'{"expected_revision":2}','PT409');
 perform set_config('role','none',true);
 update public.goals set target_cents=100000 where id=g1;
 perform set_config('role','authenticated',true);
 after_money:=jsonb_build_object('cash',private.cash_total(array[w],current_date),
  'goals',(select jsonb_agg(to_jsonb(t) order by id) from public.goals t where workspace_id=w),
  'contributions',(select jsonb_agg(to_jsonb(t) order by id) from public.goal_contributions t where workspace_id=w),
  'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where workspace_id=w),
  'allocations',(select jsonb_agg(to_jsonb(t) order by id) from public.financial_allocations t where workspace_id=w));
 -- updated_at is part of explicit goal edits, so compare financial goal definition only.
 assert before_money-'goals'=after_money-'goals','Plan wrote financial money';
 assert (select saved_cents from public.goals where id=g1)=10000,'Plan changed saved goal balance';
 -- FK scope is enforced even for service/database writes.
 perform set_config('role','none',true);
 begin insert into public.goal_plan_items(workspace_id,goal_id,user_id,included) values(w,foreign_goal,u,false);
 raise exception 'Cross-workspace goal item accepted';exception when check_violation then null;end;
 -- Deposit/withdraw/archival changes are observed by the snapshot fingerprint.
 old_hash:=private.goal_planning_fingerprint(w);
 perform public.goal_deposit(g1,1,current_date);
 assert private.goal_planning_fingerprint(w)<>old_hash;
 old_hash:=private.goal_planning_fingerprint(w);
 update public.goals set archived=true where id=g2;
 assert private.goal_planning_fingerprint(w)<>old_hash;
end $$;
rollback;
