-- F02: receipts preserve creation identity, not mutable account state or current balance.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000f201';
  w uuid := '00000000-0000-0000-0000-00000000f202';
  other_u uuid := '00000000-0000-0000-0000-00000000f203';
  other_w uuid := '00000000-0000-0000-0000-00000000f204';
  other_bank uuid := '00000000-0000-0000-0000-00000000f205';
  req uuid := gen_random_uuid();
  payload jsonb := '{"name":"F02 Checking","type":"checking","initial_balance_cents":10000}';
  result jsonb; replay jsonb; bad jsonb; card_input jsonb;
  account_id uuid; card_id uuid; archived_payer uuid; attempt uuid; card_request uuid:=gen_random_uuid();
  before_count bigint; before_receipts bigint;
begin
  assert to_regprocedure('public.create_account(jsonb,uuid)') is not null,
    'F02 account creation must expose the idempotent RPC';
  assert not has_function_privilege('anon','public.create_account(jsonb,uuid)','EXECUTE'),
    'anonymous clients can execute account creation';
  insert into auth.users(id,email) values(u,'account-creation@example.invalid'),(other_u,'account-creation-other@example.invalid');
  insert into public.profiles(id) values(u),(other_u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name,created_at) values
    (w,u,'F02 account creation QA',now()-interval '2 days'),
    (other_w,other_u,'F02 foreign workspace',now()-interval '2 days');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(other_w,other_u,'owner');
  insert into public.accounts(id,user_id,workspace_id,name,type) values(other_bank,other_u,other_w,'Foreign payer','checking');
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);
  result := public.create_account(payload,req);
  account_id := (result->>'id')::uuid;
  assert result->>'availability'='active' and result->'account'->>'id'=account_id::text;
  assert (select user_id=u and workspace_id=w and initial_balance_cents=10000 from public.accounts where id=account_id),
    'creation must resolve author/workspace on the server';
  select count(*) into before_count from public.accounts;
  replay := public.create_account(payload,req);
  assert replay=result and (select count(*) from public.accounts)=before_count,'replay duplicated creation';
  assert (select r.result from private.payment_write_requests r where r.user_id=u and r.request_id=req)=jsonb_build_object('id',account_id),
    'receipt must store immutable identity rather than stale row or balance';
  begin
    perform public.create_account(payload||'{"initial_balance_cents":12000}',req);
    raise exception 'changed request payload was accepted';
  exception when others then
    if sqlerrm='changed request payload was accepted' then raise; end if;
    assert sqlerrm like '%dados diferentes%',sqlerrm;
  end;
  begin
    perform public.create_recurring_payment('{}',req);
    raise exception 'cross-operation request reuse was accepted';
  exception when others then
    if sqlerrm='cross-operation request reuse was accepted' then raise; end if;
    assert sqlerrm like '%dados diferentes%',sqlerrm;
  end;
  attempt:=gen_random_uuid();
  begin
    perform public.create_account(payload,attempt);
    raise exception 'equal name silently adopted or duplicated an account';
  exception when unique_violation then null;
  end;
  assert (select count(*) from public.accounts)=before_count;
  assert not exists(select 1 from private.payment_write_requests where user_id=u and request_id=attempt),
    'collision left a receipt reservation despite rollback';
  -- A real ledger write after creation must survive replay without balance retuning.
  insert into public.transactions(user_id,kind,amount_cents,occurred_at,account_id,status)
    values(u,'expense',2000,current_date,account_id,'cleared');
  perform public.create_account(payload,req);
  assert (select initial_balance_cents from public.accounts where id=account_id)=10000;
  assert (select cleared_cents from public.account_balances() where account_balances.account_id=(replay->>'id')::uuid)=8000,
    'replay changed the current balance after a ledger write';
  update public.accounts set name='F02 renamed',initial_balance_cents=15000 where id=account_id;
  replay:=public.create_account(payload,req);
  assert replay->'account'->>'name'='F02 renamed' and (replay->'account'->>'initial_balance_cents')::bigint=15000,
    'replay returned stale creation fields or rewrote a later edit';
  update public.accounts set archived=true where id=account_id;
  replay:=public.create_account(payload,req);
  assert replay->>'availability'='archived' and (replay->'account'->>'archived')::boolean,
    'replay unarchived the original account';
  delete from public.accounts where id=account_id;
  replay:=public.create_account(payload,req);
  assert replay->>'id'=account_id::text and replay->>'availability'='unavailable' and replay->'account'='null'::jsonb,
    'deleted account was recreated or stale account returned';
  assert not exists(select 1 from public.accounts where id=account_id);
  result:=public.create_account('{"name":"F02 overdraft","type":"checking","initial_balance_cents":-5000}',gen_random_uuid());
  assert (result->'account'->>'initial_balance_cents')::bigint=-5000;
  result:=public.create_account('{"name":"F02 long name that remains readable without becoming another account identity repeated repeated repeated repeated","type":"cash","initial_balance_cents":0}',gen_random_uuid());
  assert result->>'availability'='active';
  result:=public.create_account('{"name":"F02 payer","type":"checking","initial_balance_cents":0}',gen_random_uuid());
  account_id:=(result->>'id')::uuid;
  card_input:=jsonb_build_object('name','F02 card','type','credit_card','initial_balance_cents',0,
    'closing_day',31,'due_day',1,'credit_limit_cents',100000,'payment_account_id',account_id,
    'closing_day_inclusive',true,'rotativo_auto',true,'rotativo_rate_monthly',0.155);
  result:=public.create_account(card_input,card_request); card_id:=(result->>'id')::uuid;
  assert (result->'account'->>'closing_day')::int=31 and (result->'account'->>'due_day')::int=1;
  assert (result->'account'->>'payment_account_id')::uuid=account_id;
  -- A new card has no hidden balance field: its seed must be zero, independently of limit.
  attempt:=gen_random_uuid();
  select count(*) into before_count from public.accounts;
  begin
    perform public.create_account(card_input||'{"name":"F02 hidden positive card seed","initial_balance_cents":1}',attempt);
    raise exception 'new card accepted a hidden positive initial balance';
  exception when sqlstate '22023' then null;
  end;
  assert (select count(*) from public.accounts)=before_count,'hidden card seed inserted an account';
  assert not exists(select 1 from private.payment_write_requests where user_id=u and request_id=attempt),
    'hidden card seed validation left a request receipt';
  begin
    perform public.create_account(card_input||'{"name":"F02 hidden negative card seed","initial_balance_cents":-1}',gen_random_uuid());
    raise exception 'new card accepted a hidden negative initial balance';
  exception when sqlstate '22023' then null;
  end;
  archived_payer:=account_id;
  update public.accounts set archived=true where id=archived_payer;
  -- Existing receipts do not revalidate a payer that was valid at creation but changed later.
  replay:=public.create_account(card_input,card_request);
  assert replay->>'availability'='active' and replay->>'id'=card_id::text;
  req:=gen_random_uuid();
  result:=public.create_account(card_input||'{"name":"F02 no payer","payment_account_id":null}',req);
  update public.accounts set type='cash',closing_day=null,due_day=null,credit_limit_cents=null,
    closing_day_inclusive=false,rotativo_auto=false,rotativo_rate_monthly=null where id=(result->>'id')::uuid;
  replay:=public.create_account(card_input||'{"name":"F02 no payer","payment_account_id":null}',req);
  assert replay->'account'->>'type'='cash','replay overwrote current account type';
  -- The supported edit API/schema permits nullable cycle days. Replay returns that current row,
  -- whereas a new card with the same missing days must still fail creation validation below.
  update public.accounts set type='credit_card',closing_day=null,due_day=null
    where id=(result->>'id')::uuid;
  replay:=public.create_account(card_input||'{"name":"F02 no payer","payment_account_id":null}',req);
  assert replay->>'id'=result->>'id' and replay->>'availability'='active'
    and replay->'account'->>'type'='credit_card'
    and replay->'account'->'closing_day'='null'::jsonb and replay->'account'->'due_day'='null'::jsonb,
    'replay rejected or rewrote nullable days allowed by account editing';
  -- Invalid payloads must leave both accounts and receipt registry unchanged.
  select count(*) into before_count from public.accounts;
  select count(*) into before_receipts from private.payment_write_requests where user_id=u;
  foreach bad in array array[
    'null'::jsonb, '[]'::jsonb, '{}', payload||'{"id":"00000000-0000-0000-0000-00000000f209"}',
    payload||jsonb_build_object('user_id',other_u),payload||jsonb_build_object('workspace_id',other_w),
    payload||'{"archived":true}',payload||'{"unknown":1}',payload||'{"name":"  "}',payload||jsonb_build_object('name',E'\t\n  '),payload||'{"name":8}',
    payload||'{"type":"invalid"}',payload||'{"initial_balance_cents":null}',payload||'{"initial_balance_cents":"100"}',
    payload||'{"initial_balance_cents":1.5}',payload||'{"initial_balance_cents":9007199254740992}',
    payload||'{"type":"cash","initial_balance_cents":-1}',payload||'{"closing_day":1}',
    payload||'{"due_day":2}',payload||'{"credit_limit_cents":0}',payload||jsonb_build_object('payment_account_id',archived_payer),
    payload||'{"closing_day_inclusive":true}',payload||'{"rotativo_auto":true}',payload||'{"rotativo_rate_monthly":0.1}',
    card_input-'closing_day',card_input||'{"closing_day":null}',card_input-'due_day',card_input||'{"closing_day":0}',
    card_input||'{"closing_day":32}',card_input||'{"closing_day":1.5}',card_input||'{"due_day":"1"}',
    card_input||'{"credit_limit_cents":-1}',card_input||'{"credit_limit_cents":1.5}',
    card_input||'{"rotativo_rate_monthly":1.01}',card_input||'{"rotativo_rate_monthly":-0.1}',
    card_input||'{"rotativo_rate_monthly":"0.1"}',card_input||'{"rotativo_auto":"true"}',
    card_input||'{"payment_account_id":"invalid"}',card_input||jsonb_build_object('payment_account_id',other_bank),
    card_input||jsonb_build_object('payment_account_id',card_id),card_input||jsonb_build_object('payment_account_id',archived_payer)
  ] loop
    attempt:=gen_random_uuid();
    begin
      perform public.create_account(bad,attempt);
      raise exception 'invalid payload accepted: %',bad;
    exception when sqlstate '22023' then null;
    end;
    assert not exists(select 1 from private.payment_write_requests where user_id=u and request_id=attempt);
  end loop;
  assert (select count(*) from public.accounts)=before_count;
  assert (select count(*) from private.payment_write_requests where user_id=u)=before_receipts;
  perform set_config('role','none',true);
  delete from public.workspace_members where workspace_id=w and user_id=u;
  perform set_config('role','authenticated',true);
  replay:=public.create_account(card_input,card_request);
  assert replay->>'id'=card_id::text and replay->>'availability'='unavailable' and replay->'account'='null'::jsonb,
    'a receipt leaked current row data after workspace visibility was lost';
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.create_account(payload,gen_random_uuid());
    raise exception 'missing auth accepted';
  exception when others then
    if sqlerrm='missing auth accepted' then raise; end if;
  end;
end $$;
rollback;
