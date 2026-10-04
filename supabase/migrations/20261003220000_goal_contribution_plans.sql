-- F10 extends plan intentions only. Existing goal/deposit/ledger rows are untouched.
alter table public.goal_plan_items
 add column contribution_mode text not null default 'legacy',
 add column contribution_deadline date,
 add column initial_cents bigint not null default 0,
 add column initial_on date;
alter table public.goal_plan_items drop constraint goal_plan_items_check;
update public.goal_plan_items set contribution_mode='monthly' where not included;
alter table public.goal_plan_items add constraint goal_plan_items_contribution_shape check (
 contribution_mode in ('legacy','monthly','deadline') and initial_cents between 0 and 9007199254740991
 and (initial_cents<>0 or initial_on is null)
 and (initial_cents=0 or initial_on is not null)
 and (initial_on is null or initial_on between date '0001-01-01' and date '9999-12-31')
 and (first_on is null or first_on between date '0001-01-01' and date '9999-12-31')
 and ((not included and contribution_mode='monthly' and monthly_cents is null and first_on is null
       and contribution_deadline is null and initial_cents=0 and initial_on is null)
   or (included and (coalesce(monthly_cents,0)>0 or initial_cents>0) and (monthly_cents is null or monthly_cents between 0 and 9007199254740991)
       and (first_on is not null or initial_cents>0)
       and ((contribution_mode in ('legacy','monthly') and contribution_deadline is null)
         or (contribution_mode='deadline' and contribution_deadline is not null and contribution_deadline between date '0001-01-01' and date '9999-12-31')))));

create function private.goal_contribution_date(p_value jsonb) returns date
language plpgsql immutable security invoker set search_path='' as $$
declare d date;
begin
 if p_value='null'::jsonb then return null;end if;
 if p_value is null or jsonb_typeof(p_value)<>'string' or (p_value#>>'{}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 then raise exception using errcode='22023',message='Data civil inválida';end if;
 begin d:=(p_value#>>'{}')::date;
 exception when datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='Data civil inválida';end;
 if d not between date '0001-01-01' and date '9999-12-31' or to_char(d,'YYYY-MM-DD')<>p_value#>>'{}'
 then raise exception using errcode='22023',message='Data civil inválida';end if;
 return d;
end $$;
create function private.goal_contribution_money(p_value jsonb,p_nullable boolean default false) returns numeric
language plpgsql immutable security invoker set search_path='' as $$
begin
 if p_nullable and p_value='null'::jsonb then return null;end if;
 if p_value is null or jsonb_typeof(p_value)<>'number' or (p_value#>>'{}')!~'^[0-9]+$'
  or (p_value#>>'{}')::numeric not between 0 and 9007199254740991
 then raise exception using errcode='22023',message='Centavos inteiros seguros obrigatórios';end if;
 return (p_value#>>'{}')::numeric;
end $$;
-- O(1) Gregorian recurrence, clamped to the ORIGINAL day and four-digit calendar.
create function private.goal_contribution_month_on(p_anchor date,p_offset numeric) returns date
language plpgsql immutable strict security invoker set search_path='' as $$
declare absolute numeric;y integer;m integer;d integer;last_day integer;
begin
 if p_anchor not between date '0001-01-01' and date '9999-12-31' or p_offset<0 or p_offset<>trunc(p_offset)
 then raise exception using errcode='22023',message='Âncora ou índice mensal inválido';end if;
 absolute:=(extract(year from p_anchor)-1)*12+extract(month from p_anchor)-1+p_offset;
 if absolute>119987 then return null;end if;
 y:=floor(absolute/12)::integer+1;m:=mod(absolute,12)::integer+1;
 last_day:=case when m=2 then case when mod(y,4)=0 and (mod(y,100)<>0 or mod(y,400)=0) then 29 else 28 end
  when m in(4,6,9,11) then 30 else 31 end;
 d:=least(extract(day from p_anchor)::integer,last_day);
 return make_date(y,m,d);
end $$;

create function private.goal_contribution_result(p_input jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare keys constant text[]:=array['target_cents','saved_cents','as_of','mode','monthly_cents','first_on','deadline_on','initial_cents','initial_on'];
 target numeric;saved numeric;initial numeric;monthly numeric;remaining numeric;applied numeric:=0;after_initial numeric;
 as_of date;first_on date;deadline_on date;initial_on date;first_monthly date;estimate date;off integer;slots integer;hi integer;cnt numeric;
 mode text;r jsonb;flags jsonb:='[]';reason text;status text;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or not(p_input?&keys)
  or exists(select 1 from jsonb_object_keys(p_input) k where not(k=any(keys)))
 then raise exception using errcode='22023',message='Entrada do cálculo inválida';end if;
 target:=private.goal_contribution_money(p_input->'target_cents');saved:=private.goal_contribution_money(p_input->'saved_cents');
 initial:=private.goal_contribution_money(p_input->'initial_cents');monthly:=private.goal_contribution_money(p_input->'monthly_cents',true);
 as_of:=private.goal_contribution_date(p_input->'as_of');first_on:=private.goal_contribution_date(p_input->'first_on');
 deadline_on:=private.goal_contribution_date(p_input->'deadline_on');initial_on:=private.goal_contribution_date(p_input->'initial_on');
 mode:=p_input->>'mode';
 if target<1 or as_of is null or mode is null or mode not in('monthly','deadline')
  or (mode='monthly' and deadline_on is not null) or (mode='deadline' and monthly is not null)
  or (initial=0 and initial_on is not null)
 then raise exception using errcode='22023',message='Fonte do cálculo inválida';end if;
 remaining:=greatest(target-saved,0);
 r:=jsonb_build_object('status','incomplete','reason',null,'remaining_cents',remaining::text,'initial_applied_cents','0',
  'monthly_cents',case when mode='monthly' then monthly::text else null end,'monthly_count',0,'contribution_count',0,
  'last_cents','0','first_monthly_on',null,'estimated_on',null,'anchor_on',null,'first_offset',null,'flags',flags);
 if remaining=0 then return r||jsonb_build_object('status','reached','monthly_cents','0');end if;
 if initial_on<as_of then flags:='["initial_past"]';r:=r||jsonb_build_object('flags',flags);end if;
 if initial>0 and initial_on is null then return r||'{"reason":"initial_date"}';end if;
 if mode='deadline' and deadline_on is null then return r||'{"reason":"deadline"}';end if;
 if mode='deadline' and initial_on>deadline_on then return r||'{"reason":"initial_after_deadline"}';end if;
 if initial_on>=as_of then applied:=least(initial,remaining);end if;
 after_initial:=remaining-applied;r:=r||jsonb_build_object('initial_applied_cents',applied::text);
 if after_initial=0 then return r||jsonb_build_object('status','ready','monthly_cents','0','contribution_count',1,
  'last_cents',applied::text,'estimated_on',initial_on);end if;
 if mode='monthly' and (monthly is null or monthly=0) then return r||'{"reason":"monthly_amount"}';end if;
 if mode='deadline' and deadline_on<as_of then return r||'{"status":"unreachable","reason":"deadline"}';end if;
 if first_on is null then return r||'{"reason":"first_date"}';end if;
 off:=greatest(0,(extract(year from as_of)::integer-extract(year from first_on)::integer)*12
  +extract(month from as_of)::integer-extract(month from first_on)::integer);
 if private.goal_contribution_month_on(first_on,off)<as_of then off:=off+1;end if;
 first_monthly:=private.goal_contribution_month_on(first_on,off);
 r:=r||jsonb_build_object('anchor_on',first_on,'first_offset',off,'first_monthly_on',first_monthly);
 if applied>0 and initial_on>first_monthly then return r||'{"reason":"initial_after_first"}';end if;
 if mode='deadline' then
  hi:=(extract(year from deadline_on)::integer-extract(year from first_on)::integer)*12
   +extract(month from deadline_on)::integer-extract(month from first_on)::integer;
  slots:=0;
  if hi>=off then
   if private.goal_contribution_month_on(first_on,hi)>deadline_on then hi:=hi-1;end if;
   slots:=greatest(hi-off+1,0);
  end if;
  if slots=0 then return r||'{"status":"unreachable","reason":"deadline"}';end if;
  monthly:=div(after_initial+slots-1,slots);r:=r||jsonb_build_object('monthly_cents',monthly::text);
 end if;
 cnt:=div(after_initial+monthly-1,monthly);estimate:=private.goal_contribution_month_on(first_on,off+cnt-1);
 r:=r||jsonb_build_object('monthly_count',cnt,'contribution_count',cnt+case when applied>0 then 1 else 0 end,
  'last_cents',(after_initial-(cnt-1)*monthly)::text,'estimated_on',estimate);
 if estimate is null then return r||'{"status":"out_of_range","reason":"calendar_range"}';end if;
 return r||'{"status":"ready"}';
end $$;

create function private.goal_plan_items_shape_v2(p_items jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare keys constant text[]:=array['goal_id','included','mode','monthly_cents','first_on','deadline_on','initial_cents','initial_on'];
 x jsonb;gid uuid;ids uuid[]:='{}';mode text;monthly numeric;initial numeric;first_on date;deadline_on date;initial_on date;
begin
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception using errcode='22023',message='Lista de metas inválida';end if;
 for x in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(x) is distinct from 'object' or not(x?&keys)
   or exists(select 1 from jsonb_object_keys(x) k where not(k=any(keys)))
   or jsonb_typeof(x->'goal_id') is distinct from 'string' or jsonb_typeof(x->'included') is distinct from 'boolean'
   or jsonb_typeof(x->'mode') is distinct from 'string'
  then raise exception using errcode='22023',message='Item do plano inválido';end if;
  begin gid:=(x->>'goal_id')::uuid;exception when invalid_text_representation then raise exception using errcode='22023',message='Meta inválida';end;
  if gid=any(ids) then raise exception using errcode='22023',message='Meta repetida';end if;ids:=array_append(ids,gid);
  mode:=x->>'mode';monthly:=private.goal_contribution_money(x->'monthly_cents',true);initial:=private.goal_contribution_money(x->'initial_cents');
  first_on:=private.goal_contribution_date(x->'first_on');deadline_on:=private.goal_contribution_date(x->'deadline_on');initial_on:=private.goal_contribution_date(x->'initial_on');
  if mode not in('legacy','monthly','deadline') or (initial=0 and initial_on is not null)
   or (mode in('legacy','monthly') and deadline_on is not null) or (mode='deadline' and monthly is not null)
   or (x->'included'='false'::jsonb and (mode<>'monthly' or monthly is not null or first_on is not null
     or deadline_on is not null or initial<>0 or initial_on is not null))
  then raise exception using errcode='22023',message='Fonte ativa ou exclusão inválida';end if;
 end loop;
 return coalesce((select jsonb_agg(value||jsonb_build_object('goal_id',(value->>'goal_id')::uuid) order by (value->>'goal_id')::uuid)
  from jsonb_array_elements(p_items)),'[]'::jsonb);
end $$;

-- Derive the pure input from the source; legacy uses the monthly calculation and
-- the actual goal deadline is applied ONLY by the legacy projection calendar.
create function private.goal_contribution_input(p_goal public.goals,p_item jsonb,p_as_of date) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('target_cents',p_goal.target_cents,'saved_cents',p_goal.saved_cents,'as_of',p_as_of,
  'mode',case when p_item->>'mode'='deadline' then 'deadline' else 'monthly' end,
  'monthly_cents',p_item->'monthly_cents','first_on',p_item->'first_on','deadline_on',p_item->'deadline_on',
  'initial_cents',p_item->'initial_cents','initial_on',p_item->'initial_on');
$$;
create function private.goal_plan_item_source(p_item public.goal_plan_items) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('goal_id',p_item.goal_id,'included',p_item.included,'mode',p_item.contribution_mode,
  'monthly_cents',case when p_item.contribution_mode='deadline' then null else p_item.monthly_cents end,
  'first_on',p_item.first_on,'deadline_on',p_item.contribution_deadline,'initial_cents',p_item.initial_cents,'initial_on',p_item.initial_on);
$$;
-- v1 syntax accepts zero for initial-only F10 reads; completeness is checked by
-- the common pure calculator, so a new zero/no-initial v1 save still fails.
create or replace function private.goal_plan_items_shape(items jsonb,p_complete boolean) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare x jsonb; gid uuid; d date; ids uuid[]:='{}'; total numeric:=0;
 keys constant text[]:=array['goal_id','included','monthly_cents','first_on'];
begin
 if p_complete is null or jsonb_typeof(items) is distinct from 'array'
 then raise exception using errcode='22023',message='Lista de metas inválida';end if;
 for x in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(x) is distinct from 'object' or not(x?&keys)
   or exists(select 1 from jsonb_object_keys(x) j where not(j=any(keys)))
   or jsonb_typeof(x->'goal_id') is distinct from 'string'
   or jsonb_typeof(x->'included') is distinct from 'boolean'
  then raise exception using errcode='22023',message='Item do plano inválido';end if;
  begin gid:=(x->>'goal_id')::uuid;
  exception when invalid_text_representation then raise exception using errcode='22023',message='Meta inválida';end;
  if gid=any(ids) then raise exception using errcode='22023',message='Meta repetida no plano';end if;
  ids:=array_append(ids,gid);
  if x->'included'='false'::jsonb then
   if x->'monthly_cents'<>'null'::jsonb or x->'first_on'<>'null'::jsonb
   then raise exception using errcode='22023',message='Meta fora do plano deve ter aporte e data nulos';end if;
  else
   if x->'monthly_cents'='null'::jsonb then
    if p_complete then raise exception using errcode='22023',message='Complete o aporte mensal';end if;
   elsif jsonb_typeof(x->'monthly_cents') is distinct from 'number' or (x->>'monthly_cents')!~'^[0-9]+$'
     or (x->>'monthly_cents')::numeric not between 0 and 9007199254740991
   then raise exception using errcode='22023',message='Aporte mensal inválido';
   else total:=total+(x->>'monthly_cents')::numeric;end if;
   if x->'first_on'='null'::jsonb then
    if p_complete then raise exception using errcode='22023',message='Complete a primeira data';end if;
   elsif jsonb_typeof(x->'first_on') is distinct from 'string' or (x->>'first_on')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   then raise exception using errcode='22023',message='Primeira data inválida';
   else
    begin d:=(x->>'first_on')::date;
    exception when datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='Primeira data inválida';end;
    if d::text<>x->>'first_on' then raise exception using errcode='22023',message='Primeira data inválida';end if;
   end if;
  end if;
 end loop;
 if total>9007199254740991 then raise exception using errcode='22023',message='Total de aportes ultrapassa centavos seguros';end if;
 return coalesce((select jsonb_agg(j.value||jsonb_build_object('goal_id',(j.value->>'goal_id')::uuid) order by (j.value->>'goal_id')::uuid)
  from jsonb_array_elements(items) j),'[]'::jsonb);
end $$;

create function private.goal_plan_upgrade_items(ws uuid,p_items jsonb,p_as_of date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare x jsonb;old public.goal_plan_items%rowtype;g public.goals%rowtype;r jsonb;source jsonb;out_items jsonb:='[]';same_source boolean;
begin
 for x in select value from jsonb_array_elements(private.goal_plan_items_shape(p_items,false)) loop
  select * into old from public.goal_plan_items where workspace_id=ws and goal_id=(x->>'goal_id')::uuid;
  if not (x->>'included')::boolean then
   source:=x||jsonb_build_object('mode','monthly','deadline_on',null,'initial_cents',0,'initial_on',null);
  else
   same_source:=false;
   if old.goal_id is not null and old.included then
    select * into g from public.goals where id=old.goal_id and workspace_id=ws;
    r:=private.goal_contribution_result(private.goal_contribution_input(g,private.goal_plan_item_source(old),p_as_of));
    same_source:=(x->>'monthly_cents')::numeric is not distinct from (r->>'monthly_cents')::numeric
     and (x->>'first_on')::date is not distinct from old.first_on;
   end if;
   if same_source then source:=private.goal_plan_item_source(old);
   else source:=x||jsonb_build_object('mode','legacy','deadline_on',null,'initial_cents',coalesce(old.initial_cents,0),'initial_on',old.initial_on);end if;
  end if;
  out_items:=out_items||jsonb_build_array(source);
 end loop;
 return private.goal_plan_items_shape_v2(out_items);
end $$;
create function private.validate_goal_plan_items_v2(ws uuid,p_items jsonb,p_complete boolean,p_as_of date) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare items jsonb;actual uuid[];expected uuid[];x jsonb;g public.goals%rowtype;r jsonb;total numeric:=0;
begin
 items:=private.goal_plan_items_shape_v2(p_items);
 select coalesce(array_agg((value->>'goal_id')::uuid order by (value->>'goal_id')::uuid),'{}') into actual from jsonb_array_elements(items);
 select coalesce(array_agg(id order by id),'{}') into expected from public.goals where workspace_id=ws and not archived and saved_cents<target_cents;
 if actual is distinct from expected then raise exception using errcode='PT409',message='As metas mudaram. Confira o plano novamente';end if;
 if p_complete then
  for x in select value from jsonb_array_elements(items) loop
   if (x->>'included')::boolean then
    select * into g from public.goals where workspace_id=ws and id=(x->>'goal_id')::uuid;
    r:=private.goal_contribution_result(private.goal_contribution_input(g,x,p_as_of));
    if r->>'status'<>'ready' then raise exception using errcode='22023',message='Complete um cenário válido: '||coalesce(r->>'reason',r->>'status');end if;
    total:=total+(r->>'monthly_cents')::numeric+(r->>'initial_applied_cents')::numeric;
   end if;
  end loop;
  if total>9007199254740991 then raise exception using errcode='22023',message='Total de intenções ultrapassa centavos seguros';end if;
 end if;
 return items;
end $$;

-- Both API versions use ONE lock/replay/CAS/terminal-resolution implementation.
create function private.goal_plan_command(p_input jsonb,p_request_id uuid,p_version integer,p_resolve boolean) returns jsonb
language plpgsql security definer set search_path='' set timezone='America/Sao_Paulo' as $$
declare ws uuid;uid uuid:=auth.uid();intent jsonb;items jsonb;cached jsonb;rev bigint;shape jsonb;
 r public.goal_plans%rowtype;sealed private.goal_plan_write_receipts%rowtype;x jsonb;g public.goals%rowtype;calculated jsonb;
begin
 if p_version is null or p_version not in(1,2) or p_resolve is null then raise exception using errcode='22023',message='Versão do comando inválida';end if;
 if p_version=1 then ws:=private.goal_plan_workspace(p_input);
 else
  shape:=private.goal_plan_items_shape_v2(p_input->'items');
  -- Reuse the exact published input envelope/membership validation; the v1
  -- syntactic items here are only a validation adapter, never the sealed intent.
  select coalesce(jsonb_agg(jsonb_build_object('goal_id',value->'goal_id','included',false,'monthly_cents',null,'first_on',null)),'[]')
   into items from jsonb_array_elements(shape);
  ws:=private.goal_plan_workspace(p_input||jsonb_build_object('items',items));
 end if;
 if p_request_id is null then raise exception using errcode='22023',message='Identificador da tentativa obrigatório';end if;
 perform pg_advisory_xact_lock(hashtextextended('goal-plan-request:'||uid::text||':'||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('financial-allocations:'||ws::text,0));
 perform 1 from public.workspaces where id=ws for key share;
 perform 1 from public.workspace_members where workspace_id=ws and user_id=uid for share;
 if not found then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 intent:=jsonb_build_object('operation',case p_version when 1 then 'save_goal_plan' else 'save_goal_plan_v2' end,'input',p_input);
 select * into sealed from private.goal_plan_write_receipts where user_id=uid and request_id=p_request_id;
 if sealed.request_id is not null then
  if sealed.workspace_id<>ws or sealed.payload is distinct from intent then raise exception using errcode='22023',message='Identificador reutilizado com dados diferentes';end if;
  return sealed.result;
 end if;
 if p_resolve then
  cached:=jsonb_build_object('workspace_id',ws,'cancelled',true);
  insert into private.goal_plan_write_receipts(user_id,request_id,workspace_id,payload,result) values(uid,p_request_id,ws,intent,cached);
  return cached;
 end if;
 cached:=private.reserve_payment_request(p_request_id,intent);
 if cached is not null then raise exception using errcode='42501',message='Recibo não confirmado pelo comando do plano';end if;
 select * into r from public.goal_plans where workspace_id=ws for update;
 if (r.workspace_id is null and p_input->'expected_revision'<>'null'::jsonb)
  or (r.workspace_id is not null and (p_input->'expected_revision'='null'::jsonb or (p_input->>'expected_revision')::numeric<>r.edit_revision))
 then raise exception using errcode='PT409',message='Plano alterado. Confira novamente';end if;
 perform 1 from public.goals where workspace_id=ws order by id for share;
 if p_version=1 then items:=private.goal_plan_upgrade_items(ws,p_input->'items',current_date);else items:=shape;end if;
 items:=private.validate_goal_plan_items_v2(ws,items,true,current_date);
 if p_input->>'goals_fingerprint'<>private.goal_planning_fingerprint(ws) then raise exception using errcode='PT409',message='As metas mudaram. Confira o plano novamente';end if;
 if coalesce(r.edit_revision,0)>=9007199254740991 then raise exception using errcode='22023',message='Limite de revisão atingido';end if;
 rev:=coalesce(r.edit_revision,0)+1;
 insert into public.goal_plans(workspace_id,user_id,edit_revision) values(ws,uid,rev)
 on conflict(workspace_id) do update set user_id=excluded.user_id,edit_revision=excluded.edit_revision,updated_at=now();
 delete from public.goal_plan_items where workspace_id=ws;
 for x in select value from jsonb_array_elements(items) loop
  select * into g from public.goals where workspace_id=ws and id=(x->>'goal_id')::uuid;
  calculated:=private.goal_contribution_result(private.goal_contribution_input(g,x,current_date));
  insert into public.goal_plan_items(workspace_id,goal_id,user_id,included,monthly_cents,first_on,contribution_mode,contribution_deadline,initial_cents,initial_on)
   values(ws,g.id,uid,(x->>'included')::boolean,case when (x->>'included')::boolean then case when x->>'mode'='deadline' then (calculated->>'monthly_cents')::bigint else (x->>'monthly_cents')::bigint end else null end,
    (x->>'first_on')::date,x->>'mode',(x->>'deadline_on')::date,(x->>'initial_cents')::bigint,(x->>'initial_on')::date);
 end loop;
 cached:=jsonb_build_object('workspace_id',ws,'edit_revision',rev);
 insert into private.goal_plan_write_receipts(user_id,request_id,workspace_id,payload,result) values(uid,p_request_id,ws,intent,cached);
 perform private.finish_payment_request(p_request_id,cached);
 return cached;
end $$;

create or replace function private.save_goal_plan(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.goal_plan_command(p_input,p_request_id,1,false);$$;
create or replace function private.resolve_goal_plan_attempt(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.goal_plan_command(p_input,p_request_id,1,true);$$;
create function public.save_goal_plan_v2(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.goal_plan_command(p_input,p_request_id,2,false);$$;
create function public.resolve_goal_plan_attempt_v2(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.goal_plan_command(p_input,p_request_id,2,true);$$;

revoke execute on function private.goal_contribution_date(jsonb),private.goal_contribution_money(jsonb,boolean),
 private.goal_contribution_month_on(date,numeric),private.goal_contribution_result(jsonb),private.goal_plan_items_shape_v2(jsonb),
 private.goal_contribution_input(public.goals,jsonb,date),private.goal_plan_item_source(public.goal_plan_items),
 private.goal_plan_upgrade_items(uuid,jsonb,date),private.validate_goal_plan_items_v2(uuid,jsonb,boolean,date),
 private.goal_plan_command(jsonb,uuid,integer,boolean),public.save_goal_plan_v2(jsonb,uuid),public.resolve_goal_plan_attempt_v2(jsonb,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.goal_contribution_date(jsonb),private.goal_contribution_money(jsonb,boolean),
 private.goal_contribution_month_on(date,numeric),private.goal_contribution_result(jsonb),private.goal_plan_items_shape_v2(jsonb),
 private.goal_contribution_input(public.goals,jsonb,date),private.goal_plan_item_source(public.goal_plan_items),
 private.goal_plan_upgrade_items(uuid,jsonb,date),private.validate_goal_plan_items_v2(uuid,jsonb,boolean,date),
 private.goal_plan_command(jsonb,uuid,integer,boolean),public.save_goal_plan_v2(jsonb,uuid),public.resolve_goal_plan_attempt_v2(jsonb,uuid)
 to authenticated;
