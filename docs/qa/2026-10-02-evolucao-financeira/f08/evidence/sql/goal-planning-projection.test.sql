-- F08 behavioral fixture: run only on the explicitly selected QA database. All rows roll back.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$ begin
 assert to_regprocedure('public.goal_planning_state(uuid,integer,text,text,jsonb)') is not null,
  'F08 projection API missing: setup failure, not behavioral RED';
 assert private.goal_plan_month_on(date '2024-01-31',1)=date '2024-02-29';
 assert private.goal_plan_month_on(date '2024-01-31',2)=date '2024-03-31','February must not drift the anchor';
 assert private.goal_plan_month_on(date '2023-01-31',1)=date '2023-02-28';
 assert private.goal_plan_occurrence_count(date '2024-01-31',date '2024-02-01',date '2024-03-30')=1;
 assert private.goal_plan_occurrence_count(date '2024-01-31',date '2024-01-31',date '2024-03-31')=3;
 assert private.goal_plan_occurrence_count(date '2024-01-31',date '2024-04-01',date '2024-03-31')=0;
 assert private.goal_plan_occurrence_count(date '2024-01-31',date '2024-02-29',date '2024-02-29')=1;
end $$;
create function pg_temp.goal_preview(ws uuid,monthly1 integer,monthly2 integer,first_on date)
returns jsonb language sql as $$
 select jsonb_build_object('goals_fingerprint',private.goal_planning_fingerprint(ws),'items',
  jsonb_agg(jsonb_build_object('goal_id',id,'included',true,'monthly_cents',
   case name when 'Goal one' then monthly1 else monthly2 end,'first_on',first_on) order by id))
 from public.goals where workspace_id=ws and not archived and saved_cents<target_cents;
$$;
do $$
declare
 u uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();w uuid:=gen_random_uuid();w2 uuid:=gen_random_uuid();ow uuid:=gen_random_uuid();
 bank uuid:=gen_random_uuid();bank2 uuid:=gen_random_uuid();asset uuid:=gen_random_uuid();g1 uuid:=gen_random_uuid();g2 uuid:=gen_random_uuid();g3 uuid:=gen_random_uuid();
 state jsonb;daily jsonb;preview jsonb;before_money jsonb;after_money jsonb;items jsonb;x jsonb;bad jsonb;months jsonb;
 last1 date;last2 date;expected numeric;req uuid:=gen_random_uuid();close_day integer:=15;
begin
 insert into auth.users(id,email) values(u,'f08-'||u||'@example.invalid'),(outsider,'f08-'||outsider||'@example.invalid');
 insert into public.profiles(id) values(u),(outsider) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name,cycle_close_day) values(w,u,'F08 isolated',close_day),(w2,u,'F08 second own',null),(ow,outsider,'F08 foreign',null);
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(w2,u,'owner'),(ow,outsider,'owner');
 insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values
  (bank,w,u,'Plan cash','checking',10000),(bank2,w2,u,'Other workspace cash','checking',999999);
 insert into public.assets(id,workspace_id,user_id,name,class,current_value_cents) values(asset,w,u,'Outside cash','investment',20000);
 insert into public.goals(id,workspace_id,user_id,name,target_cents) values(g1,w,u,'Goal one',450),(g2,w,u,'Goal two',750);
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform public.goal_deposit(g1,100,current_date);perform public.goal_deposit(g2,50,current_date);
 insert into public.transactions(workspace_id,user_id,account_id,kind,amount_cents,description,occurred_at,due_at,status) values
  (w,u,bank,'income',100,'Income in horizon',current_date+2,current_date+2,'pending'),
  (w,u,bank,'expense',40,'Expense in horizon',current_date+2,current_date+2,'pending'),
  (w2,u,bank2,'income',50000,'Other workspace income',current_date+2,current_date+2,'pending');
 perform set_config('role','authenticated',true);
 state:=public.goal_planning_state(w,100,'civil','day');
 assert state->>'workspace_name'='F08 isolated' and state->>'cycle_close_day'='15','Incorrect workspace context';
 assert jsonb_array_length(state->'incomplete_goal_ids')=2,'Undated goals must not invent monthly intentions';
 assert state->>'income_present'='true';assert state->>'unassigned_goals_cents'='150';
 assert (state->'points'->0->>'cash_cents')::numeric=10000,'Another member workspace leaked into cash';
 assert state->'months'='[]'::jsonb;
 before_money:=jsonb_build_object('cash',private.cash_total(array[w]),
  'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where workspace_id=w),
  'contributions',(select jsonb_agg(to_jsonb(c) order by id) from public.goal_contributions c where workspace_id=w),
  'allocations',(select jsonb_agg(to_jsonb(a) order by id) from public.financial_allocations a where workspace_id=w));
 preview:=pg_temp.goal_preview(w,200,300,current_date);
 daily:=public.goal_planning_state(w,100,'civil','day',preview);
 assert daily->'points'->0->>'planned_cents'='500','Two intentions must sum';
 assert (select sum((p->>'planned_cents')::numeric) from jsonb_array_elements(daily->'points') p)=1050,'Last contributions exceed remaining goals';
 last1:=private.goal_plan_month_on(current_date,1);last2:=private.goal_plan_month_on(current_date,2);
 select p into x from jsonb_array_elements(daily->'points') p where p->>'day'=last1::text;
 assert x->>'planned_cents'='450','Goal one last amount must be 150; goal two still 300';
 select p into x from jsonb_array_elements(daily->'points') p where p->>'day'=last2::text;
 assert x->>'planned_cents'='100','Goal two last amount must be capped at 100';
 assert (daily->'points'->-1->>'cash_cents')::numeric=10060;
 assert (daily->'points'->-1->>'available_cents')::numeric=9010;
 assert jsonb_array_length(daily->'incomplete_goal_ids')=0;
 -- The daily cash source is unchanged by simulation, and equals the existing event truth.
 for x in select p from jsonb_array_elements(daily->'points') p loop
  select private.cash_total(array[w])+coalesce(sum(e.in_cents::numeric-e.out_cents::numeric),0)
   into expected from private.eventos_de_caixa(array[w],current_date+100) e where e.day<=(x->>'day')::date;
  assert (x->>'cash_cents')::numeric=expected,'Projection diverged from existing cash events';
 end loop;
 foreach bad in array array[preview||'{"unknown":1}',preview-'items',preview||'{"items":null}',
  preview||jsonb_build_object('items',preview->'items'||preview->'items')] loop
  begin perform public.goal_planning_state(w,100,'civil','day',bad);raise exception 'Malformed preview accepted';
  exception when invalid_parameter_value then null;end;
 end loop;
 begin perform public.goal_planning_state(w,100,'civil','day',preview||'{"goals_fingerprint":"00000000000000000000000000000000"}');
  raise exception 'Stale preview accepted';exception when sqlstate 'PT409' then null;end;
 begin perform public.goal_planning_state(ow,100,'civil','day');raise exception 'Foreign workspace leaked';
 exception when insufficient_privilege then null;end;
 -- Civil/cycle aggregation changes periods, never the civil contribution dates or totals.
 foreach close_day in array array[15] loop
  state:=public.goal_planning_state(w,100,'cycle','month',preview);
  assert state->'points'='[]'::jsonb;
  assert (select sum((m->>'planned_cents')::numeric) from jsonb_array_elements(state->'months') m)=1050;
  for x in select m from jsonb_array_elements(state->'months') m loop
   assert (x->>'from')::date=(select ini from private.cycle_bounds(close_day,(x->>'month'||'-01')::date));
   assert (x->>'to')::date=(select fim from private.cycle_bounds(close_day,(x->>'month'||'-01')::date));
   assert (x->>'partial')::boolean=((x->>'from')::date<current_date or (x->>'to')::date>current_date+100);
  end loop;
 end loop;
 state:=public.goal_planning_state(w,3650,'civil','month',preview);
 assert state->>'days'='3650' and jsonb_array_length(state->'months')>100,'Month mode silently lowered horizon';
 assert public.goal_planning_state(w,99999,'civil','day',preview)->>'days'='3650';
 assert public.goal_planning_state(w,0,'civil','day',preview)->>'days'='1';
 -- Missing data is explicit in preview and cannot authorize a save. Exclusion is explicit.
 items:=jsonb_build_array(jsonb_build_object('goal_id',g1,'included',true,'monthly_cents',null,'first_on',null),
  jsonb_build_object('goal_id',g2,'included',false,'monthly_cents',null,'first_on',null));
 state:=public.goal_planning_state(w,100,'civil','day',preview||jsonb_build_object('items',items));
 assert state->'incomplete_goal_ids'=jsonb_build_array(g1) and state->'excluded_goal_ids'=jsonb_build_array(g2);
 assert (select sum((p->>'planned_cents')::numeric) from jsonb_array_elements(state->'points') p)=0;
 -- Save also persists intentions only. Canceling a draft is represented by reading saved state.
 perform public.save_goal_plan(jsonb_build_object('workspace_id',w,'expected_revision',null)||preview,req);
 state:=public.goal_planning_state(w,100,'civil','day');assert state->>'edit_revision'='1';
 assert not exists(select 1 from jsonb_array_elements(state->'goals') g where g->>'origin'<>'saved');
 after_money:=jsonb_build_object('cash',private.cash_total(array[w]),
  'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where workspace_id=w),
  'contributions',(select jsonb_agg(to_jsonb(c) order by id) from public.goal_contributions c where workspace_id=w),
  'allocations',(select jsonb_agg(to_jsonb(a) order by id) from public.financial_allocations a where workspace_id=w));
 assert before_money=after_money,'Simulate/save mutated financial facts';
 -- A new goal in a saved workspace gets a suggestion, rather than disappearing or
 -- inheriting somebody else's item. Completed goals immediately stop intentions.
 perform set_config('role','none',true);
 insert into public.goals(id,workspace_id,user_id,name,target_cents,deadline)
  values(g3,w,u,'New goal',1000,current_date+62);
 perform set_config('role','authenticated',true);
 state:=public.goal_planning_state(w,100,'civil','day');
 select g into x from jsonb_array_elements(state->'goals') g where g->>'goal_id'=g3::text;
 assert x->>'origin'='suggested' and x->>'first_on'=current_date::text and (x->>'monthly_cents')::numeric>0;
 begin perform public.goal_planning_state(w,100,'civil','day',preview);raise exception 'New goal accepted stale snapshot';
 exception when sqlstate 'PT409' then null;end;
 perform public.goal_deposit(g3,1000,current_date);
 state:=public.goal_planning_state(w,100,'civil','day');
 assert jsonb_array_length(state->'goals')=2,'Completed goal generated intentions';
 perform set_config('role','none',true);delete from public.goals where id=g3;
 perform set_config('role','authenticated',true);
 -- Past occurrences are ignored, not presumed paid; a missed deadline never extends.
 perform set_config('role','none',true);
 update public.goals set deadline=current_date-1 where id=g1;
 update public.goals set deadline=current_date where id=g2;
 perform set_config('role','authenticated',true);
 preview:=pg_temp.goal_preview(w,200,300,current_date);
 state:=public.goal_planning_state(w,100,'civil','day',preview);
 assert jsonb_array_length(state->'missed_deadline_goal_ids')=2,'Insufficient due-today plan claimed success';
 assert (select sum((p->>'planned_cents')::numeric) from jsonb_array_elements(state->'points') p)=300,'Past deadline extended';
 preview:=pg_temp.goal_preview(w,200,700,current_date);
 state:=public.goal_planning_state(w,100,'civil','day',preview);
 assert state->'missed_deadline_goal_ids'=jsonb_build_array(g1),'Due-today complete coverage marked missed';
 perform set_config('role','none',true);
 delete from public.goal_plan_items where workspace_id=w;delete from public.goal_plans where workspace_id=w;
 perform set_config('role','authenticated',true);
 state:=public.goal_planning_state(w,100,'civil','day');
 select g into x from jsonb_array_elements(state->'goals') g where g->>'goal_id'=g1::text;
 assert x->'monthly_cents'='null'::jsonb and x->>'deadline_status'='past';
 select g into x from jsonb_array_elements(state->'goals') g where g->>'goal_id'=g2::text;
 assert x->>'suggested_cents'='700' and x->>'first_on'=current_date::text,'Due-today suggestion omitted first occurrence';
 -- No income and pressure are independent qualifications. Outside assets never reduce cash.
 perform set_config('role','none',true);
 delete from public.transactions where workspace_id=w;
 update public.goals set deadline=null where workspace_id=w;
 update public.accounts set initial_balance_cents=600 where id=bank;
 insert into public.financial_allocations(workspace_id,user_id,purpose,goal_id,account_id,asset_id,amount_cents,liquidity_confirmed) values
  (w,u,'reserve',null,bank,null,400,true),(w,u,'goal',g1,bank,null,800,true),
  (w,u,'goal',g2,null,asset,10000,true);
 perform set_config('role','authenticated',true);
 preview:=pg_temp.goal_preview(w,200,300,current_date);
 state:=public.goal_planning_state(w,100,'civil','day',preview);
 assert state->>'reserved_cash_cents'='600','Shared source must use F07 proportional backing and exclude outside asset';
 assert state->>'income_present'='false' and state->>'first_pressure_on'=current_date::text;
 assert state->'points'->0->>'available_cents'='-500';
 state:=public.goal_planning_state(w,100,'civil','month',preview);
 assert state->'months'->0->>'first_pressure_on'=current_date::text;
 perform set_config('role','none',true);
 update public.financial_allocations set liquidity_confirmed=false where workspace_id=w and purpose='reserve';
 perform set_config('role','authenticated',true);
 state:=public.goal_planning_state(w,100,'civil','day',preview);
 assert state->>'reserved_cash_cents'='400','Unconfirmed reserve contributed backing';
 -- A past first date keeps the original anchor; skipped intentions do not fulfill targets.
 preview:=pg_temp.goal_preview(w,200,300,private.goal_plan_month_on(current_date,-2));
 state:=public.goal_planning_state(w,100,'civil','day',preview);
 assert (select sum((p->>'planned_cents')::numeric) from jsonb_array_elements(state->'points') p)=1050,'Past intentions treated as paid';
 perform set_config('role','none',true);
 update public.accounts set initial_balance_cents=-10 where id=bank;
 update public.goals set archived=true where id=g1;
 perform set_config('role','authenticated',true);
 state:=public.goal_planning_state(w,1,'civil','day');
 assert jsonb_array_length(state->'goals')=1 and state->>'reserved_cash_cents'='0';
 assert state->'points'->0->>'cash_cents'='-10' and state->>'first_pressure_on'=current_date::text;
 -- Each row can be safe while their combined intentions are unsafe. Reject the
 -- combined response instead of emitting decimal strings JS would round.
 perform set_config('role','none',true);
 update public.goals set archived=false,target_cents=9007199254740991 where workspace_id=w;
 perform set_config('role','authenticated',true);
 select jsonb_build_object('goals_fingerprint',private.goal_planning_fingerprint(w),'items',
  jsonb_agg(jsonb_build_object('goal_id',id,'included',true,'monthly_cents',9007199254740991,'first_on',current_date) order by id))
 into bad from public.goals where workspace_id=w;
 begin perform public.goal_planning_state(w,1,'civil','day',bad);raise exception 'Unsafe sum accepted';
 exception when numeric_value_out_of_range or invalid_parameter_value then null;end;
 assert not has_function_privilege('anon','public.goal_planning_state(uuid,integer,text,text,jsonb)','EXECUTE');
 assert not has_function_privilege('anon','private.goal_plan_month_on(date,integer)','EXECUTE');
end $$;
rollback;
