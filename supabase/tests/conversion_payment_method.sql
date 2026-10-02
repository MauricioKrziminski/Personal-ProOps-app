-- Synthetic F01 conversion regression. The runner owns an outer transaction and always rolls back.
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$
declare
  u uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); bank uuid:=gen_random_uuid();
  tx uuid; series uuid; request uuid:=gen_random_uuid(); before_count bigint;
  destination jsonb; result jsonb; replay jsonb; start_at timestamptz:=current_date+time '09:00';
  error_code text; error_message text; error_detail text; error_hint text; error_context text;
begin
  insert into auth.users(id,email) values(u,'f01-recurring-'||u||'@example.invalid');
  insert into public.profiles(id) values(u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name,created_at) values(w,u,'F01 synthetic recurring rollback',now()-interval '2 days');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type) values(bank,w,u,'F01 synthetic checking','checking');
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);
  assert public.my_default_workspace()=w,'Unexpected fixture default workspace';
  insert into public.transactions(user_id,kind,amount_cents,description,account_id,occurred_at,status)
    values(u,'expense',1200,'F01 old simple cleared',bank,current_date-10,'cleared') returning id into tx;
  assert (select payment_method is null and recurring_id is null from public.transactions where id=tx),'Legacy fixture not simple/null';
  destination:=jsonb_build_object('tipo','recorrente','dados',jsonb_build_object(
    'kind','expense','amount_cents',23456,'description','F01 synthetic recurring Pix','merchant',null,'category',null,
    'account_id',bank,'payment_method','pix','rrule','FREQ=MONTHLY;BYMONTHDAY='||extract(day from current_date)::int,
    'next_run_at',start_at,'dtstart',start_at,'end_date',null,'auto_confirm',true));
  result:=public.converter_registro(jsonb_build_object('tipo','transacao','id',tx),'converter',destination,request);
  series:=(result->'ids'->>0)::uuid;
  assert series is not null,'Converter omitted series ID';
  assert (select payment_method='pix' and amount_cents=23456 from public.recurring_transactions where id=series),'Parent metadata/amount mismatch';
  assert (select recurring_id=series and payment_method='pix' and amount_cents=23456 and status='cleared' and occurred_at=current_date
    from public.transactions where id=tx),'Adopted cleared row mismatch';
  assert not exists(select 1 from public.transactions where recurring_id=series and (payment_method is distinct from 'pix' or amount_cents<>23456)),
    'Created recurring row mismatch';
  assert private.payment_method_at(series,current_date)='pix','Recurring history method mismatch';
  select count(*) into before_count from public.recurring_transactions;
  replay:=public.converter_registro(jsonb_build_object('tipo','transacao','id',tx),'converter',destination,request);
  assert replay=result,'Replay IDs differ';
  assert (select count(*) from public.recurring_transactions)=before_count,'Replay created another series';
  assert (select recurring_id=series from public.transactions where id=tx),'Replay changed adoption';
  set constraints all immediate;
  raise notice 'OK: authenticated null -> recurring Pix, 23456 cents, 09:00 BRT, adopted ID, methods/history, replay IDs/count';
exception when others then
  get stacked diagnostics error_code=returned_sqlstate,error_message=message_text,error_detail=pg_exception_detail,
    error_hint=pg_exception_hint,error_context=pg_exception_context;
  raise notice 'ERROR SQLSTATE=% MESSAGE=% DETAIL=% HINT=% CONTEXT=%',error_code,error_message,error_detail,error_hint,error_context;
  raise;
end $$;
rollback;
