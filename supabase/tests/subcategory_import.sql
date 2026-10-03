-- F09 imports and rules: isolated fixtures, all financial/catalog effects roll back.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$
declare
 u uuid:='00000000-0000-0000-0000-00000000f941';
 w uuid:='00000000-0000-0000-0000-00000000f942';
 w2 uuid:='00000000-0000-0000-0000-00000000f943';
 bank uuid:='00000000-0000-0000-0000-00000000f944';
 card uuid:='00000000-0000-0000-0000-00000000f945';
 child uuid:='00000000-0000-0000-0000-00000000f946';
 other_child uuid:='00000000-0000-0000-0000-00000000f947';
 foreign_child uuid:='00000000-0000-0000-0000-00000000f948';
 batch uuid;item uuid;item2 uuid;tx uuid;plan uuid;adopt uuid;rule_id uuid;
 n bigint;mode int;got uuid;when_first date:=(date_trunc('month',current_date)+interval '10 days')::date;
begin
 insert into auth.users(id,email) values(u,'subcategory-import@example.invalid');
 insert into public.profiles(id) values(u) on conflict do nothing;
 insert into public.workspaces(id,owner_id,name) values(w,u,'F09 import QA'),(w2,u,'F09 import other');
 insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(w2,u,'owner');
 insert into public.accounts(id,workspace_id,user_id,name,type) values(bank,w,u,'F09 import bank','checking');
 insert into public.accounts(id,workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents)
  values(card,w,u,'F09 import card','credit_card',20,28,100000);
 insert into public.subcategories(id,workspace_id,user_id,parent_category,name) values
  (child,w,u,'alimentação','mercado'),(other_child,w,u,'alimentação','café'),(foreign_child,w2,u,'alimentação','mercado');
 insert into public.categorization_rules(workspace_id,user_id,pattern,category,subcategory_id)
  values(w,u,'F09 mercado','alimentação',child) returning id into rule_id;
 select subcategory_id into got from private.match_rule_subcategory(w,'F09 mercado');
 assert got=child,'service rule did not return chosen detail';
 assert not exists(select 1 from private.match_rule_subcategory(w2,'F09 mercado')),'rule crossed workspace';
 perform set_config('request.jwt.claim.sub',u::text,true);

 batch:=gen_random_uuid();item:=gen_random_uuid();
 insert into public.import_batches(id,workspace_id,user_id,source,account_id) values(batch,w,u,'csv',bank);
 insert into public.import_items(id,batch_id,workspace_id,amount_cents,occurred_at,description,dedupe_hash)
  values(item,batch,w,101,current_date,'F09 mercado',item::text);
 perform public._prepare_import_batch(batch);
 assert (select suggested_category='alimentação' and suggested_subcategory_id=child and suggested_subcategory_set
  from public.import_items where id=item),'SQL preparation discarded rule detail';
 perform set_config('role','authenticated',true);
 assert public.finish_import_batch(batch,array[item])=1;
 select transaction_id into tx from public.import_items where id=item;
 assert (select amount_cents=101 and subcategory_id=child and subcategory_snapshot_set from public.transactions where id=tx);
 select count(*) into n from public.transactions;
 assert public.finish_import_batch(batch,array[item])=0;
 assert (select count(*) from public.transactions)=n,'done retry duplicated transaction';

 -- Legacy approve remains optional, adopts detail, and an item replay returns zero.
 batch:=gen_random_uuid();item:=gen_random_uuid();item2:=gen_random_uuid();
 insert into public.import_batches(id,workspace_id,user_id,source,account_id) values(batch,w,u,'csv',bank);
 insert into public.import_items(id,batch_id,workspace_id,amount_cents,occurred_at,dedupe_hash,suggested_category,suggested_subcategory_id)
  values(item,batch,w,202,current_date,item::text,'alimentação',child),
        (item2,batch,w,303,current_date,item2::text,'alimentação',null);
 assert public.approve_import_items(array[item,item2])=2;
 assert public.approve_import_items(array[item,item2])=0;
 assert (select t.subcategory_id=child from public.transactions t join public.import_items i on i.transaction_id=t.id where i.id=item);
 assert (select t.subcategory_id is null from public.transactions t join public.import_items i on i.transaction_id=t.id where i.id=item2),'legacy null invented detail';

 -- Previous installments are adopted by ID. Legacy null preserves existing child;
 -- explicit null removes it; a proven suggestion replaces it. New lines inherit the plan.
 for mode in 1..3 loop
  batch:=gen_random_uuid();item:=gen_random_uuid();adopt:=gen_random_uuid();
  insert into public.transactions(id,workspace_id,user_id,kind,amount_cents,category,subcategory_id,description,
   account_id,occurred_at,status,source)
   values(adopt,w,u,'expense',201,'alimentação',child,'F09 adopt '||mode,card,when_first,'cleared','app');
  insert into public.import_batches(id,workspace_id,user_id,source,account_id) values(batch,w,u,'csv',card);
  insert into public.import_items(id,batch_id,workspace_id,amount_cents,occurred_at,dedupe_hash,merchant,
   suggested_category,suggested_subcategory_id,suggested_subcategory_set,installment_no,installments,adopt_ids)
   values(item,batch,w,201,private.add_months(when_first,1),item::text,'F09 purchase '||mode,
    'alimentação',case when mode=3 then other_child end,mode<>1,2,3,array[adopt]);
  assert public.finish_import_batch(batch,array[item])=1;
  select installment_plan_id into plan from public.transactions where id=adopt;
  assert plan is not null,'previous installment ID not adopted';
  assert (select subcategory_id is not distinct from case when mode=1 then child when mode=3 then other_child end
   from public.transactions where id=adopt),'adoption changed chosen detail incorrectly';
  assert (select sum(amount_cents)=603 and count(*)=3 from public.transactions where installment_plan_id=plan),'money/installments changed';
  assert (select bool_and(subcategory_id is not distinct from case when mode=3 then other_child end)
   from public.transactions where installment_plan_id=plan and id<>adopt),'new installments did not copy suggestion';
 end loop;

 -- Foreign workspace/parent references refuse before any financial write.
 batch:=gen_random_uuid();item:=gen_random_uuid();item2:=gen_random_uuid();
 insert into public.import_batches(id,workspace_id,user_id,source,account_id) values(batch,w,u,'csv',bank);
 insert into public.import_items(id,batch_id,workspace_id,amount_cents,occurred_at,dedupe_hash,suggested_category,suggested_subcategory_id)
  values(item,batch,w,111,current_date-1,item::text,'alimentação',null),
        (item2,batch,w,222,current_date,item2::text,'alimentação',child);
 begin
  update public.import_items set suggested_subcategory_id=foreign_child where id=item;
  raise exception 'cross workspace child accepted';
 exception when invalid_parameter_value then null;end;
 begin
  update public.import_items set suggested_category='saúde',suggested_subcategory_id=other_child where id=item;
  raise exception 'wrong parent child accepted';
 exception when invalid_parameter_value then null;end;
 select count(*) into n from public.transactions;
 -- Simulate a catalog move in the same transaction before sources catch up;
 -- the second item refuses and rolls back the first item created by finish.
 perform set_config('role','postgres',true);
 update public.subcategories set parent_category='saúde' where id=child;
 perform set_config('role','authenticated',true);
 begin
  perform public.finish_import_batch(batch,array[item,item2]);
  raise exception 'invalid stale child accepted by finish';
 exception when invalid_parameter_value then null;end;
 assert (select count(*) from public.transactions)=n,'failed batch partially wrote money';
 assert (select status='review' from public.import_batches where id=batch),'failed batch wrote completion';
 assert (select bool_and(status='pending' and transaction_id is null) from public.import_items where batch_id=batch),'failed batch wrote approval';
 perform set_config('role','postgres',true);
 update public.subcategories set parent_category='alimentação' where id=child;
 set constraints all immediate;
end $$;
rollback;
