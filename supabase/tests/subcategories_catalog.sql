-- F09 foundation only: isolated UUID fixtures, no live workspace IDs; all rollback.
-- Run as postgres after the catalog migration. Structural RPC acceptance is separate.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
create function pg_temp.reject_subcategory_reference(ws uuid,parent text,child uuid) returns void language plpgsql as $$
begin
 begin
  perform private.validate_subcategory_reference(ws,parent,child);
 exception when invalid_parameter_value then return;
 end;
 raise exception 'Invalid subcategory reference was accepted';
end $$;
do $$
declare
 u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid();
 w uuid:=gen_random_uuid(); w2 uuid:=gen_random_uuid(); foreign_w uuid:=gen_random_uuid();
 child uuid:=gen_random_uuid(); health uuid:=gen_random_uuid(); sibling_ws uuid:=gen_random_uuid(); foreign_child uuid:=gen_random_uuid();
 tx uuid:=gen_random_uuid(); pending_tx uuid:=gen_random_uuid(); legacy_tx uuid:=gen_random_uuid();
 recurring uuid:=gen_random_uuid(); plan uuid:=gen_random_uuid(); debt uuid:=gen_random_uuid();
 rule_id uuid:=gen_random_uuid(); batch uuid:=gen_random_uuid(); item uuid:=gen_random_uuid();
 state jsonb; revision bigint; table_name text; column_name text; schema_name text;
begin
 insert into auth.users(id,email) values(u,'f09-catalog-'||u||'@example.invalid'),(other_u,'f09-catalog-'||other_u||'@example.invalid');
 insert into public.profiles(id) values(u),(other_u) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F09 catalog'),(w2,u,'F09 second member space'),(foreign_w,other_u,'F09 foreign');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(w2,u,'owner'),(foreign_w,other_u,'owner');
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.subcategories(id,workspace_id,user_id,parent_category,name,parent_key,name_key,edit_revision) values
  (child,w,u,' Alimentação ',' Café ','forged','forged',99),
  (health,w,u,'saúde','consultas','forged','forged',99),
  (sibling_ws,w2,u,'alimentação','café','forged','forged',99),
  (foreign_child,foreign_w,other_u,'alimentação','café','forged','forged',99);
 assert (select parent_category='alimentação' and name='café' and parent_key='alimentacao' and name_key='cafe'
  and edit_revision=1 from public.subcategories where id=child),'Server normalization/revision failed';
 begin
  insert into public.subcategories(workspace_id,user_id,parent_category,name) values(w,u,'ALIMENTACAO','CAFE');
  raise exception 'Accent/case namespace collision accepted';
 exception when unique_violation then null; end;
 begin
  insert into public.subcategories(workspace_id,user_id,parent_category,name) values(w,u,'saúde',' ');
  raise exception 'Empty detail accepted';
 exception when check_violation then null; end;
 begin
  insert into public.subcategories(workspace_id,user_id,parent_category,name) values(w,u,'saúde',repeat('á',41));
  raise exception '41 codepoints accepted';
 exception when check_violation then null; end;
 insert into public.subcategories(workspace_id,user_id,parent_category,name) values(w2,u,'saúde',repeat('á',40));
 update public.subcategories set name='cafeteria',edit_revision=999 where id=child;
 assert (select edit_revision=2 and name_key='cafeteria' from public.subcategories where id=child),'Revision was caller-controlled';

 -- Real transaction uses include cleared AND pending rows, without money summation.
 insert into public.transactions(id,workspace_id,user_id,kind,amount_cents,category,status,subcategory_id,source) values
  (tx,w,u,'expense',101,'ALIMENTACAO','cleared',child,'app'),
  (pending_tx,w,u,'expense',9999,'alimentação','pending',child,'app'),
  (legacy_tx,w,u,'expense',100,'alimentação','cleared',null,'app');
 assert (select subcategory_id is null and subcategory_parent_key is null
  from public.transactions where id=legacy_tx),'Legacy null gained detail/snapshot';
 begin
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,category,subcategory_id,source)
   values(w,u,'expense',100,'saúde',child,'app');
  raise exception 'Explicit wrong parent accepted';
 exception when invalid_parameter_value then null; end;
 begin
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,category,subcategory_id,source)
   values(w,u,'expense',100,'alimentação',sibling_ws,'app');
  raise exception 'Explicit cross-member-workspace detail accepted';
 exception when invalid_parameter_value then null; end;
 begin
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,category,subcategory_id,source)
   values(w,u,'expense',100,'alimentação',gen_random_uuid(),'app');
  raise exception 'Unknown explicit detail accepted';
 exception when invalid_parameter_value then null; end;
 update public.transactions set category='Alimentação' where id=tx;
 assert (select subcategory_id=child from public.transactions where id=tx),'Equivalent parent alias lost detail';
 update public.transactions set category='saúde' where id=tx;
 assert (select subcategory_id is null and subcategory_parent_key is null from public.transactions where id=tx),'Legacy parent change retained incompatible detail';
 update public.transactions set category='alimentação',subcategory_id=child where id=tx;
 update public.transactions set workspace_id=w2 where id=tx;
 assert (select subcategory_id is null and subcategory_parent_key is null from public.transactions where id=tx),'Legacy workspace change retained detail';
 update public.transactions set workspace_id=w,subcategory_id=child where id=tx;
 update public.transactions set subcategory_parent_key='forged' where id=tx;
 assert (select subcategory_parent_key='alimentacao' from public.transactions where id=tx),'Derived key could be forged';

 -- Exercise every catalog source, including derived debt exception scope.
 insert into public.recurring_transactions(id,workspace_id,user_id,kind,amount_cents,category,rrule,next_run_at,subcategory_id)
  values(recurring,w,u,'expense',100,'alimentação','FREQ=MONTHLY;BYMONTHDAY=3',now(),child);
 update private.recurring_history_versions set subcategory_id=child where recurring_id=recurring;
 insert into public.installment_plans(id,workspace_id,user_id,category,total_cents,installments,first_occurred_at,subcategory_id)
  values(plan,w,u,'alimentação',1000,2,current_date,child);
 insert into public.debts(id,workspace_id,user_id,name,principal_cents,remaining_cents,payment_category,subcategory_id)
  values(debt,w,u,'F09 debt '||debt,1000,1000,'alimentação',child);
 insert into public.debt_installment_edits(debt_id,installment_no,subcategory_set,subcategory_id)
  values(debt,1,true,child),(debt,2,true,null);
 insert into public.debt_installment_edits(debt_id,installment_no,subcategory_set,subcategory_id,category,category_set)
  values(debt,3,true,health,'saúde',true);
 assert (select subcategory_workspace_id=w and subcategory_parent_key='saude' from public.debt_installment_edits
  where debt_id=debt and installment_no=3),'Debt exception ignored explicit parent snapshot';
 assert (select subcategory_workspace_id=w and subcategory_parent_key='alimentacao' from public.debt_installment_edits
  where debt_id=debt and installment_no=1),'Debt exception scope not derived from linked debt';
 begin
  insert into public.debt_installment_edits(debt_id,installment_no,subcategory_id) values(debt,4,child);
  raise exception 'Debt detail accepted without explicit set flag';
 exception when check_violation then null; end;
 begin
  insert into public.debt_installment_edits(debt_id,installment_no,subcategory_set,subcategory_id,category)
   values(debt,4,true,child,'saúde');
  raise exception 'Debt parent snapshot accepted without set flag';
 exception when check_violation then null; end;
 insert into public.categorization_rules(id,workspace_id,user_id,pattern,category,subcategory_id)
  values(rule_id,w,u,'F09-'||rule_id,'alimentação',child);
 insert into public.import_batches(id,workspace_id,user_id,source) values(batch,w,u,'csv');
 insert into public.import_items(id,batch_id,workspace_id,amount_cents,occurred_at,dedupe_hash,suggested_category,suggested_subcategory_id)
  values(item,batch,w,100,current_date,item::text,'alimentação',child);
 set constraints all immediate;
 set constraints all deferred;

 -- Strict invoker/RLS: member-visible same namespace is still workspace-bound.
 perform set_config('role','authenticated',true);
 assert private.validate_subcategory_reference(w,'ALIMENTAÇÃO',child)=child;
 assert private.validate_subcategory_reference(null,null,null) is null;
 perform pg_temp.reject_subcategory_reference(w,'saúde',child);
 perform pg_temp.reject_subcategory_reference(w,'alimentação',sibling_ws);
 perform pg_temp.reject_subcategory_reference(foreign_w,'alimentação',foreign_child);
 assert not exists(select 1 from public.subcategories where id=foreign_child),'Catalog RLS leaked foreign space';
 state:=public.subcategory_state(w);
 assert (select count(*)=2 from jsonb_object_keys(state)) and state->>'workspace_id'=w::text,'Read model envelope was not closed';
 assert jsonb_array_length(state->'items')=2,'Read model mixed workspaces';
 assert (select x->>'uses'='2' and (select count(*)=6 from jsonb_object_keys(x))
  from jsonb_array_elements(state->'items') x where x->>'id'=child::text),'Read model uses counted money/status or leaked fields';
 assert public.subcategory_state(w2)->>'workspace_id'=w2::text,'Explicit member space was ignored';
 begin perform public.subcategory_state(foreign_w);raise exception 'Read model accepted foreign workspace';
 exception when insufficient_privilege then null;end;
 begin perform public.subcategory_state(null);raise exception 'Read model defaulted null workspace';
 exception when insufficient_privilege then null;end;
 begin update public.subcategories set name='caller' where id=child;raise exception 'Authenticated direct catalog DML allowed';
 exception when insufficient_privilege then null;end;
 assert not has_table_privilege('service_role','public.subcategories','INSERT')
  and not has_table_privilege('service_role','public.subcategories','UPDATE')
  and not has_table_privilege('service_role','public.subcategories','DELETE'),'Service direct catalog DML allowed';
 perform set_config('role','none',true);

 -- Catalog move alone cannot commit dangling namespace references. The FK is
 -- the database oracle even when the catalog UPDATE bypasses caller RLS.
 begin
  update public.subcategories set parent_category='saúde' where id=child;
  set constraints all immediate;
  raise exception 'Unpropagated catalog parent move passed composite FKs';
 exception when foreign_key_violation then null; end;
 assert (select parent_key='alimentacao' from public.subcategories where id=child),'Failed move did not roll back';
 set constraints all deferred;
 select edit_revision into revision from public.subcategories where id=child;
 update public.subcategories set parent_category='saúde' where id=child;
 update public.transactions set category='saúde' where workspace_id=w and subcategory_id=child;
 update public.recurring_transactions set category='saúde' where workspace_id=w and subcategory_id=child;
 update public.installment_plans set category='saúde' where workspace_id=w and subcategory_id=child;
 -- Freeze E's own final parent before changing its template. The financial
 -- adapter intentionally preserves incumbent E snapshots on a legacy D update.
 update public.debt_installment_edits set category='saúde',category_set=true where debt_id=debt and subcategory_id=child;
 update public.debts set payment_category='saúde' where workspace_id=w and subcategory_id=child;
 update public.categorization_rules set category='saúde' where workspace_id=w and subcategory_id=child;
 update private.recurring_history_versions set category='saúde' where workspace_id=w and subcategory_id=child;
 update public.import_items set suggested_category='saúde' where workspace_id=w and suggested_subcategory_id=child;
 set constraints all immediate;
 assert (select edit_revision=revision+1 from public.subcategories where id=child),'Move revision did not advance';
 assert (select subcategory_id=child and subcategory_parent_key='saude' from public.transactions where id=tx),'Atomic parent move lost UUID';
 assert (select subcategory_id=child and subcategory_parent_key='saude' from public.debt_installment_edits
  where debt_id=debt and installment_no=1),'Atomic parent move lost debt exception';
 -- Delete only detail, preserving source rows and their categories/amounts.
 set constraints all deferred;
 delete from public.subcategories where id=child;
 set constraints all immediate;
 assert (select subcategory_id is null and subcategory_parent_key is null and category='saúde' and amount_cents=101
  from public.transactions where id=tx),'Delete changed financial record';
 assert (select subcategory_id is null and subcategory_parent_key is null and subcategory_workspace_id is null and subcategory_set
  and category_set and category='saúde'
  from public.debt_installment_edits where debt_id=debt and installment_no=1),'Delete damaged debt explicit-null state';
 assert (select suggested_subcategory_id is null and suggested_category='saúde' from public.import_items where id=item),'Delete damaged import suggestion';
 for schema_name,table_name,column_name in values
  ('public','transactions','subcategory_id'),('public','recurring_transactions','subcategory_id'),
  ('public','installment_plans','subcategory_id'),('public','debts','subcategory_id'),
  ('public','categorization_rules','subcategory_id'),('private','recurring_history_versions','subcategory_id'),
  ('public','import_items','suggested_subcategory_id'),('public','debt_installment_edits','subcategory_id') loop
  assert exists(select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
   where n.nspname=schema_name and t.relname=table_name and c.contype='f' and c.confrelid='public.subcategories'::regclass
    and c.condeferrable and c.condeferred),'Missing deferred catalog invariant: '||schema_name||'.'||table_name;
 end loop;
end $$;
rollback;
