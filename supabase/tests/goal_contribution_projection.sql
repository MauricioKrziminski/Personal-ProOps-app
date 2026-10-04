-- F10 semantic tests. Execute on the explicitly selected QA DB; fixtures roll back.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
-- RED is the absent API / unsupported deadline behavior, not a setup assertion.
do $$
declare p jsonb; r jsonb;
begin
 p:='{"target_cents":10001,"saved_cents":0,"as_of":"2027-01-01","mode":"deadline","monthly_cents":null,"first_on":"2027-01-31","deadline_on":"2027-03-31","initial_cents":0,"initial_on":null}';
 r:=private.goal_contribution_result(p);
 assert r='{"status":"ready","reason":null,"remaining_cents":"10001","initial_applied_cents":"0","monthly_cents":"3334","monthly_count":3,"contribution_count":3,"last_cents":"3333","first_monthly_on":"2027-01-31","estimated_on":"2027-03-31","anchor_on":"2027-01-31","first_offset":0,"flags":[]}'::jsonb,r::text;
 assert private.goal_contribution_month_on(date '2027-01-31',1)=date '2027-02-28';
 assert private.goal_contribution_month_on(date '2027-01-31',2)=date '2027-03-31';
 assert private.goal_contribution_month_on(date '2024-01-31',1)=date '2024-02-29';
 assert private.goal_contribution_month_on(date '9999-12-31',1) is null;
 r:=private.goal_contribution_result(p||'{"saved_cents":10001}');
 assert r->>'status'='reached' and r->>'monthly_cents'='0' and r->>'contribution_count'='0';
 r:=private.goal_contribution_result(p||'{"initial_cents":10001,"initial_on":"2027-01-02","first_on":null}');
 assert r->>'status'='ready' and r->>'estimated_on'='2027-01-02' and r->>'monthly_count'='0' and r->>'contribution_count'='1';
 r:=private.goal_contribution_result(p||'{"initial_cents":10,"initial_on":"2026-12-31","first_on":null}');
 assert r->>'reason'='first_date' and r->'flags'='["initial_past"]'::jsonb;
 r:=private.goal_contribution_result(p||'{"initial_cents":1,"initial_on":"2027-02-01"}');
 assert r->>'reason'='initial_after_first';
 r:=private.goal_contribution_result(p||'{"initial_cents":1,"initial_on":"2027-04-01"}');
 assert r->>'reason'='initial_after_deadline';
 r:=private.goal_contribution_result(p||'{"deadline_on":"2027-01-30"}');
 assert r->>'status'='unreachable' and r->>'reason'='deadline';
 r:=private.goal_contribution_result(p||'{"mode":"monthly","monthly_cents":0,"deadline_on":null}');
 assert r->>'reason'='monthly_amount';
 r:=private.goal_contribution_result(p||'{"mode":"monthly","monthly_cents":1,"target_cents":9007199254740991,"deadline_on":null}');
 assert r->>'status'='out_of_range' and r->>'monthly_count'='9007199254740991' and r->>'estimated_on' is null;
 -- Past intentions do not lower actual remaining; preserve original 31 anchor.
 r:=private.goal_contribution_result(p||'{"mode":"monthly","monthly_cents":5000,"saved_cents":1,"first_on":"2026-01-31","as_of":"2027-02-01","deadline_on":null}');
 assert r->>'first_offset'='13' and r->>'first_monthly_on'='2027-02-28' and r->>'estimated_on'='2027-03-31' and r->>'last_cents'='5000';
end $$;
do $$
declare u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); ow uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid(); g uuid:=gen_random_uuid(); reached uuid:=gen_random_uuid(); p jsonb; v jsonb; s jsonb; old jsonb; money jsonb; x jsonb; h jsonb; agg numeric;
begin
 insert into auth.users(id,email) values(u,'f10-'||u||'@example.invalid'),(outsider,'f10-'||outsider||'@example.invalid');
 insert into public.profiles(id) values(u),(outsider) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name,cycle_close_day) values(w,u,'F10 overlay',15),(ow,outsider,'F10 foreign',null);
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(ow,outsider,'owner');
 insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values(a,w,u,'F10 cash','checking',600);
 insert into public.goals(id,workspace_id,user_id,name,target_cents,deadline) values(g,w,u,'F10 goal',10001,current_date),(reached,w,u,'Reached',1,null);
 perform set_config('request.jwt.claim.sub',u::text,true);perform public.goal_deposit(g,1,current_date);perform public.goal_deposit(reached,1,current_date);
 perform set_config('role','authenticated',true);
 money:=jsonb_build_object('cash',private.cash_total(array[w]),'contributions',(select jsonb_agg(to_jsonb(c) order by id) from public.goal_contributions c where workspace_id=w),'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where workspace_id=w),'allocations',(select jsonb_agg(to_jsonb(t) order by id) from public.financial_allocations t where workspace_id=w));
 p:=jsonb_build_object('goals_fingerprint',private.goal_planning_fingerprint(w),'items',jsonb_build_array(jsonb_build_object('goal_id',g,'included',true,'mode','monthly','monthly_cents',3334,'first_on',current_date,'deadline_on',null,'initial_cents',10,'initial_on',current_date)));
 v:=public.goal_planning_state_v2(w,100,'civil','day',p);s:=v->'state';h:=v->'horizons'->0;
 assert jsonb_array_length(v->'horizons')=1,'Reached goal emitted a horizon';
 assert h->'item'->>'monthly_cents'='3334' and h->'item'->>'initial_cents'='10','Money DTO must be strings';
 assert h->'result'->>'remaining_cents'='10000' and h->'result'->>'last_cents'='3322';
 assert s->'points'->0->>'planned_cents'='3344','Initial and first monthly must both count on today';
 assert (select sum((d->>'planned_cents')::numeric) from jsonb_array_elements(s->'points') d)=10000,'Overlay must cap remaining';
 assert s->'missed_deadline_goal_ids'=jsonb_build_array(g),'Monthly scenario must warn about real goal deadline';
 assert s->>'first_pressure_on'=current_date::text;
 assert public.goal_planning_state_v2(w,1,'civil','day',p)->'horizons'=v->'horizons','Result depends on visible horizon';
 x:=public.goal_planning_state_v2(w,100,'cycle','month',p)->'state';
 assert x->'points'='[]'::jsonb;
 assert (select sum((d->>'planned_cents')::numeric) from jsonb_array_elements(x->'months') d)=10000,'Cycle aggregation changes intentions';
 perform public.save_goal_plan_v2(jsonb_build_object('workspace_id',w,'expected_revision',null)||p,gen_random_uuid());
 old:=public.goal_planning_state(w,100,'civil','day');
 assert old->'points'=s->'points','Old read omitted initial/new monthly calendar';
 -- Same v1 source preserves new mode and initial; explicit v1 source edit becomes legacy.
 perform public.save_goal_plan(jsonb_build_object('workspace_id',w,'expected_revision',1,'goals_fingerprint',p->'goals_fingerprint','items',jsonb_build_array(jsonb_build_object('goal_id',g,'included',true,'monthly_cents',3334,'first_on',current_date))),gen_random_uuid());
 assert public.goal_planning_state_v2(w,100,'civil','day')->'horizons'->0->'item'->>'mode'='monthly';
 assert public.goal_planning_state(w,100,'civil','day')->'points'=s->'points';
 perform public.save_goal_plan(jsonb_build_object('workspace_id',w,'expected_revision',2,'goals_fingerprint',p->'goals_fingerprint','items',jsonb_build_array(jsonb_build_object('goal_id',g,'included',true,'monthly_cents',3333,'first_on',current_date))),gen_random_uuid());
 x:=public.goal_planning_state_v2(w,100,'civil','day');
 assert x->'horizons'->0->'item'->>'mode'='legacy' and x->'horizons'->0->'item'->>'initial_cents'='10';
 assert (select sum((d->>'planned_cents')::numeric) from jsonb_array_elements(x->'state'->'points') d)=3343,'Legacy extends real deadline';
 assert x->'horizons'->0->'result'->>'estimated_on'>current_date::text,'Legacy result must retain full calculation';
 assert money=jsonb_build_object('cash',private.cash_total(array[w]),'contributions',(select jsonb_agg(to_jsonb(c) order by id) from public.goal_contributions c where workspace_id=w),'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where workspace_id=w),'allocations',(select jsonb_agg(to_jsonb(t) order by id) from public.financial_allocations t where workspace_id=w)),'Intent mutated money';
 begin perform public.goal_planning_state_v2(ow,10,'civil','day');raise exception 'Foreign state allowed';exception when insufficient_privilege then null;end;
 assert not has_function_privilege('anon','public.goal_planning_state_v2(uuid,integer,text,text,jsonb)','execute');
 assert not has_function_privilege('anon','private.goal_contribution_result(jsonb)','execute');
end $$;
rollback;
