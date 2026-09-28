\set ON_ERROR_STOP on
begin;

do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000a301';
  other_user uuid := '00000000-0000-0000-0000-00000000a302';
  w uuid := '00000000-0000-0000-0000-00000000b301';
  s uuid := '00000000-0000-0000-0000-00000000c301';
  key1 uuid := '00000000-0000-0000-0000-00000000d301';
  past_month date := (date_trunc('month', current_date) - interval '2 months')::date;
  next_month date := (date_trunc('month', current_date) + interval '1 month')::date;
  old_future date;
  new_future date;
  result1 bigint;
  rev bigint;
begin
  insert into auth.users (id,email) values
    (u,'recurring-all-owner@example.invalid'),
    (other_user,'recurring-all-other@example.invalid')
    on conflict (id) do nothing;
  insert into public.profiles(id) values (u),(other_user) on conflict (id) do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Recurring all scope');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner');
  old_future := next_month + 3;
  new_future := private.day_in_month(next_month, 30);
  insert into public.recurring_transactions
    (id,workspace_id,user_id,kind,amount_cents,description,rrule,dtstart,next_run_at)
  values (s,w,u,'expense',1000,'Antes','FREQ=MONTHLY;BYMONTHDAY=4',old_future,old_future);
  insert into public.transactions
    (workspace_id,user_id,kind,amount_cents,description,occurred_at,source,status,recurring_id)
  values
    (w,u,'expense',1000,'Antes',past_month + 3,'recurring','cleared',s),
    (w,u,'expense',1000,'Antes',old_future,'recurring','pending',s);

  perform set_config('request.jwt.claim.sub',other_user::text,true);
  begin
    perform public.update_recurring_all(s,'{"description":"Invasão"}'::jsonb,'{}'::jsonb,0,key1);
    raise exception 'Outro usuário não pode editar a recorrência';
  exception when others then
    if sqlerrm = 'Outro usuário não pode editar a recorrência' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);
  result1 := public.update_recurring_all(
    s, '{"amount_cents":1200,"description":"Depois"}'::jsonb,
    jsonb_build_object('rrule','FREQ=MONTHLY;BYMONTHDAY=30','next_run_at',new_future),
    0,key1);
  if result1 < 1 then raise exception 'Nenhuma ocorrência mudou'; end if;
  if (select amount_cents from public.transactions where recurring_id=s and status='cleared') <> 1200
     or (select description from public.transactions where recurring_id=s and status='cleared') <> 'Depois'
     or (select occurred_at from public.transactions where recurring_id=s and status='cleared')
        <> private.day_in_month(past_month,30)
     or (select amount_cents from public.recurring_transactions where id=s) <> 1200
     or (select rrule from public.recurring_transactions where id=s) <> 'FREQ=MONTHLY;BYMONTHDAY=30' then
    raise exception 'Todos não corrigiu histórico e regra juntos';
  end if;
  select edit_revision into rev from public.recurring_transactions where id=s;
  if public.update_recurring_all(
      s, '{"amount_cents":1200,"description":"Depois"}'::jsonb,
      jsonb_build_object('rrule','FREQ=MONTHLY;BYMONTHDAY=30','next_run_at',new_future),
      0,key1) <> result1
     or (select edit_revision from public.recurring_transactions where id=s) <> rev then
    raise exception 'A repetição mudou a série novamente';
  end if;
  begin
    perform public.update_recurring_all(s,'{"description":"Outro"}'::jsonb,'{}'::jsonb,0,key1);
    raise exception 'Reutilizar chave com outro conteúdo devia falhar';
  exception when others then
    if sqlerrm not like '%reutilizado%' then raise; end if;
  end;
  raise notice 'OK: todas incluindo passado, RLS, repetição e chave reutilizada';
end $$;

rollback;
