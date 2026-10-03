-- F09 structural acceptance: authenticated commands, isolated UUIDs, always rollback.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
create function pg_temp.reject_subcategory_command(p jsonb,code text default '22023') returns void language plpgsql as $$
begin
 begin perform public.write_subcategory(p,gen_random_uuid());
 exception when others then assert sqlstate=code,format('%s != %s: %s',sqlstate,code,sqlerrm);return;end;
 raise exception 'Invalid child command accepted';
end $$;
do $$
declare
 u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); foreign_w uuid:=gen_random_uuid();
 req uuid:=gen_random_uuid(); cancel_req uuid:=gen_random_uuid(); forged_req uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid(); tx uuid:=gen_random_uuid(); child uuid; receiver uuid; spare uuid; foreign_child uuid;
 p jsonb; receipt jsonb; before_money jsonb; after_money jsonb; revision bigint;
begin
 insert into auth.users(id,email) values(u,'f09-write-'||u||'@example.invalid'),(outsider,'f09-other-'||outsider||'@example.invalid');
 insert into public.profiles(id) values(u),(outsider) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F09 structural'),(foreign_w,outsider,'F09 foreign');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(foreign_w,outsider,'owner');
 insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values(a,w,u,'F09 bank','checking',100000);
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('role','authenticated',true);
 p:=jsonb_build_object('action','save','workspace_id',w,'subcategory_id',null,'expected_revision',null,
  'parent_category','alimentação','name','café','merge_into_id',null,'expected_merge_revision',null);
 receipt:=public.write_subcategory(p,req);child:=(receipt->>'subcategory_id')::uuid;
 assert (select name='café' and parent_category='alimentação' and edit_revision=1 from public.subcategories where id=child),'Successful create did not persist';
 assert receipt->>'edit_revision'='1' and receipt->>'merged'='false' and receipt->>'deleted'='false';
 assert public.write_subcategory(p,req)=receipt,'Create did not replay exact identity';
 perform pg_temp.reject_subcategory_command(p,'PT409');
 perform pg_temp.reject_subcategory_command(p||'{"extra":true}');
 perform pg_temp.reject_subcategory_command(p||'{"subcategory_id":"bad"}');
 perform pg_temp.reject_subcategory_command(p||'{"expected_revision":"1"}');
 perform pg_temp.reject_subcategory_command(p||'{"expected_revision":0}');
 perform pg_temp.reject_subcategory_command(p||'{"expected_revision":9007199254740992}');
 perform pg_temp.reject_subcategory_command(p||'{"name":" "}');
 perform pg_temp.reject_subcategory_command(p||jsonb_build_object('workspace_id',foreign_w),'42501');
 begin perform public.write_subcategory(p||'{"name":"outro"}',req);raise exception 'Changed intent reused UUID';
 exception when invalid_parameter_value then null;end;
 begin perform public.write_subcategory(p,null);raise exception 'Null request accepted';
 exception when invalid_parameter_value then null;end;
 receipt:=public.write_subcategory(p||'{"parent_category":"saúde","name":"consultas"}',gen_random_uuid());receiver:=(receipt->>'subcategory_id')::uuid;
 receipt:=public.write_subcategory(p||'{"name":"restaurante"}',gen_random_uuid());spare:=(receipt->>'subcategory_id')::uuid;
 -- Retrying an edit has to return its committed revision before stale-CAS checks.
 p:=p||jsonb_build_object('subcategory_id',child,'expected_revision',1,'name','cafeteria');req:=gen_random_uuid();
 receipt:=public.write_subcategory(p,req);
 assert receipt->>'edit_revision'='2' and public.write_subcategory(p,req)=receipt;
 perform pg_temp.reject_subcategory_command(p,'PT409');
 -- A caller-written generic receipt never substitutes for command-owned commit.
 p:=p||'{"expected_revision":2}';
 perform private.reserve_payment_request(forged_req,jsonb_build_object('operation','write_subcategory','input',p));
 perform private.finish_payment_request(forged_req,receipt||'{"edit_revision":99}');
 begin perform public.write_subcategory(p,forged_req);raise exception 'Forged generic receipt accepted';
 exception when insufficient_privilege then null;end;
 assert public.resolve_subcategory_attempt(p,cancel_req)=jsonb_build_object('workspace_id',w,'cancelled',true);
 assert public.write_subcategory(p,cancel_req)=jsonb_build_object('workspace_id',w,'cancelled',true),'Late save applied after terminal close';
 assert (select edit_revision from public.subcategories where id=child)=2;
 assert public.resolve_subcategory_attempt(p||'{"expected_revision":1}',req)=receipt,'Resolution did not return actual commit';
 perform set_config('role','none',true);
 insert into public.transactions(id,workspace_id,user_id,kind,amount_cents,category,status,subcategory_id,source,account_id)
  values(tx,w,u,'expense',1250,'alimentação','cleared',child,'app',a);
 update public.accounts set archived=true where id=a;
 before_money:=jsonb_build_object('cash',private.cash_total(array[w],current_date),
  'tx',(select jsonb_agg(jsonb_build_array(id,amount_cents,kind,status,account_id,occurred_at,recurring_id,installment_plan_id,debt_id) order by id)
   from public.transactions where workspace_id=w));
 perform set_config('role','authenticated',true);
 -- Moving metadata must work even after the payment account is archived.
 receipt:=public.write_subcategory(p||'{"parent_category":"saúde"}',gen_random_uuid());
 assert receipt->>'edit_revision'='3' and receipt->>'affected_records'='1';
 assert (select subcategory_id=child and category='saúde' from public.transactions where id=tx),'Move lost identity/parent';
 set constraints all immediate;set constraints all deferred;
 -- Collision requires an explicit receiver and its current revision.
 p:=p||'{"expected_revision":3,"parent_category":"saúde","name":"consultas"}';
 perform pg_temp.reject_subcategory_command(p,'PT409');
 perform pg_temp.reject_subcategory_command(p||jsonb_build_object('merge_into_id',receiver,'expected_merge_revision',0));
 receipt:=public.write_subcategory(p||jsonb_build_object('merge_into_id',receiver,'expected_merge_revision',1),gen_random_uuid());
 assert receipt->>'merged'='true' and receipt->>'subcategory_id'=receiver::text and receipt->>'edit_revision'='2';
 assert not exists(select 1 from public.subcategories where id=child);
 assert (select subcategory_id=receiver and category='saúde' from public.transactions where id=tx),'Merge did not redirect';
 -- Receiver budgets prevail in an existing parent-category merge.
 perform set_config('role','none',true);
 insert into public.budgets(workspace_id,user_id,category,limit_cents,month) values
  (w,u,'alimentação',10000,current_date),(w,u,'saúde',20000,current_date);
 perform set_config('role','authenticated',true);
 receipt:=public.rename_category('alimentação','saúde',true);
 assert receipt->>'orcamentos_descartados'='1';
 assert (select count(*)=1 and min(limit_cents)=20000 from public.budgets where workspace_id=w and category='saúde');
 assert (select parent_category='saúde' from public.subcategories where id=spare),'Parent rename omitted unused child';
 -- Deleting only the child retains the paid row, its category and the ledger.
 receipt:=public.write_subcategory(jsonb_build_object('action','delete','workspace_id',w,'subcategory_id',receiver,'expected_revision',2),gen_random_uuid());
 assert receipt->>'deleted'='true' and receipt->'edit_revision'='null'::jsonb;
 assert (select subcategory_id is null and category='saúde' from public.transactions where id=tx),'Delete removed history/parent';
 after_money:=jsonb_build_object('cash',private.cash_total(array[w],current_date),
  'tx',(select jsonb_agg(jsonb_build_array(id,amount_cents,kind,status,account_id,occurred_at,recurring_id,installment_plan_id,debt_id) order by id)
   from public.transactions where workspace_id=w));
 assert before_money=after_money,'Structural metadata changed money or financial identity';
 perform public.delete_category('saúde');
 assert not exists(select 1 from public.subcategories where workspace_id=w),'Parent delete retained children';
 assert (select category is null and subcategory_id is null and amount_cents=1250 from public.transactions where id=tx),'Parent delete damaged financial record';
 set constraints all immediate;
end $$;
rollback;
