\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
create function pg_temp.reject_f10(p jsonb,code text default '22023') returns void language plpgsql as $$
begin
 begin perform public.save_goal_plan_v2(p,gen_random_uuid());exception when others then assert sqlstate=code,format('expected %s got %s: %s',code,sqlstate,sqlerrm);return;end;
 raise exception 'Invalid F10 plan accepted';
end $$;
do $$
declare u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); ow uuid:=gen_random_uuid(); g uuid:=gen_random_uuid();
 req uuid:=gen_random_uuid(); cancel_req uuid:=gen_random_uuid(); fake_req uuid:=gen_random_uuid(); p jsonb; r jsonb; item jsonb; bad jsonb;
begin
 insert into auth.users(id,email) values(u,'f10-'||u||'@example.invalid'),(outsider,'f10-'||outsider||'@example.invalid');
 insert into public.profiles(id) values(u),(outsider) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F10 command'),(ow,outsider,'F10 foreign');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(ow,outsider,'owner');
 insert into public.goals(id,workspace_id,user_id,name,target_cents) values(g,w,u,'F10',10001);
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
 item:=jsonb_build_object('goal_id',g,'included',true,'mode','deadline','monthly_cents',null,'first_on',current_date,'deadline_on',private.goal_contribution_month_on(current_date,2),'initial_cents',0,'initial_on',null);
 p:=jsonb_build_object('workspace_id',w,'expected_revision',null,'goals_fingerprint',private.goal_planning_fingerprint(w),'items',jsonb_build_array(item));
 r:=public.save_goal_plan_v2(p,req);assert r=jsonb_build_object('workspace_id',w,'edit_revision',1);
 assert (select contribution_mode from public.goal_plan_items where workspace_id=w)='deadline';
 assert (select monthly_cents from public.goal_plan_items where workspace_id=w)=3334;
 assert public.save_goal_plan_v2(p,req)=r,'Replay was subjected to stale CAS';
 assert public.resolve_goal_plan_attempt_v2(p,req)=r;
 perform pg_temp.reject_f10(p,'PT409');
 begin perform public.save_goal_plan_v2(p||'{"expected_revision":1}',req);raise exception 'Mismatched replay';exception when invalid_parameter_value then null;end;
 -- Shared request namespace but sealed operations distinguish v1 and v2.
 begin perform public.save_goal_plan(jsonb_build_object('workspace_id',w,'expected_revision',1,'goals_fingerprint',p->'goals_fingerprint','items',jsonb_build_array(jsonb_build_object('goal_id',g,'included',true,'monthly_cents',3334,'first_on',current_date))),req);raise exception 'Cross-version reuse allowed';exception when invalid_parameter_value then null;end;
 assert public.resolve_goal_plan_attempt_v2(p||'{"expected_revision":1}',cancel_req)=jsonb_build_object('workspace_id',w,'cancelled',true);
 assert public.save_goal_plan_v2(p||'{"expected_revision":1}',cancel_req)=jsonb_build_object('workspace_id',w,'cancelled',true);
 assert (select edit_revision from public.goal_plans where workspace_id=w)=1;
 foreach bad in array array[item||'{"unknown":1}',item-'initial_on',item||'{"mode":"bogus"}',item||'{"monthly_cents":1}',item||'{"initial_cents":"1"}',item||'{"initial_cents":9007199254740992}',item||'{"first_on":"0000-01-01"}',item||'{"first_on":"2027-02-29"}',item||'{"initial_cents":0,"initial_on":"2027-01-01"}',item||jsonb_build_object('initial_cents',1,'initial_on',current_date+1),item||'{"deadline_on":null}'] loop
  perform pg_temp.reject_f10(p||jsonb_build_object('expected_revision',1,'items',jsonb_build_array(bad)));
 end loop;
 perform pg_temp.reject_f10(p||jsonb_build_object('expected_revision',1,'items','[]'::jsonb),'PT409');
 perform pg_temp.reject_f10(p||jsonb_build_object('expected_revision',1,'items',jsonb_build_array(item,item)));
 perform pg_temp.reject_f10(p||'{"expected_revision":1,"goals_fingerprint":"00000000000000000000000000000000"}','PT409');
 perform private.reserve_payment_request(fake_req,jsonb_build_object('operation','save_goal_plan_v2','input',p||'{"expected_revision":1}'));
 perform private.finish_payment_request(fake_req,jsonb_build_object('workspace_id',w,'edit_revision',99));
 begin perform public.save_goal_plan_v2(p||'{"expected_revision":1}',fake_req);raise exception 'Generic forged receipt trusted';exception when insufficient_privilege then null;end;
 begin update public.goal_plan_items set initial_cents=2 where workspace_id=w;raise exception 'Direct DML allowed';exception when insufficient_privilege then null;end;

 perform set_config('role','none',true);
 begin update public.goal_plan_items set contribution_mode='monthly',contribution_deadline=null,monthly_cents=0 where workspace_id=w;raise exception 'Service wrote zero/no-initial scenario';exception when check_violation then null;end;
 perform set_config('role','authenticated',true);
 -- Reading and an old no-change save must calculate the deadline source again,
 -- rather than trust a stale materialized monthly value.
 perform set_config('role','none',true);update public.goal_plan_items set monthly_cents=1 where workspace_id=w;perform set_config('role','authenticated',true);
 assert public.goal_planning_state_v2(w,100,'civil','day')->'horizons'->0->'result'->>'monthly_cents'='3334';
 assert public.goal_planning_state_v2(w,100,'civil','day')->'horizons'->0->'item'->'monthly_cents'='null'::jsonb;
 -- Initial-only is valid with no monthly source/date. An old client sees computed
 -- zero and must not silently clear the null source or the explicit initial date.
 item:=jsonb_build_object('goal_id',g,'included',true,'mode','monthly','monthly_cents',null,'first_on',null,'deadline_on',null,'initial_cents',12000,'initial_on',current_date+1);
 perform public.save_goal_plan_v2(p||jsonb_build_object('expected_revision',1,'items',jsonb_build_array(item)),gen_random_uuid());
 assert (select monthly_cents from public.goal_plan_items where workspace_id=w) is null;
 assert public.goal_planning_state_v2(w,10,'civil','day')->'state'->'points'->1->>'planned_cents'='10001';
 perform public.save_goal_plan(jsonb_build_object('workspace_id',w,'expected_revision',2,'goals_fingerprint',p->'goals_fingerprint','items',jsonb_build_array(jsonb_build_object('goal_id',g,'included',true,'monthly_cents',0,'first_on',null))),gen_random_uuid());
 assert (select contribution_mode from public.goal_plan_items where workspace_id=w)='monthly';
 assert (select initial_cents from public.goal_plan_items where workspace_id=w)=12000;
 assert (select monthly_cents from public.goal_plan_items where workspace_id=w) is null;
 perform public.save_goal_plan(jsonb_build_object('workspace_id',w,'expected_revision',3,'goals_fingerprint',p->'goals_fingerprint','items',jsonb_build_array(jsonb_build_object('goal_id',g,'included',true,'monthly_cents',1,'first_on',current_date+2))),gen_random_uuid());
 assert (select contribution_mode from public.goal_plan_items where workspace_id=w)='legacy';
 assert (select initial_cents from public.goal_plan_items where workspace_id=w)=12000;
 perform public.save_goal_plan(jsonb_build_object('workspace_id',w,'expected_revision',4,'goals_fingerprint',p->'goals_fingerprint','items',jsonb_build_array(jsonb_build_object('goal_id',g,'included',false,'monthly_cents',null,'first_on',null))),gen_random_uuid());
 assert (select contribution_mode from public.goal_plan_items where workspace_id=w)='monthly';
 assert (select initial_cents from public.goal_plan_items where workspace_id=w)=0;
 assert (select initial_on from public.goal_plan_items where workspace_id=w) is null;
 -- Resolve syntactically valid stale intent after goal edit without requiring current fingerprint/list.
 perform set_config('role','none',true);update public.goals set archived=true where id=g;perform set_config('role','authenticated',true);
 assert public.resolve_goal_plan_attempt_v2(p,gen_random_uuid())->>'cancelled'='true';
 perform set_config('role','none',true);delete from public.workspace_members where workspace_id=w and user_id=u;perform set_config('role','authenticated',true);
 begin perform public.save_goal_plan_v2(p,req);raise exception 'Replay without membership';exception when insufficient_privilege then null;end;
 begin perform public.resolve_goal_plan_attempt_v2(p,req);raise exception 'Resolve without membership';exception when insufficient_privilege then null;end;
 assert not has_function_privilege('anon','public.save_goal_plan_v2(jsonb,uuid)','execute');
 assert not has_function_privilege('anon','public.resolve_goal_plan_attempt_v2(jsonb,uuid)','execute');
 assert not has_table_privilege('authenticated','private.goal_plan_write_receipts','insert');
end $$;
rollback;
