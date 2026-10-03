-- F08: a persistent plan is intent, never a deposit or financial transaction.
create table public.goal_plans (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 edit_revision bigint not null check(edit_revision between 1 and 9007199254740991),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.goal_plan_items (
 workspace_id uuid not null references public.goal_plans(workspace_id) on delete cascade,
 goal_id uuid not null references public.goals(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 included boolean not null,
 monthly_cents bigint,
 first_on date,
 primary key(workspace_id,goal_id),
 check((included and monthly_cents between 1 and 9007199254740991 and monthly_cents is not null and first_on is not null)
   or (not included and monthly_cents is null and first_on is null))
);
create function private.check_goal_plan_scope() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.goals g where g.id=new.goal_id and g.workspace_id=new.workspace_id)
 then raise exception using errcode='23514',message='Meta e plano devem pertencer ao mesmo espaço';end if;
 return new;
end $$;
revoke execute on function private.check_goal_plan_scope() from public,anon,authenticated,service_role;
create trigger check_goal_plan_scope before insert or update on public.goal_plan_items
 for each row execute function private.check_goal_plan_scope();
create index goal_plans_author_idx on public.goal_plans(user_id);
create index goal_plan_items_author_idx on public.goal_plan_items(user_id);
create index goal_plan_items_goal_idx on public.goal_plan_items(goal_id);
alter table public.goal_plans enable row level security;
alter table public.goal_plan_items enable row level security;
create policy goal_plan_members_read on public.goal_plans for select to authenticated
 using(workspace_id in(select private.my_workspace_ids()));
create policy goal_plan_item_members_read on public.goal_plan_items for select to authenticated
 using(workspace_id in(select private.my_workspace_ids()));
revoke all on public.goal_plans,public.goal_plan_items from public,anon,authenticated;
grant select on public.goal_plans,public.goal_plan_items to authenticated;
grant all on public.goal_plans,public.goal_plan_items to service_role;
alter publication supabase_realtime add table public.goal_plans,public.goal_plan_items;

-- Only the checked command can seal a result. Generic caller-writable receipts aren't proof.
create table private.goal_plan_write_receipts (
 user_id uuid not null references public.profiles(id) on delete cascade,
 request_id uuid not null,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 primary key(user_id,request_id)
);
create index goal_plan_write_receipts_workspace_idx on private.goal_plan_write_receipts(workspace_id);
alter table private.goal_plan_write_receipts enable row level security;
revoke all on private.goal_plan_write_receipts from public,anon,authenticated,service_role;

create function private.goal_planning_fingerprint(ws uuid) returns text
language sql stable security invoker set search_path='' as $$
 select md5(coalesce(jsonb_agg(jsonb_build_array(g.id,g.target_cents,g.saved_cents,g.deadline) order by g.id),'[]'::jsonb)::text)
 from public.goals g where g.workspace_id=ws and not g.archived and g.saved_cents<g.target_cents;
$$;
revoke execute on function private.goal_planning_fingerprint(uuid) from public,anon,authenticated,service_role;
grant execute on function private.goal_planning_fingerprint(uuid) to authenticated;

-- Syntactic validation is independent of current goal state, so resolution can seal
-- the exact intent after a goal is edited or a plan's revision becomes stale.
create function private.goal_plan_items_shape(items jsonb,p_complete boolean) returns jsonb
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
     or (x->>'monthly_cents')::numeric not between 1 and 9007199254740991
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
revoke execute on function private.goal_plan_items_shape(jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function private.goal_plan_items_shape(jsonb,boolean) to authenticated;

create function private.validate_goal_plan_items(ws uuid,items jsonb,p_complete boolean) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare normalized jsonb; actual_ids uuid[]; expected_ids uuid[];
begin
 normalized:=private.goal_plan_items_shape(items,p_complete);
 select coalesce(array_agg((x->>'goal_id')::uuid order by (x->>'goal_id')::uuid),'{}') into actual_ids from jsonb_array_elements(normalized) x;
 select coalesce(array_agg(id order by id),'{}') into expected_ids from public.goals
  where workspace_id=ws and not archived and saved_cents<target_cents;
 if actual_ids is distinct from expected_ids
 then raise exception using errcode='PT409',message='As metas mudaram. Confira o plano novamente';end if;
 return normalized;
end $$;
revoke execute on function private.validate_goal_plan_items(uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function private.validate_goal_plan_items(uuid,jsonb,boolean) to authenticated;

create function private.goal_plan_workspace(p_input jsonb) returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare ws uuid; keys constant text[]:=array['workspace_id','expected_revision','goals_fingerprint','items'];
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sessão obrigatória';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or not(p_input?&keys)
  or exists(select 1 from jsonb_object_keys(p_input) j where not(j=any(keys)))
  or jsonb_typeof(p_input->'workspace_id') is distinct from 'string'
  or jsonb_typeof(p_input->'goals_fingerprint') is distinct from 'string' or (p_input->>'goals_fingerprint')!~'^[a-f0-9]{32}$'
 then raise exception using errcode='22023',message='Plano de metas inválido';end if;
 begin ws:=(p_input->>'workspace_id')::uuid;
 exception when invalid_text_representation then raise exception using errcode='22023',message='Espaço inválido';end;
 if not exists(select 1 from public.workspace_members where workspace_id=ws and user_id=auth.uid())
 then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 if p_input->'expected_revision'<>'null'::jsonb and
  (jsonb_typeof(p_input->'expected_revision') is distinct from 'number' or (p_input->>'expected_revision')!~'^[0-9]+$'
   or (p_input->>'expected_revision')::numeric not between 1 and 9007199254740991)
 then raise exception using errcode='22023',message='Revisão inválida';end if;
 perform private.goal_plan_items_shape(p_input->'items',false);
 return ws;
end $$;
revoke execute on function private.goal_plan_workspace(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.goal_plan_workspace(jsonb) to authenticated;

create function private.save_goal_plan(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='America/Sao_Paulo' as $$
declare ws uuid; uid uuid:=auth.uid(); intent jsonb; items jsonb; cached jsonb; rev bigint;
 r public.goal_plans%rowtype; sealed private.goal_plan_write_receipts%rowtype;
begin
 ws:=private.goal_plan_workspace(p_input);
 if p_request_id is null then raise exception using errcode='22023',message='Identificador da tentativa obrigatório';end if;
 -- Serialize the identity across workspaces, then share the F07 workspace writer lock.
 perform pg_advisory_xact_lock(hashtextextended('goal-plan-request:'||uid::text||':'||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('financial-allocations:'||ws::text,0));
 perform 1 from public.workspaces where id=ws for key share;
 perform 1 from public.workspace_members where workspace_id=ws and user_id=uid for share;
 if not found then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 intent:=jsonb_build_object('operation','save_goal_plan','input',p_input);
 select * into sealed from private.goal_plan_write_receipts where user_id=uid and request_id=p_request_id;
 if sealed.request_id is not null then
  if sealed.workspace_id<>ws or sealed.payload is distinct from intent
  then raise exception using errcode='22023',message='Identificador reutilizado com dados diferentes';end if;
  return sealed.result;
 end if;
 cached:=private.reserve_payment_request(p_request_id,intent);
 if cached is not null then raise exception using errcode='42501',message='Recibo não confirmado pelo comando do plano';end if;
 select * into r from public.goal_plans where workspace_id=ws for update;
 if (r.workspace_id is null and p_input->'expected_revision'<>'null'::jsonb)
  or (r.workspace_id is not null and (p_input->'expected_revision'='null'::jsonb or (p_input->>'expected_revision')::numeric<>r.edit_revision))
 then raise exception using errcode='PT409',message='Plano alterado. Confira novamente';end if;
 -- Same order as F07: don't lock contributions, which legacy commands lock before goals.
 perform 1 from public.goals where workspace_id=ws order by id for share;
 items:=private.validate_goal_plan_items(ws,p_input->'items',true);
 if p_input->>'goals_fingerprint'<>private.goal_planning_fingerprint(ws)
 then raise exception using errcode='PT409',message='As metas mudaram. Confira o plano novamente';end if;
 if coalesce(r.edit_revision,0)>=9007199254740991 then raise exception using errcode='22023',message='Limite de revisão atingido';end if;
 rev:=coalesce(r.edit_revision,0)+1;
 insert into public.goal_plans(workspace_id,user_id,edit_revision) values(ws,uid,rev)
 on conflict(workspace_id) do update set user_id=excluded.user_id,edit_revision=excluded.edit_revision,updated_at=now();
 delete from public.goal_plan_items where workspace_id=ws;
 insert into public.goal_plan_items(workspace_id,goal_id,user_id,included,monthly_cents,first_on)
 select ws,(x->>'goal_id')::uuid,uid,(x->>'included')::boolean,(x->>'monthly_cents')::bigint,(x->>'first_on')::date from jsonb_array_elements(items) x;
 cached:=jsonb_build_object('workspace_id',ws,'edit_revision',rev);
 insert into private.goal_plan_write_receipts(user_id,request_id,workspace_id,payload,result) values(uid,p_request_id,ws,intent,cached);
 perform private.finish_payment_request(p_request_id,cached);
 return cached;
end $$;
revoke execute on function private.save_goal_plan(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.save_goal_plan(jsonb,uuid) to authenticated;
create function public.save_goal_plan(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.save_goal_plan(p_input,p_request_id); $$;
revoke execute on function public.save_goal_plan(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_goal_plan(jsonb,uuid) to authenticated;

create function private.resolve_goal_plan_attempt(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='America/Sao_Paulo' as $$
declare ws uuid; uid uuid:=auth.uid(); intent jsonb; result jsonb; sealed private.goal_plan_write_receipts%rowtype;
begin
 ws:=private.goal_plan_workspace(p_input);
 if p_request_id is null then raise exception using errcode='22023',message='Identificador da tentativa obrigatório';end if;
 perform pg_advisory_xact_lock(hashtextextended('goal-plan-request:'||uid::text||':'||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('financial-allocations:'||ws::text,0));
 perform 1 from public.workspaces where id=ws for key share;
 perform 1 from public.workspace_members where workspace_id=ws and user_id=uid for share;
 if not found then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 intent:=jsonb_build_object('operation','save_goal_plan','input',p_input);
 select * into sealed from private.goal_plan_write_receipts where user_id=uid and request_id=p_request_id;
 if sealed.request_id is not null then
  if sealed.workspace_id<>ws or sealed.payload is distinct from intent
  then raise exception using errcode='22023',message='Identificador reutilizado com dados diferentes';end if;
  return sealed.result;
 end if;
 result:=jsonb_build_object('workspace_id',ws,'cancelled',true);
 insert into private.goal_plan_write_receipts(user_id,request_id,workspace_id,payload,result) values(uid,p_request_id,ws,intent,result);
 return result;
end $$;
revoke execute on function private.resolve_goal_plan_attempt(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.resolve_goal_plan_attempt(jsonb,uuid) to authenticated;
create function public.resolve_goal_plan_attempt(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.resolve_goal_plan_attempt(p_input,p_request_id); $$;
revoke execute on function public.resolve_goal_plan_attempt(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.resolve_goal_plan_attempt(jsonb,uuid) to authenticated;
