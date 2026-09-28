\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000a321';
  w uuid := '00000000-0000-0000-0000-00000000b321';
  s uuid := '00000000-0000-0000-0000-00000000c321';
  t uuid := '00000000-0000-0000-0000-00000000d321';
  req uuid := '00000000-0000-0000-0000-00000000e321';
  start_date date := (date_trunc('month',current_date)+interval '1 month')::date + 3;
  new_date date := private.day_in_month((date_trunc('month',current_date)+interval '1 month')::date,30);
  after_revision bigint;
  changed bigint;
begin
  insert into auth.users(id,email) values(u,'recurring-future@example.invalid') on conflict(id) do nothing;
  insert into public.profiles(id) values(u) on conflict(id) do nothing;
  insert into public.workspaces(id,owner_id,name) values(w,u,'Recurring future');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  insert into public.recurring_transactions
    (id,workspace_id,user_id,kind,amount_cents,description,rrule,dtstart,next_run_at)
  values(s,w,u,'expense',1000,'Antes','FREQ=MONTHLY;BYMONTHDAY=4',start_date,start_date);
  insert into public.transactions
    (id,workspace_id,user_id,kind,amount_cents,description,occurred_at,due_at,source,status,recurring_id)
  values(t,w,u,'expense',1000,'Antes',start_date,start_date,'recurring','pending',s);
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);
  changed := public.update_recurring_future(null,s,'{}'::jsonb,
    jsonb_build_object('amount_cents',1200,'rrule','FREQ=MONTHLY;BYMONTHDAY=30',
      'next_run_at',(new_date::timestamp at time zone 'America/Sao_Paulo')::text),0,req);
  assert changed >= 0;
  assert (select rrule from public.recurring_transactions where id=s)='FREQ=MONTHLY;BYMONTHDAY=30';
  select edit_revision into after_revision from public.recurring_transactions where id=s;
  assert public.update_recurring_future(null,s,'{}'::jsonb,
    jsonb_build_object('amount_cents',1200,'rrule','FREQ=MONTHLY;BYMONTHDAY=30',
      'next_run_at',(new_date::timestamp at time zone 'America/Sao_Paulo')::text),0,req)=changed;
  assert (select edit_revision from public.recurring_transactions where id=s)=after_revision,
    'retry must not move calendar again';
  begin
    perform public.update_recurring_future(null,s,'{}'::jsonb,
      '{"amount_cents":1300}'::jsonb,0,req);
    raise exception 'request key accepted with different patch';
  exception when others then
    if sqlerrm='request key accepted with different patch' then raise; end if;
    assert sqlerrm like '%reutilizado%', sqlerrm;
  end;
  begin
    perform public.update_recurring_future(null,s,'{}'::jsonb,
      '{"amount_cents":1300}'::jsonb,0,gen_random_uuid());
    raise exception 'stale revision accepted';
  exception when others then
    if sqlerrm='stale revision accepted' then raise; end if;
    assert sqlerrm like '%mudou enquanto%', sqlerrm;
  end;
end $$;
rollback;
