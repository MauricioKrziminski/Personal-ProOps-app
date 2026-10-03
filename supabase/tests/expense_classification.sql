-- F06 foundation: snapshots are optional metadata, never live category inference.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$ begin
  assert exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='transactions' and column_name='expense_pattern'),
    'F06 expense classification snapshots are missing';
end $$;
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000f601';
  w uuid := '00000000-0000-0000-0000-00000000f602';
  bank uuid := '00000000-0000-0000-0000-00000000f603';
  tx uuid; series uuid; debt uuid; plan uuid; revision bigint;
  before_money jsonb; c jsonb; first_date date:=current_date+40;
begin
  insert into auth.users(id,email) values(u,'classification-foundation@example.invalid');
  insert into public.profiles(id) values(u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name,created_at) values(w,u,'F06 snapshot QA',now()-interval '2 days');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type) values(bank,w,u,'F06 bank','checking');
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);
  insert into public.categories(user_id,name,default_expense_pattern,default_expense_necessity)
    values(u,'f06 fixed','fixed','essential');
  insert into public.transactions(user_id,kind,amount_cents,description,account_id,category,occurred_at)
    values(u,'expense',125,'No evidence',bank,'f06 fixed',current_date) returning id into tx;
  assert (select expense_pattern is null and expense_pattern_source is null and expense_necessity is null
    and expense_necessity_source is null from public.transactions where id=tx),
    'legacy/agent creation must not infer current category defaults';
  select to_jsonb(t)-array['expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source',
    'edit_revision','updated_at'] into before_money from public.transactions t where id=tx;
  perform private.apply_expense_classification('transactions',array[tx],
    '{"expense_pattern":"fixed","expense_pattern_source":"explicit","expense_necessity":"essential","expense_necessity_source":"category_default"}');
  assert (select to_jsonb(t)-array['expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source',
    'edit_revision','updated_at'] from public.transactions t where id=tx)=before_money,
    'classification changed financial data';
  perform private.apply_expense_classification('transactions',array[tx],
    '{"expense_pattern":null,"expense_pattern_source":"explicit"}');
  assert (select expense_pattern is null and expense_pattern_source='explicit' and expense_necessity='essential'
    from public.transactions where id=tx),'explicit null erased another dimension';
  begin
    update public.transactions set expense_pattern='fixed',expense_pattern_source=null where id=tx;
    raise exception 'known value without provenance accepted';
  exception when check_violation then null;
  end;
  begin
    update public.transactions set expense_pattern=null,expense_pattern_source='category_default' where id=tx;
    raise exception 'null category suggestion accepted';
  exception when check_violation then null;
  end;
  begin
    perform private.apply_expense_classification('transactions',array[tx],'{"expense_pattern":"variable"}');
    raise exception 'half pair accepted';
  exception when others then
    if sqlerrm='half pair accepted' then raise; end if;
    assert sqlerrm like '%Classificação%',sqlerrm;
  end;
  update public.transactions set kind='income' where id=tx;
  assert (select expense_pattern_source is null and expense_necessity is null from public.transactions where id=tx),
    'changing kind preserved expense metadata';
  begin
    perform private.apply_expense_classification('transactions',array[tx],
      '{"expense_pattern":"fixed","expense_pattern_source":"explicit"}');
    raise exception 'income classified as spending';
  exception when check_violation then null;
  end;

  -- Creation snapshot comes from a proven contract, not a category on read.
  insert into public.recurring_transactions(user_id,kind,amount_cents,description,account_id,category,
    rrule,next_run_at,dtstart,expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source)
    values(u,'expense',300,'F06 temporal',bank,'f06 fixed','FREQ=MONTHLY;BYMONTHDAY=15',first_date,
      first_date,'fixed','explicit','essential','category_default') returning id into series;
  c:=private.recurring_expense_classification_at(series,first_date);
  assert c->>'expense_pattern'='fixed' and c->>'expense_necessity'='essential','creation history lost snapshot';
  perform private.apply_recurring_expense_classification(series,'{}'::uuid[],
    '{"expense_pattern":"variable","expense_pattern_source":"explicit"}',first_date+30,false);
  assert private.recurring_expense_classification_at(series,first_date)->>'expense_pattern'='fixed',
    'future edit rewrote historical classification';
  assert private.recurring_expense_classification_at(series,first_date+30)->>'expense_pattern'='variable';
  assert private.recurring_expense_classification_at(series,first_date+30)->>'expense_necessity'='essential';
  insert into public.transactions(user_id,kind,amount_cents,description,account_id,occurred_at,recurring_id)
    values(u,'expense',300,'Historical materialization',bank,first_date,series) returning id into tx;
  assert (select expense_pattern='fixed' and expense_necessity='essential' from public.transactions where id=tx),
    'materialization used current parent instead of dated snapshot';
  -- A calendar/description split must preserve temporal classification and payment metadata.
  update public.recurring_transactions set description='F06 calendar edit' where id=series;
  assert private.recurring_expense_classification_at(series,first_date)->>'expense_pattern'='fixed',
    'financial edit rewrote historical classification';
  assert private.recurring_expense_classification_at(series,first_date+30)->>'expense_pattern'='variable',
    'financial edit discarded future classification';

  insert into public.installment_plans(user_id,account_id,total_cents,installments,first_occurred_at,description,
    expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source)
    values(u,bank,900,3,first_date,'F06 plan','variable','explicit','discretionary','explicit') returning id into plan;
  insert into public.transactions(user_id,kind,amount_cents,description,account_id,occurred_at,installment_plan_id,installment_no)
    values(u,'expense',300,'F06 child',bank,first_date,plan,1) returning id into tx;
  assert (select expense_pattern='variable' and expense_necessity='discretionary' from public.transactions where id=tx);
  insert into public.transactions(user_id,kind,amount_cents,description,account_id,occurred_at,installment_plan_id,installment_no,
    expense_pattern,expense_pattern_source)
    values(u,'expense',300,'F06 explicit unknown child',bank,first_date+30,plan,2,null,'explicit') returning id into tx;
  assert (select expense_pattern is null and expense_pattern_source='explicit' and expense_necessity='discretionary'
    from public.transactions where id=tx),'inheritance replaced explicit unknown';

  insert into public.debts(user_id,kind,name,principal_cents,remaining_cents,account_id,installments,installments_paid,
    installment_cents,first_due_date,expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source)
    values(u,'loan','F06 debt',600,600,bank,3,0,200,first_date,'fixed','explicit','essential','explicit') returning id into debt;
  insert into public.debt_installment_edits(debt_id,installment_no,expense_pattern_set,expense_pattern,expense_pattern_source)
    values(debt,2,true,null,'explicit');
  c:=private.debt_expense_classification_at(debt,2);
  assert c->'expense_pattern'='null'::jsonb and c->>'expense_pattern_source'='explicit'
    and c->>'expense_necessity'='essential','numbered override erased unrelated necessity';
  assert private.debt_expense_classification_at(debt,1)->>'expense_pattern'='fixed';
  assert private.debt_expense_classification_at(gen_random_uuid(),1) is null,'unknown parent invented proof';
  raise notice 'F06 foundation: constraints, legacy, neutral money, temporal inheritance and numbered exceptions passed';
end $$;
rollback;
