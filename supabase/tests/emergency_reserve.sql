-- F07: fails if allocation mutates money, overbooks, replays after CAS incorrectly,
-- leaks another workspace, trusts malformed JSON or retains stale month approval.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$ begin
 assert to_regprocedure('public.emergency_reserve_state(uuid,date)') is not null,
   'F07 emergency reserve API missing';
end $$;
create function pg_temp.reject_reserve(p jsonb, code text default '22023') returns void language plpgsql as $$
begin
 begin
  perform public.save_emergency_reserve(p,gen_random_uuid());
 exception when others then
  assert sqlstate=code,format('expected %s got %s: %s',code,sqlstate,sqlerrm);return;
 end;
 raise exception 'Invalid reserve input was accepted: %',p;
end $$;
do $$
declare
 u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); ow uuid:=gen_random_uuid();
 bank uuid:=gen_random_uuid(); card uuid:=gen_random_uuid(); asset uuid:=gen_random_uuid(); foreign_asset uuid:=gen_random_uuid();
 g1 uuid:=gen_random_uuid(); g2 uuid:=gen_random_uuid(); g3 uuid:=gen_random_uuid(); tx uuid; inv uuid; req uuid:=gen_random_uuid(); fake_req uuid:=gen_random_uuid();
 p jsonb; result jsonb; state jsonb; source jsonb; reviews jsonb; bad jsonb; before_money jsonb;
 m date:=(date_trunc('month',current_date)-interval '1 month')::date;
begin
 insert into auth.users(id,email) values(u,'f07-'||u||'@example.invalid'),(outsider,'f07-'||outsider||'@example.invalid');
 insert into public.profiles(id) values(u),(outsider) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F07 isolated'),(ow,outsider,'F07 foreign');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(ow,outsider,'owner');
 insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values(bank,w,u,'Reserve bank','checking',10000);
 insert into public.accounts(id,workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents)
 values(card,w,u,'Reserve card','credit_card',20,28,100000);
 insert into public.assets(id,workspace_id,user_id,name,class,current_value_cents) values
 (asset,w,u,'Reserve asset','investment',10000),(foreign_asset,ow,outsider,'Foreign asset','crypto',20000);
 insert into public.goals(id,workspace_id,user_id,name,target_cents) values(g1,w,u,'Goal one',10000),(g2,w,u,'Goal two',10000),(g3,w,u,'Goal with overbound legacy',10000);
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform public.goal_deposit(g1,5000,current_date);perform public.goal_deposit(g2,2000,current_date);
 -- Two goals compete for this source; remaining unbound amounts are computed per goal.
 insert into public.financial_allocations(workspace_id,user_id,purpose,goal_id,asset_id,amount_cents,liquidity_confirmed)
 values(w,u,'goal',g1,asset,3000,true),(w,u,'goal',g2,asset,2000,true);
 insert into public.financial_allocations(workspace_id,user_id,purpose,goal_id,account_id,amount_cents,liquidity_confirmed)
 values(w,u,'goal',g3,bank,1000,true);
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('role','authenticated',true);
 state:=public.emergency_reserve_state(w,current_date);
 assert state->'config'='null'::jsonb and state->>'unassigned_goals_cents'='2000',state::text;
 assert jsonb_array_length(state->'months')=3;
 assert not exists(select 1 from jsonb_array_elements(state->'sources') x where x->>'id'=card::text or x->>'id'=foreign_asset::text);
 select x into source from jsonb_array_elements(state->'sources') x where x->>'id'=asset::text;
 assert source->>'other_allocated_cents'='5000' and source->>'allocated_cents'='0' and source->'liquidity_confirmed'='false'::jsonb;
 begin perform public.emergency_reserve_state(ow,current_date);raise exception 'foreign workspace leaked';
 exception when insufficient_privilege then null;end;
 begin insert into public.emergency_reserves(workspace_id,user_id,base_mode,manual_monthly_cents,target_months) values(w,u,'manual',100,6);
 raise exception 'direct DML allowed';exception when insufficient_privilege then null;end;
 before_money:=jsonb_build_object('cash',private.cash_total(array[w],current_date),'net',(select to_jsonb(n) from public.net_worth() n),
 'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where workspace_id=w),
 'goals',(select jsonb_agg(to_jsonb(t) order by id) from public.goal_contributions t where workspace_id=w));
 p:=jsonb_build_object('workspace_id',w,'expected_revision',null,'base_mode','manual','manual_monthly_cents',1000,
 'target_months',6,'unassigned_goals_ack_cents',2000,'allocations',jsonb_build_array(jsonb_build_object('kind','asset','id',asset,'amount_cents',4000,'liquidity_confirmed',true)),'reviewed_months','[]'::jsonb);
 foreach bad in array array[
 'null'::jsonb,'[]'::jsonb,'true'::jsonb,p||'{"workspace_id":false}',p||'{"workspace_id":"invalid"}',p||'{"unknown":1}',p-'target_months',p||'{"manual_monthly_cents":0}',p||'{"manual_monthly_cents":-1}',
 p||'{"manual_monthly_cents":1.5}',p||'{"manual_monthly_cents":"1000"}',p||'{"manual_monthly_cents":true}',
 p||'{"manual_monthly_cents":9007199254740992}',p||'{"manual_monthly_cents":9007199254740991}',p||'{"target_months":61}',p||'{"target_months":0}',
 p||'{"expected_revision":0}',p||'{"unassigned_goals_ack_cents":0}',p||'{"allocations":null}',p||'{"reviewed_months":null}',p||'{"allocations":[null]}',p||'{"allocations":[{"kind":"asset","id":"invalid","amount_cents":1,"liquidity_confirmed":true}]}',
 p||jsonb_build_object('allocations',p->'allocations'||p->'allocations'),
 p||jsonb_build_object('allocations',jsonb_build_array(jsonb_build_object('kind','asset','id',foreign_asset,'amount_cents',100,'liquidity_confirmed',true))),
 p||jsonb_build_object('allocations',jsonb_build_array(jsonb_build_object('kind','account','id',card,'amount_cents',100,'liquidity_confirmed',true))),
 p||jsonb_build_object('allocations',jsonb_build_array(jsonb_build_object('kind','asset','id',asset,'amount_cents',6000,'liquidity_confirmed',true))),
 p||jsonb_build_object('allocations',jsonb_build_array(jsonb_build_object('kind','asset','id',asset,'amount_cents',1,'liquidity_confirmed',false))),
 p||'{"reviewed_months":[{"month":"2026-10-02","fingerprint":"x"}]}'
 ] loop perform pg_temp.reject_reserve(bad);end loop;
 -- Generic receipt storage is user writable; it cannot authenticate F07 execution.
 perform private.reserve_payment_request(fake_req,jsonb_build_object('operation','save_emergency_reserve','input',p));
 perform private.finish_payment_request(fake_req,jsonb_build_object('workspace_id',w,'edit_revision',777));
 begin perform public.save_emergency_reserve(p,fake_req);raise exception 'forged generic receipt accepted';
 exception when insufficient_privilege then null;end;
 assert not exists(select 1 from public.emergency_reserves where workspace_id=w),'forged receipt mutated reserve';
 result:=public.save_emergency_reserve(p,req);assert result->>'edit_revision'='1';
 perform private.finish_payment_request(req,jsonb_build_object('workspace_id',ow,'edit_revision',777));
 assert public.save_emergency_reserve(p,req)=result,'mutable generic receipt replaces legitimate confirmation';
 begin perform public.save_emergency_reserve(p||'{"target_months":2}',req);raise exception 'sealed intent mismatch accepted';
 exception when invalid_parameter_value then null;end;
 assert public.save_emergency_reserve(p,req)=result,'receipt must replay before CAS';
 perform pg_temp.reject_reserve(p,'PT409');
 state:=public.emergency_reserve_state(w,current_date);
 select x into source from jsonb_array_elements(state->'sources') x where x->>'id'=asset::text;
 assert source->>'allocated_cents'='4000' and source->>'effective_cents'='4000';
 assert before_money=jsonb_build_object('cash',private.cash_total(array[w],current_date),'net',(select to_jsonb(n) from public.net_worth() n),
 'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where workspace_id=w),
 'goals',(select jsonb_agg(to_jsonb(t) order by id) from public.goal_contributions t where workspace_id=w)), 'reserve changes financial ledger/balances/net worth';
 -- A changed acknowledged goal total refuses the write atomically.
 perform public.goal_deposit(g1,1,current_date);
 perform pg_temp.reject_reserve(p||'{"expected_revision":1}');
 assert (select edit_revision from public.emergency_reserves where workspace_id=w)=1;
 perform public.goal_deposit(g1,-1,current_date);
 -- Current depreciation shares remaining backing proportionally across all purposes.
 update public.assets set current_value_cents=4500 where id=asset;
 state:=public.emergency_reserve_state(w,current_date);
 select x into source from jsonb_array_elements(state->'sources') x where x->>'id'=asset::text;
 assert source->>'effective_cents'='2000' and source->>'other_allocated_cents'='5000';
 update public.assets set archived=true where id=asset;
 state:=public.emergency_reserve_state(w,current_date);
 select x into source from jsonb_array_elements(state->'sources') x where x->>'id'=asset::text;
 assert source->>'effective_cents'='0' and source->'eligible'='false'::jsonb,'invalid linked source disappeared or contributes';
 update public.assets set archived=false,current_value_cents=10000 where id=asset;
 update public.goals set archived=true where id=g1;
 state:=public.emergency_reserve_state(w,current_date);
 assert state->>'unassigned_goals_cents'='0';
 select x into source from jsonb_array_elements(state->'sources') x where x->>'id'=asset::text;
 assert source->>'other_allocated_cents'='2000','archived goal still reserves source';
 -- Explicit zero month reviews accepted; later current-line necessity invalidates fingerprint.
 p:=p||'{"expected_revision":1,"base_mode":"observed","manual_monthly_cents":null,"unassigned_goals_ack_cents":0,"allocations":[]}';
 select jsonb_agg(jsonb_build_object('month',x->>'month','fingerprint',x->>'fingerprint')) into reviews from jsonb_array_elements(state->'months') x;
 p:=p||jsonb_build_object('reviewed_months',reviews);
 perform public.save_emergency_reserve(p,gen_random_uuid());
 state:=public.emergency_reserve_state(w,current_date);
 assert not exists(select 1 from jsonb_array_elements(state->'months') x where x->>'reviewed'<>'true');
 insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,occurred_at,status,expense_necessity,expense_necessity_source)
 values(w,u,'expense',100,'Current classification',m,'cleared','essential','explicit') returning id into tx;
 state:=public.emergency_reserve_state(w,current_date);
 select x into source from jsonb_array_elements(state->'months') x where x->>'month'=m::text;
 assert source->>'expense_count'='1' and source->>'essential_cents'='100' and source->>'reviewed'='false';
 update public.transactions set expense_necessity=null,expense_necessity_source=null where id=tx;
 state:=public.emergency_reserve_state(w,current_date);
 select x into source from jsonb_array_elements(state->'months') x where x->>'month'=m::text;
 assert source->>'unclassified_count'='1' and source->>'unclassified_cents'='100' and source->>'essential_cents'='0';
 p:=p||'{"expected_revision":2}';
 select jsonb_agg(jsonb_build_object('month',x->>'month','fingerprint',x->>'fingerprint')) into reviews from jsonb_array_elements(state->'months') x;
 perform pg_temp.reject_reserve(p||jsonb_build_object('reviewed_months',reviews));
 perform public.save_emergency_reserve(p||'{"reviewed_months":[]}',gen_random_uuid());
 assert not exists(select 1 from public.reserve_month_reviews where workspace_id=w),'omitted reviews not deleted';
 assert (select count(*) from public.financial_allocations where workspace_id=w and purpose='goal')=3,'replacing reserve changes goals';
 -- Card purchases count when pending; future/non-consumption and invoice settlement do not.
 insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,status,expense_necessity,expense_necessity_source)
 values(w,u,'expense',200,'Card happened',card,m,'pending','essential','explicit') returning invoice_id into inv;
 assert inv is not null;
 insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,status,expense_necessity,expense_necessity_source)
 values(w,u,'expense',300,'Scheduled not happened',bank,m,'pending','essential','explicit'),
 (w,u,'expense',400,'Future card',card,current_date+40,'pending','essential','explicit');
 insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,counterparty_account_id,occurred_at,status,pays_invoice_id)
 values(w,u,'transfer',200,'Invoice settlement',bank,card,m,'cleared',inv);
 state:=public.emergency_reserve_state(w,current_date);
 select x into source from jsonb_array_elements(state->'months') x where x->>'month'=m::text;
 assert source->>'expense_count'='2' and source->>'essential_cents'='200' and source->>'unclassified_count'='1',source::text;
 -- Existing snapshots are the truth; updating necessity must not consult historical contract values.
 update public.transactions set expense_necessity='discretionary',expense_necessity_source='explicit' where id=tx;
 state:=public.emergency_reserve_state(w,current_date);
 select x into source from jsonb_array_elements(state->'months') x where x->>'month'=m::text;
 assert source->>'essential_cents'='200' and source->>'unclassified_count'='0';
 p:=p||'{"expected_revision":3}';
 select jsonb_agg(jsonb_build_object('month',x->>'month','fingerprint',x->>'fingerprint')) into reviews from jsonb_array_elements(state->'months') x;
 perform pg_temp.reject_reserve(p||jsonb_build_object('reviewed_months',reviews||reviews));
 perform public.save_emergency_reserve(p||jsonb_build_object('reviewed_months',reviews),gen_random_uuid());
 update public.transactions set description='Only description changed' where id=tx;
 state:=public.emergency_reserve_state(w,current_date);
 assert not exists(select 1 from jsonb_array_elements(state->'months') x where x->>'reviewed'<>'true'),'non-consumption metadata invalidates review';
 delete from public.transactions where id=tx;
 state:=public.emergency_reserve_state(w,current_date);
 select x into source from jsonb_array_elements(state->'months') x where x->>'month'=m::text;
 assert source->>'reviewed'='false','deleting consumption retains review';
 begin perform public.emergency_reserve_state(w,current_date-1);raise exception 'past asset value invented';
 exception when invalid_parameter_value then null;end;
 -- No privilege inherited from PUBLIC, no direct writes to any new table.
 assert not has_function_privilege('anon','public.emergency_reserve_state(uuid,date)','EXECUTE');
 assert not has_function_privilege('anon','public.save_emergency_reserve(jsonb,uuid)','EXECUTE');
 assert not has_table_privilege('authenticated','public.financial_allocations','INSERT');
 assert not has_table_privilege('authenticated','public.reserve_month_reviews','UPDATE');
 assert not has_table_privilege('authenticated','private.emergency_reserve_write_receipts','INSERT');
 assert not has_table_privilege('authenticated','private.emergency_reserve_write_receipts','SELECT');
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 assert (select count(*) from public.emergency_reserves where workspace_id=w)=0,'RLS leaks config';
 assert (select count(*) from public.financial_allocations where workspace_id=w)=0,'RLS leaks sources';
 assert (select count(*) from public.reserve_month_reviews where workspace_id=w)=0,'RLS leaks month reviews';
 perform pg_temp.reject_reserve(p,'42501');
end $$;
-- The exact CAS marker is evidence of non-commit only after the sealed lookup.
-- Exercise an old UUID after a different UUID really advances the reserve revision.
do $$
declare
 u uuid:=gen_random_uuid();w uuid:=gen_random_uuid();a uuid:=gen_random_uuid();
 committed_req uuid:=gen_random_uuid();next_req uuid:=gen_random_uuid();stale_req uuid:=gen_random_uuid();forged_req uuid:=gen_random_uuid();
 original jsonb;next_input jsonb;stale_input jsonb;first_result jsonb;next_result jsonb;before_rows jsonb;after_rows jsonb;
 attempt integer;error_code text;error_message text;
begin
 perform set_config('role','none',true);
 insert into auth.users(id,email) values(u,'f07-cas-'||u||'@example.invalid');
 insert into public.profiles(id) values(u) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F07 sealed CAS');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
 insert into public.assets(id,workspace_id,user_id,name,class,current_value_cents)
 values(a,w,u,'CAS backing','investment',1000);
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
 original:=jsonb_build_object('workspace_id',w,'expected_revision',null,'base_mode','manual','manual_monthly_cents',100,
 'target_months',6,'unassigned_goals_ack_cents',0,'allocations',jsonb_build_array(jsonb_build_object('kind','asset','id',a,'amount_cents',500,'liquidity_confirmed',true)),'reviewed_months','[]'::jsonb);
 first_result:=public.save_emergency_reserve(original,committed_req);
 assert first_result=jsonb_build_object('workspace_id',w,'edit_revision',1);
 next_input:=original||'{"expected_revision":1,"target_months":12}'||jsonb_build_object(
 'allocations',jsonb_build_array(jsonb_build_object('kind','asset','id',a,'amount_cents',750,'liquidity_confirmed',true)),
 'reviewed_months',(select jsonb_agg(jsonb_build_object('month',x->>'month','fingerprint',x->>'fingerprint'))
   from jsonb_array_elements(public.emergency_reserve_state(w,current_date)->'months') x));
 next_result:=public.save_emergency_reserve(next_input,next_req);
 assert next_result=jsonb_build_object('workspace_id',w,'edit_revision',2);
 assert (select target_months=12 and edit_revision=2 from public.emergency_reserves where workspace_id=w);
 assert (select count(*)=1 and sum(amount_cents)=750 from public.financial_allocations where workspace_id=w);
 assert (select count(*)=3 from public.reserve_month_reviews where workspace_id=w);
 -- The user owns generic storage. A sealed replay must ignore even a changed intent/result.
 update private.payment_write_requests set payload='{"forged":true}',result='{"edit_revision":999}'
 where user_id=u and request_id=committed_req;
 assert public.save_emergency_reserve(original,committed_req)=first_result,
 'committed UUID must replay revision 1 before generic lookup and stale-null CAS';
 -- Changing intent under the sealed UUID must refuse before the stale revision branch.
 begin
  perform public.save_emergency_reserve(original||'{"expected_revision":1}',committed_req);
  raise exception 'sealed UUID accepted a changed intent';
 exception when invalid_parameter_value then
  assert sqlerrm='Identificador de requisição reutilizado com dados diferentes';
 end;
 assert public.save_emergency_reserve(next_input,next_req)=next_result,
 'revision-2 UUID must replay despite its now-stale expected revision 1';
 -- A generic-only receipt likewise cannot produce the authenticated CAS marker.
 stale_input:=original||'{"expected_revision":1}';
 perform private.reserve_payment_request(forged_req,jsonb_build_object('operation','save_emergency_reserve','input',stale_input));
 perform private.finish_payment_request(forged_req,jsonb_build_object('workspace_id',w,'edit_revision',999));
 begin
  perform public.save_emergency_reserve(stale_input,forged_req);
  raise exception 'generic-only stale UUID was accepted';
 exception when insufficient_privilege then
  assert sqlerrm='Recibo não confirmado pelo comando da reserva';
 end;
 perform set_config('role','none',true);
 before_rows:=jsonb_build_object(
 'reserve',(select to_jsonb(r) from public.emergency_reserves r where workspace_id=w),
 'allocations',(select jsonb_agg(to_jsonb(r) order by id) from public.financial_allocations r where workspace_id=w),
 'reviews',(select jsonb_agg(to_jsonb(r) order by month) from public.reserve_month_reviews r where workspace_id=w),
 'generic',(select jsonb_agg(to_jsonb(r) order by request_id) from private.payment_write_requests r where user_id=u),
 'sealed',(select jsonb_agg(to_jsonb(r) order by request_id) from private.emergency_reserve_write_receipts r where user_id=u));
 perform set_config('role','authenticated',true);
 -- Repeat the same UUID and exact payload: refusal cannot leave a reserved generic row.
 for attempt in 1..3 loop
  error_code:=null;error_message:=null;
  begin
   perform public.save_emergency_reserve(stale_input,stale_req);
  exception when others then
   get stacked diagnostics error_code=returned_sqlstate,error_message=message_text;
  end;
  assert error_code='PT409' and error_message='Reserva alterada; confira novamente',
   format('stale attempt %s returned %s: %s',attempt,error_code,error_message);
  assert not exists(select 1 from private.payment_write_requests where user_id=u and request_id=stale_req),
   'CAS refusal retained a generic receipt';
 end loop;
 perform set_config('role','none',true);
 assert not exists(select 1 from private.emergency_reserve_write_receipts where user_id=u and request_id=stale_req),
 'CAS refusal retained a sealed receipt';
 after_rows:=jsonb_build_object(
 'reserve',(select to_jsonb(r) from public.emergency_reserves r where workspace_id=w),
 'allocations',(select jsonb_agg(to_jsonb(r) order by id) from public.financial_allocations r where workspace_id=w),
 'reviews',(select jsonb_agg(to_jsonb(r) order by month) from public.reserve_month_reviews r where workspace_id=w),
 'generic',(select jsonb_agg(to_jsonb(r) order by request_id) from private.payment_write_requests r where user_id=u),
 'sealed',(select jsonb_agg(to_jsonb(r) order by request_id) from private.emergency_reserve_write_receipts r where user_id=u));
 assert after_rows=before_rows,'repeated CAS refusal mutated reserve, allocations, reviews or receipts';
 assert not has_table_privilege('authenticated','public.emergency_reserves','UPDATE');
 assert not has_table_privilege('authenticated','public.emergency_reserves','DELETE');
 assert not has_table_privilege('authenticated','private.emergency_reserve_write_receipts','UPDATE');
 assert not has_table_privilege('authenticated','private.emergency_reserve_write_receipts','DELETE');
 assert not has_table_privilege('service_role','private.emergency_reserve_write_receipts','INSERT');
end $$;
-- Safe-cent boundary plus service-level source/goal/workspace FK invariants.
do $$
declare
 u uuid:=gen_random_uuid();w uuid:=gen_random_uuid();ow uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();
 p jsonb;s jsonb;r jsonb;
begin
 perform set_config('role','none',true);
 insert into auth.users(id,email) values(u,'f07-max-'||u||'@example.invalid');
 insert into public.profiles(id) values(u) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F07 max'),(ow,u,'F07 cross');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(ow,u,'owner');
 insert into public.assets(id,workspace_id,user_id,name,class,current_value_cents)
 values(a,w,u,'Max','crypto',9007199254740991),(b,ow,u,'Cross','investment',1);
 begin
  insert into public.financial_allocations(workspace_id,user_id,purpose,asset_id,amount_cents)
  values(w,u,'reserve',b,1);
  raise exception 'service cross-workspace allocation accepted';
 exception when check_violation then null;end;
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
 p:=jsonb_build_object('workspace_id',w,'expected_revision',null,'base_mode','manual','manual_monthly_cents',9007199254740991,
 'target_months',1,'unassigned_goals_ack_cents',0,'allocations',jsonb_build_array(jsonb_build_object('kind','asset','id',a,'amount_cents',9007199254740991,'liquidity_confirmed',true)),'reviewed_months','[]'::jsonb);
 r:=public.save_emergency_reserve(p,gen_random_uuid());assert r->>'edit_revision'='1';
 s:=public.emergency_reserve_state(w,current_date);
 assert s->'sources'->0->>'allocated_cents'='9007199254740991' and s->'sources'->0->>'effective_cents'='9007199254740991';
 perform pg_temp.reject_reserve(p||'{"expected_revision":1,"target_months":2}');
 update public.assets set current_value_cents=9007199254740992 where id=a;
 begin perform public.emergency_reserve_state(w,current_date);raise exception 'unsafe current valuation accepted';
 exception when numeric_value_out_of_range then null;end;
 update public.assets set current_value_cents=9007199254740991 where id=a;
 perform set_config('role','none',true);
 insert into public.assets(workspace_id,user_id,name,class,current_value_cents) values(w,u,'Total overflow','equity',1);
 perform set_config('role','authenticated',true);
 begin perform public.emergency_reserve_state(w,current_date);raise exception 'unsafe candidate total accepted';
 exception when numeric_value_out_of_range then null;end;
end $$;
-- Account backing must use actual cleared account cash: no pending or accountless money.
do $$
declare u uuid:=gen_random_uuid();w uuid:=gen_random_uuid();a uuid:=gen_random_uuid();p jsonb;s jsonb;
begin
 perform set_config('role','none',true);
 insert into auth.users(id,email) values(u,'f07-cash-'||u||'@example.invalid');
 insert into public.profiles(id) values(u) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F07 account cash');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
 insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values(a,w,u,'Actual account','checking',2000);
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
 insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,status)
 values(w,u,'income',300,'Cleared actual',a,current_date,'cleared'),
 (w,u,'expense',100,'Cleared actual expense',a,current_date,'cleared'),
 (w,u,'income',5000,'Future expectation',a,current_date+40,'pending'),
 (w,u,'income',999,'No account',null,current_date,'cleared');
 s:=public.emergency_reserve_state(w,current_date);
 assert s->'sources'->0->>'available_cents'='2200';
 p:=jsonb_build_object('workspace_id',w,'expected_revision',null,'base_mode','manual','manual_monthly_cents',100,
 'target_months',6,'unassigned_goals_ack_cents',0,'allocations',jsonb_build_array(jsonb_build_object('kind','account','id',a,'amount_cents',2200,'liquidity_confirmed',true)),'reviewed_months','[]'::jsonb);
 perform public.save_emergency_reserve(p,gen_random_uuid());
 s:=public.emergency_reserve_state(w,current_date);assert s->'sources'->0->>'effective_cents'='2200';
 perform pg_temp.reject_reserve(p||'{"expected_revision":1}'||jsonb_build_object('allocations',jsonb_build_array(jsonb_build_object('kind','account','id',a,'amount_cents',2201,'liquidity_confirmed',true))));
 perform set_config('role','none',true);
 update public.financial_allocations set liquidity_confirmed=false where workspace_id=w and purpose='reserve';
 perform set_config('role','authenticated',true);
 s:=public.emergency_reserve_state(w,current_date);assert s->'sources'->0->>'effective_cents'='0','unconfirmed source counted as liquid';
end $$;
rollback;

-- Terminal recovery uses an isolated fixture and always rolls back with the runner.
begin;
set local timezone to 'America/Sao_Paulo';
create function pg_temp.reject_reserve_resolution(p jsonb,req uuid,code text default '22023')
returns void language plpgsql as $$
begin
 begin
  perform public.resolve_emergency_reserve_attempt(p,req);
 exception when others then
  assert sqlstate=code,format('expected %s got %s: %s',code,sqlstate,sqlerrm);return;
 end;
 raise exception 'Invalid reserve resolution was accepted';
end $$;
do $$
declare
 u uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();w uuid:=gen_random_uuid();ow uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid();cancel_req uuid:=gen_random_uuid();saved_req uuid:=gen_random_uuid();advance_req uuid:=gen_random_uuid();
 p jsonb;corrected jsonb;advanced jsonb;cancelled jsonb;saved jsonb;before_state jsonb;before_cash bigint;before_transactions jsonb;bad jsonb;
begin
 perform set_config('role','none',true);
 assert to_regprocedure('public.resolve_emergency_reserve_attempt(jsonb,uuid)') is not null,'terminal resolver missing';
 assert has_function_privilege('authenticated','public.resolve_emergency_reserve_attempt(jsonb,uuid)','EXECUTE');
 assert has_function_privilege('authenticated','private.resolve_emergency_reserve_attempt(jsonb,uuid)','EXECUTE');
 assert not has_function_privilege('anon','public.resolve_emergency_reserve_attempt(jsonb,uuid)','EXECUTE');
 assert not has_function_privilege('anon','private.resolve_emergency_reserve_attempt(jsonb,uuid)','EXECUTE');
 assert not has_function_privilege('service_role','public.resolve_emergency_reserve_attempt(jsonb,uuid)','EXECUTE');
 assert not has_function_privilege('authenticated','public.resolve_emergency_reserve_attempt(jsonb,uuid)','EXECUTE WITH GRANT OPTION');
 assert not has_table_privilege('authenticated','private.emergency_reserve_write_receipts','SELECT');
 assert not has_table_privilege('service_role','private.emergency_reserve_write_receipts','SELECT');
 insert into auth.users(id,email) values(u,'f07-resolve-'||u||'@example.invalid'),(outsider,'f07-resolve-'||outsider||'@example.invalid');
 insert into public.profiles(id) values(u),(outsider) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F07 terminal resolution'),(ow,outsider,'F07 terminal foreign');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(ow,outsider,'owner');
 insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values(a,w,u,'Terminal source','checking',10000);
 p:=jsonb_build_object('workspace_id',w,'expected_revision',null,'base_mode','manual','manual_monthly_cents',1000,
  'target_months',6,'unassigned_goals_ack_cents',0,'allocations',jsonb_build_array(jsonb_build_object('kind','account','id',a,'amount_cents',5000,'liquidity_confirmed',true)),
  'reviewed_months','[]'::jsonb);
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
 insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,status)
 values(w,u,'income',100,'Terminal unchanged ledger',a,current_date,'cleared');
 before_state:=public.emergency_reserve_state(w,current_date);
 before_cash:=private.cash_total(array[w],current_date);
 select jsonb_agg(to_jsonb(t) order by id) into before_transactions from public.transactions t where workspace_id=w;
 foreach bad in array array['null'::jsonb,'[]'::jsonb,p-'target_months',p||'{"extra":true}',p||'{"workspace_id":false}',p||'{"workspace_id":"invalid"}'] loop
  perform pg_temp.reject_reserve_resolution(bad,gen_random_uuid());
 end loop;
 perform pg_temp.reject_reserve_resolution(p,null);
 perform pg_temp.reject_reserve_resolution(p||jsonb_build_object('workspace_id',ow),gen_random_uuid(),'42501');
 perform set_config('request.jwt.claim.sub','',true);
 perform pg_temp.reject_reserve_resolution(p,gen_random_uuid(),'42501');
 perform set_config('request.jwt.claim.sub',u::text,true);

 -- Cancellation wins before the original arrives: save must return the terminal seal.
 cancelled:=public.resolve_emergency_reserve_attempt(p,cancel_req);
 assert cancelled=jsonb_build_object('workspace_id',w,'cancelled',true),'cancellation result must be exact';
 assert public.resolve_emergency_reserve_attempt(p,cancel_req)=cancelled,'cancel replay changed result';
 assert public.save_emergency_reserve(p,cancel_req)=cancelled,'delayed original ignored cancellation';
 assert public.emergency_reserve_state(w,current_date)=before_state,'cancellation mutated reserve/config/sources/reviews';
 assert private.cash_total(array[w],current_date)=before_cash,'cancellation changed cash';
 assert (select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where workspace_id=w)=before_transactions,'cancellation changed ledger';
 perform pg_temp.reject_reserve_resolution(p||'{"target_months":7}',cancel_req);
 begin
  perform public.save_emergency_reserve(p||'{"target_months":7}',cancel_req);
  raise exception 'cancelled identity accepted changed save payload';
 exception when sqlstate '22023' then null;end;
 perform set_config('role','none',true);
 assert not exists(select 1 from private.payment_write_requests where user_id=u and request_id=cancel_req),'resolve touched generic receipt';
 assert not exists(select 1 from public.emergency_reserves where workspace_id=w),'cancel created configuration';
 assert not exists(select 1 from public.financial_allocations where workspace_id=w),'cancel created allocations';
 assert not exists(select 1 from public.reserve_month_reviews where workspace_id=w),'cancel created month reviews';
 perform set_config('role','authenticated',true);
 -- Caller-writable generic success cannot override cancellation or be rewritten by resolve.
 perform private.reserve_payment_request(cancel_req,jsonb_build_object('operation','save_emergency_reserve','input',p));
 perform private.finish_payment_request(cancel_req,jsonb_build_object('workspace_id',w,'edit_revision',777));
 assert public.resolve_emergency_reserve_attempt(p,cancel_req)=cancelled,'generic success overrode terminal cancel';
 assert public.save_emergency_reserve(p,cancel_req)=cancelled,'generic success revived delayed original';
 perform set_config('role','none',true);
 assert (select result from private.payment_write_requests where user_id=u and request_id=cancel_req)
  =jsonb_build_object('workspace_id',w,'edit_revision',777),'resolver changed caller-writable generic receipt';
 perform set_config('role','authenticated',true);

 -- A corrected identity commits once; the old identity remains terminal after CAS changes.
 corrected:=p||'{"target_months":7}';
 saved:=public.save_emergency_reserve(corrected,saved_req);
 assert saved=jsonb_build_object('workspace_id',w,'edit_revision',1),'corrected identity did not save';
 assert public.save_emergency_reserve(corrected,saved_req)=saved,'corrected save was not idempotent';
 assert public.resolve_emergency_reserve_attempt(corrected,saved_req)=saved,'resolver changed committed success';
 advanced:=corrected||'{"expected_revision":1,"target_months":8}';
 assert public.save_emergency_reserve(advanced,advance_req)=jsonb_build_object('workspace_id',w,'edit_revision',2);
 before_state:=public.emergency_reserve_state(w,current_date);
 assert public.resolve_emergency_reserve_attempt(corrected,saved_req)=saved,'later revision replaced sealed success';
 assert public.save_emergency_reserve(p,cancel_req)=cancelled,'later revision revived cancelled identity';
 assert public.resolve_emergency_reserve_attempt(p,cancel_req)=cancelled,'later revision changed cancellation';
 assert public.emergency_reserve_state(w,current_date)=before_state,'terminal replay changed current state';
 perform pg_temp.reject_reserve_resolution(corrected||'{"target_months":9}',saved_req);

 -- Receipts remain inaccessible without this workspace membership, even for replay.
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 perform pg_temp.reject_reserve_resolution(p,cancel_req,'42501');
 perform pg_temp.reject_reserve_resolution(corrected,saved_req,'42501');
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('role','none',true);
 delete from public.workspace_members where workspace_id=w and user_id=u;
 perform set_config('role','authenticated',true);
 perform pg_temp.reject_reserve_resolution(p,cancel_req,'42501');
end $$;
rollback;
