-- F01: a newly materialized occurrence uses its historical payment snapshot.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000f161';
  w uuid := '00000000-0000-0000-0000-00000000f162';
  bank uuid := '00000000-0000-0000-0000-00000000f163';
  first_day date := current_date;
  second_day date := private.add_months(current_date,1);
  third_day date := private.add_months(current_date,2);
  series uuid; tx uuid; tx2 uuid; tx3 uuid; adopted uuid; legacy_series uuid;
  result jsonb; revision bigint;
begin
  insert into auth.users(id,email) values(u,'materialize-payment@example.invalid');
  insert into public.profiles(id) values(u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name,created_at) values(w,u,'F01 materialize QA',now()-interval '2 days');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type) values(bank,w,u,'F01 bank','checking');
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);
  result := public.create_recurring_payment(jsonb_build_object(
    'kind','expense','amount_cents',1234,'description','F01 materialized payment','account_id',bank,
    'payment_method','boleto','rrule','FREQ=MONTHLY;BYMONTHDAY='||extract(day from first_day)::int,
    'next_run_at',first_day::timestamptz,'dtstart',first_day::timestamptz,'auto_confirm',true
  ),gen_random_uuid());
  series := (result->>'id')::uuid;
  tx := public.materialize_recurring_occurrence(series,first_day);
  assert (select payment_method from public.transactions where id=tx)='boleto',
    'new materialized occurrence lost its payment method';
  assert (select amount_cents from public.transactions where id=tx)=1234;
  assert public.materialize_recurring_occurrence(series,first_day)=tx,'materialization replay changed identity';
  assert (select count(*) from public.transactions where recurring_id=series and occurred_at=first_day)=1;
  -- A cleared choice in an already linked occurrence stays unknown on replay.
  update public.transactions set payment_method=null where id=tx;
  assert public.materialize_recurring_occurrence(series,first_day)=tx;
  assert (select payment_method from public.transactions where id=tx) is null,
    'replay inferred an intentionally cleared method';
  -- An existing occurrence is a fact, including its intentional one-off override.
  update public.transactions set payment_method='debit' where id=tx;
  assert public.materialize_recurring_occurrence(series,first_day)=tx;
  assert (select payment_method from public.transactions where id=tx)='debit','replay overwrote existing metadata';
  tx2 := public.materialize_recurring_occurrence(series,second_day);
  assert (select payment_method from public.transactions where id=tx2)='boleto';
  select edit_revision into revision from public.recurring_transactions where id=series;
  perform public.update_recurring_future(tx2,series,'{"payment_method":"pix"}',
    '{"payment_method":"pix"}',revision,gen_random_uuid());
  tx3 := public.materialize_recurring_occurrence(series,third_day);
  assert (select payment_method from public.transactions where id=tx3)='pix','future occurrence used an outdated method';
  assert (select payment_method from public.transactions where id=tx)='debit','future scope rewrote the past';
  assert (select sum(amount_cents) from public.transactions where recurring_id=series)=3702;
  -- Explicitly linking a standalone fact preserves a known override. An unknown
  -- method inherits the new contract choice, without inferring it from the account.
  foreach result in array array['{"description":"F01 adopted known","payment_method":"pix"}'::jsonb,
                               '{"description":"F01 adopted unknown","payment_method":null}'::jsonb] loop
    insert into public.transactions(user_id,workspace_id,kind,amount_cents,description,account_id,occurred_at,payment_method)
      values(u,w,'expense',777,result->>'description',bank,first_day,result->>'payment_method') returning id into adopted;
    legacy_series := (public.create_recurring_payment(jsonb_build_object(
      'kind','expense','amount_cents',777,'description',result->>'description','account_id',bank,
      'payment_method','boleto','rrule','FREQ=MONTHLY;BYMONTHDAY='||extract(day from first_day)::int,
      'next_run_at',first_day::timestamptz,'dtstart',first_day::timestamptz,'auto_confirm',true
    ),gen_random_uuid())->>'id')::uuid;
    assert public.materialize_recurring_occurrence(legacy_series,first_day)=adopted;
    assert (select payment_method from public.transactions where id=adopted)=coalesce(result->>'payment_method','boleto'),
      'adoption lost the known override or explicit contract method';
  end loop;
  legacy_series := (public.create_recurring_payment(jsonb_build_object(
    'kind','expense','amount_cents',888,'description','F01 unknown contract','account_id',bank,
    'rrule','FREQ=MONTHLY;BYMONTHDAY='||extract(day from first_day)::int,
    'next_run_at',first_day::timestamptz,'dtstart',first_day::timestamptz,'auto_confirm',true
  ),gen_random_uuid())->>'id')::uuid;
  adopted := public.materialize_recurring_occurrence(legacy_series,first_day);
  assert (select payment_method from public.transactions where id=adopted) is null,
    'unknown contract guessed a method from its bank account';
  raise notice 'F01 materialization metadata, replay, history and legacy adoption passed';
end $$;
rollback;
