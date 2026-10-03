-- F06 category configuration/backfill. Fixture-only; runner always rolls back staging.
-- agent/.venv/bin/python scripts/sql-test.py supabase/tests/category_classification_configuration.sql
\set ON_ERROR_STOP on
begin;
set local timezone = 'America/Sao_Paulo';

do $$
declare
  usr uuid := '00000000-0000-0000-0000-00000000f060';
  other_usr uuid := '00000000-0000-0000-0000-00000000f061';
  ws uuid; shared_ws uuid; hidden_ws uuid; a uuid; a2 uuid; ah uuid; own_other uuid; card uuid; inv uuid; payment uuid;
begin
  insert into auth.users(id,email) values
    (usr,'f06-category@example.invalid'),(other_usr,'f06-category-other@example.invalid');
  insert into public.profiles(id) values(usr),(other_usr) on conflict do nothing;
  select id into ws from public.workspaces where owner_id=usr order by created_at limit 1;
  if ws is null then
    insert into public.workspaces(name,owner_id) values('F06 default',usr) returning id into ws;
    insert into public.workspace_members(workspace_id,user_id,role) values(ws,usr,'owner');
  end if;
  insert into public.workspaces(name,owner_id) values('F06 shared',other_usr) returning id into shared_ws;
  insert into public.workspace_members(workspace_id,user_id,role) values(shared_ws,usr,'member');
  insert into public.workspaces(name,owner_id) values('F06 inaccessible',other_usr) returning id into hidden_ws;
  insert into public.accounts(workspace_id,user_id,name,type,initial_balance_cents)
    values(ws,usr,'F06 A','checking',100000) returning id into a;
  insert into public.accounts(workspace_id,user_id,name,type,initial_balance_cents)
    values(shared_ws,other_usr,'F06 B','checking',100000) returning id into a2;
  insert into public.accounts(workspace_id,user_id,name,type,initial_balance_cents)
    values(hidden_ws,other_usr,'F06 H','checking',100000) returning id into ah;
  insert into public.accounts(workspace_id,user_id,name,type,initial_balance_cents)
    values(ws,usr,'F06 own other','checking',0) returning id into own_other;
  insert into public.accounts(workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents)
    values(ws,usr,'F06 card','credit_card',3,10,100000) returning id into card;
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at)
    values(ws,usr,'expense',100,'F06 card purchase',card,date '2026-08-10') returning invoice_id into inv;
  -- Real invoice settlement: it carries pays_invoice_id, while the card purchase above
  -- remains expense consumption. Both the kind and the explicit settlement FK are excluded.
  perform set_config('request.jwt.claim.sub',usr::text,true);
  payment:=public.pay_invoice(inv,a,date '2026-09-10',null);
  update public.transactions set description='F06 invoice settlement',category='f06 antiga' where id=payment;
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,occurred_at,category,
    expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source) values
    (ws,usr,'expense',1000,'F06 unknown',a,date '2026-09-10','f06 antiga',null,null,null,null),
    (ws,usr,'expense',2000,'F06 manual pattern',a,date '2026-09-11','f06 antiga','fixed','explicit','essential','category_default'),
    (ws,usr,'expense',3000,'F06 manual null',a,date '2026-09-12','f06 antiga',null,'explicit','discretionary','explicit'),
    (ws,usr,'expense',4000,'F06 manual necessity',a,date '2026-09-13','f06 antiga','fixed','category_default',null,'explicit'),
    (ws,usr,'expense',5000,'F06 outside',a,date '2026-08-31','f06 antiga','fixed','category_default','essential','category_default'),
    (ws,usr,'income',6000,'F06 income',a,date '2026-09-15','f06 antiga',null,null,null,null),
    (ws,usr,'expense',1200,'F06 virtual',a,date '2026-09-16','f06 virtual',null,null,null,null),
    (ws,usr,'expense',1300,'F06 merge source snapshot',a,date '2026-09-16','f06 merge source','fixed','category_default','essential','category_default'),
    (ws,usr,'expense',1400,'F06 virtual receiver',a,date '2026-09-16','f06 virtual receiver',null,null,null,null),
    (shared_ws,other_usr,'expense',1500,'F06 shared virtual source',a2,date '2026-09-16','f06 merge source','variable','category_default','discretionary','explicit'),
    (shared_ws,other_usr,'expense',1600,'F06 shared virtual receiver',a2,date '2026-09-16','f06 virtual receiver','fixed','explicit',null,'explicit'),
    (shared_ws,other_usr,'expense',7000,'F06 shared row',a2,date '2026-09-10','f06 antiga','fixed','category_default','essential','category_default'),
    (hidden_ws,other_usr,'expense',8000,'F06 hidden row',ah,date '2026-09-10','f06 antiga','fixed','category_default','essential','category_default');
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,account_id,counterparty_account_id,occurred_at,category)
    values(ws,usr,'transfer',900,'F06 transfer',a,own_other,date '2026-09-15','f06 antiga');
  insert into public.recurring_transactions(workspace_id,user_id,kind,amount_cents,description,category,account_id,rrule,next_run_at,dtstart,
      expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source)
    values(ws,usr,'expense',500,'F06 contract','f06 antiga',a,'FREQ=MONTHLY;BYMONTHDAY=10',
      timestamptz '2026-10-10 12:00:00Z',timestamptz '2026-09-10 12:00:00Z','fixed','explicit','essential','category_default');
  insert into public.recurring_transactions(workspace_id,user_id,kind,amount_cents,description,category,account_id,rrule,next_run_at,dtstart,
      expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source)
    values(shared_ws,other_usr,'expense',600,'F06 shared virtual contract','f06 merge source',a2,'FREQ=MONTHLY;BYMONTHDAY=16',
      timestamptz '2026-10-16 12:00:00Z',timestamptz '2026-09-16 12:00:00Z','variable','explicit','essential','category_default');
  insert into public.installment_plans(workspace_id,user_id,account_id,description,category,total_cents,installments,first_occurred_at,
      expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source)
    values(ws,usr,a,'F06 plan','f06 antiga',9000,3,date '2026-09-10','fixed','category_default','essential','explicit');
  -- Existing real child whose classification differs from its unchanged contract snapshot.
  update public.transactions set source='recurring',recurring_id=(select id from public.recurring_transactions
    where workspace_id=ws and description='F06 contract') where workspace_id=ws and description='F06 unknown';
  insert into public.debts(workspace_id,user_id,name,kind,principal_cents,remaining_cents,interest_rate_monthly,payment_category,
      expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source)
    values(ws,usr,'F06 debt','loan',10000,10000,0,'f06 antiga','fixed','category_default','essential','explicit');
  insert into public.budgets(workspace_id,user_id,category,limit_cents,month)
    values(ws,usr,'f06 antiga',10000,null),(ws,usr,'f06 receptora',20000,null);
  insert into public.categories(workspace_id,user_id,name,icon,color,default_expense_pattern,default_expense_necessity)
    values(shared_ws,other_usr,'f06 estrangeira','airplane','terra','fixed','essential'),
      (shared_ws,other_usr,'f06 merge source','film','terra','variable','discretionary'),
      (shared_ws,other_usr,'f06 antiga','cart','musgo','fixed','essential'),
      (shared_ws,other_usr,'f06 receptora','film','violeta','variable','discretionary'),
      (hidden_ws,other_usr,'f06 oculta','airplane','terra','fixed','essential');
  perform set_config('f06.ws',ws::text,true);
  perform set_config('f06.shared_ws',shared_ws::text,true);
  perform set_config('f06.hidden_ws',hidden_ws::text,true);
  -- Values/status/account linkage must survive default changes, backfill and rename.
  perform set_config('f06.money_before',(
    select jsonb_agg(jsonb_build_array(id,amount_cents,status,account_id,counterparty_account_id,occurred_at,kind) order by id)::text
      from public.transactions where workspace_id=ws),true);
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000f060',true);
set local role authenticated;

do $$
declare
  r jsonb; replay jsonb; input jsonb; cid uuid; rev bigint; parent_rev bigint;
  nonce uuid := '00000000-0000-0000-0000-00000000f062';
begin
  if public.my_default_workspace() <> current_setting('f06.ws')::uuid then raise exception 'fixture default workspace'; end if;
  perform set_config('f06.balances_before',(
    select jsonb_agg(to_jsonb(b) order by b.account_id)::text from public.account_balances() b),true);
  input:=jsonb_build_object('name','f06 antiga','icon','cart','color','musgo',
    'default_expense_pattern','fixed','default_expense_necessity','essential');
  r:=public.save_category_configuration(input,nonce);
  cid:=(r->>'configuration_id')::uuid; rev:=(r->>'edit_revision')::bigint;
  if cid is null or rev <> 0 or r->>'default_expense_pattern' <> 'fixed' then raise exception 'creation %',r; end if;
  if exists(select 1 from public.transactions where description='F06 unknown' and expense_pattern is not null)
    then raise exception 'creation rewrote history'; end if;
  begin
    perform public.save_category_configuration(input||'{"name":"f06 created with period","backfill_from":"2026-09-01","backfill_to":"2026-09-30"}',gen_random_uuid());
    raise exception 'creation period accepted';
  exception when invalid_parameter_value then null; end;
  replay:=public.save_category_configuration(input,nonce);
  if replay is distinct from r then raise exception 'creation replay'; end if;
  begin
    perform public.save_category_configuration(input||'{"color":"terra"}',nonce);
    raise exception 'changed nonce payload accepted';
  exception when others then
    if sqlerrm not like 'Identificador de requisição reutilizado%' then raise; end if;
  end;
  begin
    perform public.save_category_configuration(input,gen_random_uuid());
    raise exception 'create overwrote existing configuration';
  exception when others then if sqlerrm not like 'CATEGORIA_CONFIGURACAO_DESATUALIZADA%' then raise; end if; end;

  -- Closed JSON contract, required defaults, JSON types, paired dates, real dates.
  foreach input in array array[
    '{"name":"x","icon":null,"color":null,"default_expense_pattern":null}'::jsonb,
    '{"name":"x","default_expense_pattern":null,"default_expense_necessity":null,"workspace_id":"x"}'::jsonb,
    '{"name":"x","default_expense_pattern":null,"default_expense_necessity":null,"juntar":"true"}'::jsonb,
    '{"name":"x","default_expense_pattern":false,"default_expense_necessity":null}'::jsonb,
    '{"name":"x","default_expense_pattern":null,"default_expense_necessity":null,"category_id":123}'::jsonb,
    '{"name":"x","default_expense_pattern":null,"default_expense_necessity":null,"expected_revision":"0"}'::jsonb,
    '{"name":"x","default_expense_pattern":null,"default_expense_necessity":null,"backfill_from":"2026-09-01"}'::jsonb,
    '{"name":"x","default_expense_pattern":null,"default_expense_necessity":null,"backfill_from":"2026-02-30","backfill_to":"2026-03-01"}'::jsonb
  ] loop
    begin
      perform public.save_category_configuration(input,gen_random_uuid());
      raise exception 'invalid JSON accepted %',input;
    exception when invalid_parameter_value then null; end;
  end loop;

  begin
    perform public.save_category_configuration(jsonb_build_object('name','f06 antiga','category_id',gen_random_uuid(),'expected_revision',0,
      'default_expense_pattern',null,'default_expense_necessity',null),gen_random_uuid());
    raise exception 'missing CAS configuration accepted';
  exception when others then if sqlerrm not like 'CATEGORIA_CONFIGURACAO_DESATUALIZADA%' then raise; end if; end;
  begin
    perform public.save_category_configuration(jsonb_build_object('name','f06 estrangeira',
      'category_id',(select id from public.categories where name='f06 estrangeira'),'expected_revision',0,
      'default_expense_pattern',null,'default_expense_necessity',null),gen_random_uuid());
    raise exception 'shared configuration edited as default';
  exception when others then if sqlerrm not like 'CATEGORIA_CONFIGURACAO_DESATUALIZADA%' then raise; end if; end;
  replay:=public.save_category_configuration('{"name":"f06 virtual nova","rename_from":"f06 virtual","category_id":null,"expected_revision":null,"icon":"cart","color":null,"default_expense_pattern":"variable","default_expense_necessity":null}',gen_random_uuid());
  if replay->>'category'<>'f06 virtual nova' or not exists(select 1 from public.transactions where description='F06 virtual'
      and category='f06 virtual nova' and expense_pattern_source is null) then raise exception 'virtual rename/snapshot'; end if;
  replay:=public.save_category_configuration('{"name":"f06 merge source","icon":"cart","color":"musgo","default_expense_pattern":"fixed","default_expense_necessity":"essential"}',gen_random_uuid());
  replay:=public.save_category_configuration(jsonb_build_object('name','f06 virtual receiver','rename_from','f06 merge source',
    'category_id',replay->>'configuration_id','expected_revision',(replay->>'edit_revision')::bigint,'juntar',true,
    'icon','airplane','color','terra','default_expense_pattern','fixed','default_expense_necessity','essential'),gen_random_uuid());
  if not (replay->>'juntou')::boolean or replay->>'default_expense_pattern' is not null
    or replay->>'default_expense_necessity' is not null then raise exception 'virtual receiver inherited source defaults %',replay; end if;
  if not exists(select 1 from public.categories where id=(replay->>'configuration_id')::uuid and icon='cart' and color='musgo')
    or not exists(select 1 from public.transactions where description='F06 merge source snapshot' and category='f06 virtual receiver'
      and expense_pattern='fixed' and expense_pattern_source='category_default' and expense_necessity='essential')
    then raise exception 'virtual merge appearance/snapshot changed'; end if;
  if not exists(select 1 from public.categories where workspace_id=current_setting('f06.shared_ws')::uuid
      and name='f06 virtual receiver' and icon='film' and color='terra'
      and default_expense_pattern is null and default_expense_necessity is null)
    then raise exception 'shared virtual receiver inherited source defaults or lost appearance'; end if;
  if not exists(select 1 from public.transactions where description='F06 shared virtual source' and category='f06 virtual receiver'
      and expense_pattern='variable' and expense_pattern_source='category_default'
      and expense_necessity='discretionary' and expense_necessity_source='explicit')
    or not exists(select 1 from public.transactions where description='F06 shared virtual receiver' and category='f06 virtual receiver'
      and expense_pattern='fixed' and expense_pattern_source='explicit' and expense_necessity is null and expense_necessity_source='explicit')
    then raise exception 'shared virtual merge changed classification snapshots'; end if;
  if not exists(select 1 from public.recurring_transactions where description='F06 shared virtual contract' and category='f06 virtual receiver'
      and expense_pattern='variable' and expense_pattern_source='explicit'
      and expense_necessity='essential' and expense_necessity_source='category_default')
    or not exists(select 1 from private.recurring_history_versions where workspace_id=current_setting('f06.shared_ws')::uuid
      and category='f06 virtual receiver' and expense_pattern='variable' and expense_pattern_source='explicit'
      and expense_necessity='essential' and expense_necessity_source='category_default')
    then raise exception 'shared virtual merge changed contract/history snapshot'; end if;

  input:=jsonb_build_object('name','f06 nova','rename_from','f06 antiga','icon','tshirt','color','terra',
    'category_id',cid,'expected_revision',rev,'default_expense_pattern','variable','default_expense_necessity','discretionary',
    'backfill_from','2026-09-01','backfill_to','2026-09-30');
  nonce:=gen_random_uuid(); r:=public.save_category_configuration(input,nonce);
  if (r->>'backfill_updated')::int<>3 or r->>'category'<>'f06 nova' or (r->>'juntou')::boolean
    then raise exception 'rename/backfill return %',r; end if;
  if exists(select 1 from public.transactions where category='f06 antiga') then raise exception 'accessible global rename'; end if;
  if not exists(select 1 from public.transactions where description='F06 unknown'
      and expense_pattern='variable' and expense_pattern_source='category_default'
      and expense_necessity='discretionary' and expense_necessity_source='category_default') then raise exception 'unknown defaults'; end if;
  if not exists(select 1 from public.transactions where description='F06 manual pattern' and expense_pattern='fixed'
      and expense_pattern_source='explicit' and expense_necessity='discretionary') then raise exception 'manual pattern protection'; end if;
  if not exists(select 1 from public.transactions where description='F06 manual null' and expense_pattern is null
      and expense_pattern_source='explicit' and expense_necessity='discretionary' and expense_necessity_source='explicit')
    then raise exception 'manual null protection'; end if;
  if not exists(select 1 from public.transactions where description='F06 manual necessity' and expense_pattern='variable'
      and expense_necessity is null and expense_necessity_source='explicit') then raise exception 'manual necessity protection'; end if;
  if exists(select 1 from public.transactions where description in ('F06 outside','F06 shared row') and expense_pattern<>'fixed')
    then raise exception 'date/workspace isolation'; end if;
  if exists(select 1 from public.transactions where kind<>'expense' and (expense_pattern_source is not null or expense_necessity_source is not null))
    then raise exception 'income/transfer classified'; end if;
  if not exists(select 1 from public.transactions where description='F06 invoice settlement' and pays_invoice_id is not null
      and expense_pattern_source is null and expense_necessity_source is null) then raise exception 'invoice settlement classified'; end if;
  if (select limit_cents from public.budgets where category='f06 nova' and workspace_id=public.my_default_workspace() and month is null) <> 10000
    then raise exception 'backfill changed budget'; end if;
  if not exists(select 1 from public.recurring_transactions where description='F06 contract' and category='f06 nova'
      and expense_pattern='fixed' and expense_pattern_source='explicit' and expense_necessity='essential')
    or not exists(select 1 from public.installment_plans where description='F06 plan' and category='f06 nova'
      and expense_pattern='fixed' and expense_necessity_source='explicit')
    or not exists(select 1 from public.debts where name='F06 debt' and payment_category='f06 nova'
      and expense_pattern='fixed' and expense_necessity_source='explicit') then raise exception 'backfill rewrote contracts'; end if;
  replay:=public.save_category_configuration(input,nonce);
  if replay is distinct from r then raise exception 'rename replay before CAS'; end if;
  -- A client can set custom GUCs, but a finished receipt cannot authorize audit writes.
  perform set_config('proops.category_backfill_request',nonce::text,true);
  perform set_config('proops.category_backfill_category','f06 nova',true);
  begin
    update public.transactions set expense_pattern=expense_pattern where description='F06 unknown';
    raise exception 'finished receipt authorized artificial audit context';
  exception when insufficient_privilege then null; end;
  perform set_config('proops.category_backfill_request','',true);
  perform set_config('proops.category_backfill_category','',true);
  begin
    perform public.save_category_configuration(input,gen_random_uuid());
    raise exception 'stale CAS accepted';
  exception when others then if sqlerrm not like 'CATEGORIA_CONFIGURACAO_DESATUALIZADA%' then raise; end if; end;

  rev:=(r->>'edit_revision')::bigint;
  select edit_revision into parent_rev from public.recurring_transactions where description='F06 contract';
  input:=jsonb_build_object('name','f06 nova','icon','tshirt','color','terra','category_id',cid,'expected_revision',rev,
    'default_expense_pattern',null,'default_expense_necessity',null,'backfill_from','2026-09-01','backfill_to','2026-09-30');
  r:=public.save_category_configuration(input,gen_random_uuid()); rev:=(r->>'edit_revision')::bigint;
  if (r->>'backfill_updated')::int<>3 then raise exception 'clear count %',r; end if;
  if not exists(select 1 from public.recurring_transactions where description='F06 contract' and edit_revision>parent_rev
      and expense_pattern='fixed' and expense_pattern_source='explicit'
      and expense_necessity='essential' and expense_necessity_source='category_default')
    then raise exception 'backfill did not invalidate parent revision or changed contract snapshot'; end if;
  if exists(select 1 from public.transactions where description in ('F06 unknown','F06 manual necessity') and expense_pattern_source is not null)
    then raise exception 'category default not cleared'; end if;
  if not exists(select 1 from public.transactions where description='F06 manual pattern' and expense_pattern='fixed'
      and expense_pattern_source='explicit' and expense_necessity is null and expense_necessity_source is null)
    then raise exception 'clear per dimension'; end if;

  -- Appearance may fall back to shared workspace; configuration/defaults may never do so.
  if not exists(select 1 from public.categories_used() where category='f06 estrangeira' and icon='airplane'
      and configuration_id is null and default_expense_pattern is null and default_expense_necessity is null and edit_revision is null)
    then raise exception 'default configuration leaked from shared workspace'; end if;
  if exists(select 1 from public.categories_used() where category='f06 oculta') then raise exception 'inaccessible category leak'; end if;
  if not exists(select 1 from public.categories_used() where category='f06 nova' and configuration_id=cid
      and edit_revision=rev and default_expense_pattern is null) then raise exception 'categories_used config'; end if;

  r:=public.save_category_configuration('{"name":"f06 receptora","icon":"airplane","color":"oceano","default_expense_pattern":"fixed","default_expense_necessity":"essential"}',gen_random_uuid());
  begin
    perform public.save_category_configuration(jsonb_build_object('name','f06 receptora','rename_from','f06 nova','category_id',cid,'expected_revision',rev,'juntar',true,
      'default_expense_pattern','variable','default_expense_necessity','discretionary','backfill_from','2026-09-01','backfill_to','2026-09-30'),gen_random_uuid());
    raise exception 'merge period accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_category_configuration(jsonb_build_object('name','f06 receptora','rename_from','f06 nova','category_id',cid,'expected_revision',rev,
      'icon','cart','color','musgo','default_expense_pattern','variable','default_expense_necessity','discretionary'),gen_random_uuid());
    raise exception 'collision accepted';
  exception when others then if sqlerrm not like 'CATEGORIA_EXISTE: f06 receptora%' then raise; end if; end;
  if not exists(select 1 from public.categories where id=cid and name='f06 nova' and edit_revision=rev)
    then raise exception 'collision partially changed config'; end if;
  r:=public.save_category_configuration(jsonb_build_object('name','f06 receptora','rename_from','f06 nova','category_id',cid,'expected_revision',rev,'juntar',true,
      'icon','cart','color','musgo','default_expense_pattern','variable','default_expense_necessity','discretionary'),gen_random_uuid());
  if not (r->>'juntou')::boolean or (r->>'orcamentos_descartados')::int<>1 or r->>'default_expense_pattern'<>'fixed'
    or not exists(select 1 from public.categories where id=(r->>'configuration_id')::uuid and icon='airplane' and color='oceano')
    then raise exception 'receiver metadata overwritten %',r; end if;
  if not exists(select 1 from public.categories where workspace_id=current_setting('f06.shared_ws')::uuid
      and name='f06 receptora' and icon='film' and color='violeta'
      and default_expense_pattern='variable' and default_expense_necessity='discretionary')
    then raise exception 'shared real receiver lost its own appearance/defaults'; end if;
  if not exists(select 1 from public.transactions where description='F06 shared row' and category='f06 receptora'
      and expense_pattern='fixed' and expense_pattern_source='category_default'
      and expense_necessity='essential' and expense_necessity_source='category_default')
    then raise exception 'shared real receiver merge changed transaction snapshot'; end if;
  if exists(select 1 from public.transactions where description='F06 manual pattern' and expense_pattern<>'fixed') then raise exception 'merge snapshot'; end if;
  perform public.delete_category('f06 receptora');
  if not exists(select 1 from public.transactions where description='F06 manual pattern' and category is null
      and expense_pattern='fixed' and expense_pattern_source='explicit') then raise exception 'delete snapshot'; end if;
  if (select jsonb_agg(jsonb_build_array(id,amount_cents,status,account_id,counterparty_account_id,occurred_at,kind) order by id)::text
      from public.transactions where workspace_id=current_setting('f06.ws')::uuid) <> current_setting('f06.money_before')
    then raise exception 'classification changed money/status/dates'; end if;
  if (select jsonb_agg(to_jsonb(b) order by b.account_id)::text from public.account_balances() b)
      <> current_setting('f06.balances_before') then raise exception 'classification changed actual account balances'; end if;
  begin
    insert into private.category_classification_backfill_audit(request_id,workspace_id,transaction_id,category,period_from,period_to,author_id,before_snapshot,after_snapshot)
      values(gen_random_uuid(),public.my_default_workspace(),gen_random_uuid(),'fake',current_date,current_date,auth.uid(),'{}','{}');
    raise exception 'editable audit';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$
begin
  if (select count(*) from private.category_classification_backfill_audit where author_id='00000000-0000-0000-0000-00000000f060') <> 6
    then raise exception 'audit count'; end if;
  if exists(select 1 from private.category_classification_backfill_audit
      where author_id='00000000-0000-0000-0000-00000000f060' and
        (workspace_id<>current_setting('f06.ws')::uuid or category<>'f06 nova'
         or period_from<>date '2026-09-01' or period_to<>date '2026-09-30'
         or (select count(*) from jsonb_object_keys(before_snapshot))<>4
         or (select count(*) from jsonb_object_keys(after_snapshot))<>4)) then raise exception 'audit scope/snapshot'; end if;
  if not exists(select 1 from private.category_classification_backfill_audit a join public.transactions t on t.id=a.transaction_id
      where t.description='F06 unknown'
        and a.before_snapshot='{"expense_pattern":null,"expense_pattern_source":null,"expense_necessity":null,"expense_necessity_source":null}'::jsonb
        and a.after_snapshot='{"expense_pattern":"variable","expense_pattern_source":"category_default","expense_necessity":"discretionary","expense_necessity_source":"category_default"}'::jsonb)
    then raise exception 'audit real before/after'; end if;
  if not exists(select 1 from public.transactions where description='F06 hidden row' and category='f06 antiga' and expense_pattern='fixed')
    then raise exception 'inaccessible row modified'; end if;
  raise notice 'category_classification_configuration: ok';
end $$;
rollback;
