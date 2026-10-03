-- F09: structural metadata commands never create, settle or delete financial records.
-- A command-owned sealed receipt, not a caller-written generic receipt, proves commit.
create table private.subcategory_write_receipts (
 user_id uuid not null references public.profiles(id) on delete cascade,
 request_id uuid not null,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(),
 primary key(user_id,request_id)
);
create index subcategory_write_receipts_workspace_idx on private.subcategory_write_receipts(workspace_id);
alter table private.subcategory_write_receipts enable row level security;
revoke all on private.subcategory_write_receipts from public,anon,authenticated,service_role;

-- Syntax only: terminal resolution must remain possible after the catalog/revision changes.
create function private.subcategory_command_workspace(p_input jsonb) returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare ws uuid; child uuid; receiver uuid; keys text[]; k text; action text;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sessão obrigatória';end if;
 if jsonb_typeof(p_input) is distinct from 'object' then
  raise exception using errcode='22023',message='Detalhe inválido';
 end if;
 action:=p_input->>'action';
 if action='save' then
  keys:=array['action','workspace_id','subcategory_id','expected_revision','parent_category','name','merge_into_id','expected_merge_revision'];
 elsif action='delete' then
  keys:=array['action','workspace_id','subcategory_id','expected_revision'];
 else raise exception using errcode='22023',message='Ação de detalhe inválida';end if;
 if not(p_input?&keys) or exists(select 1 from jsonb_object_keys(p_input) j where not(j=any(keys))) then
  raise exception using errcode='22023',message='Campos do detalhe inválidos';
 end if;
 foreach k in array array['workspace_id','subcategory_id'] loop
  if k='subcategory_id' and action='save' and p_input->k='null'::jsonb then continue;end if;
  if jsonb_typeof(p_input->k) is distinct from 'string'
   or (p_input->>k)!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then raise exception using errcode='22023',message='Identificação do detalhe inválida';end if;
 end loop;
 ws:=(p_input->>'workspace_id')::uuid; child:=(p_input->>'subcategory_id')::uuid;
 if not exists(select 1 from public.workspace_members where workspace_id=ws and user_id=auth.uid()) then
  raise exception using errcode='42501',message='Espaço não autorizado';
 end if;
 if child is null then
  if p_input->'expected_revision'<>'null'::jsonb then
   raise exception using errcode='22023',message='Novo detalhe não tem revisão anterior';end if;
 elsif jsonb_typeof(p_input->'expected_revision') is distinct from 'number'
  or (p_input->>'expected_revision')!~'^[0-9]+$'
  or (p_input->>'expected_revision')::numeric not between 1 and 9007199254740991 then
  raise exception using errcode='22023',message='Revisão do detalhe inválida';
 end if;
 if action='save' then
  foreach k in array array['parent_category','name'] loop
   if jsonb_typeof(p_input->k) is distinct from 'string'
    or char_length(lower(trim(p_input->>k))) not between 1 and 40 then
    raise exception using errcode='22023',message='Nome do detalhe ou categoria inválido';end if;
  end loop;
  if p_input->'merge_into_id'='null'::jsonb then
   if p_input->'expected_merge_revision'<>'null'::jsonb then
    raise exception using errcode='22023',message='Junção sem receptor';end if;
  else
   if child is null or jsonb_typeof(p_input->'merge_into_id') is distinct from 'string'
    or (p_input->>'merge_into_id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_input->'expected_merge_revision') is distinct from 'number'
    or (p_input->>'expected_merge_revision')!~'^[0-9]+$'
    or (p_input->>'expected_merge_revision')::numeric not between 1 and 9007199254740991 then
    raise exception using errcode='22023',message='Receptor ou revisão da junção inválidos';end if;
   receiver:=(p_input->>'merge_into_id')::uuid;
   if receiver=child then raise exception using errcode='22023',message='Escolha outro detalhe para receber';end if;
  end if;
 end if;
 return ws;
end $$;
revoke execute on function private.subcategory_command_workspace(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.subcategory_command_workspace(jsonb) to authenticated;

-- All references are redirected in one transaction. Parent templates precede their
-- occurrences, matching the existing financial lock order. Dated exceptions own
-- their category snapshot; moving one exception must not move unrelated debt lines.
create function private.redirect_subcategory(
 p_workspace uuid,p_from uuid,p_to uuid,p_parent text,p_reparent boolean
) returns bigint language plpgsql security definer set search_path='' as $$
declare changed bigint; prior_setting text:=current_setting('proops.renomeando_categoria',true);
begin
 if p_workspace is null or p_from is null or p_reparent is null then
  raise exception using errcode='22023',message='Redirecionamento de detalhe inválido';end if;
 if p_to is not null and not exists(select 1 from public.subcategories where id=p_to and workspace_id=p_workspace
  and (not p_reparent or parent_key=private.fold(p_parent))) then
  raise exception using errcode='22023',message='Receptor incompatível';end if;
 perform set_config('proops.renomeando_categoria','on',true);
 update public.recurring_transactions set subcategory_id=p_to,
  category=case when p_reparent then p_parent else category end
  where workspace_id=p_workspace and subcategory_id=p_from;
 update public.installment_plans set subcategory_id=p_to,
  category=case when p_reparent then p_parent else category end
  where workspace_id=p_workspace and subcategory_id=p_from;
 update public.debts set subcategory_id=p_to,
  payment_category=case when p_reparent then p_parent else payment_category end
  where workspace_id=p_workspace and subcategory_id=p_from;
 update public.transactions set subcategory_id=p_to,subcategory_snapshot_set=true,
  category=case when p_reparent then p_parent else category end
  where workspace_id=p_workspace and subcategory_id=p_from;
 get diagnostics changed=row_count;
 update private.recurring_history_versions set subcategory_id=p_to,subcategory_snapshot_set=true,
  category=case when p_reparent then p_parent else category end
  where workspace_id=p_workspace and subcategory_id=p_from;
 update public.debt_installment_edits e set subcategory_id=p_to,subcategory_set=true,
  category=case when p_reparent then p_parent else e.category end,
  category_set=case when p_reparent then true else e.category_set end
  where e.subcategory_id=p_from and exists(select 1 from public.debts d where d.id=e.debt_id and d.workspace_id=p_workspace);
 update public.categorization_rules set subcategory_id=p_to,
  category=case when p_reparent then p_parent else category end
  where workspace_id=p_workspace and subcategory_id=p_from;
 update public.import_items set suggested_subcategory_id=p_to,
  suggested_category=case when p_reparent then p_parent else suggested_category end
  where workspace_id=p_workspace and suggested_subcategory_id=p_from;
 perform set_config('proops.renomeando_categoria',coalesce(prior_setting,''),true);
 return changed;
end $$;
revoke execute on function private.redirect_subcategory(uuid,uuid,uuid,text,boolean) from public,anon,authenticated,service_role;

create function private.write_subcategory(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 ws uuid; uid uuid:=auth.uid(); child uuid; receiver uuid; intent jsonb; result jsonb;
 source public.subcategories%rowtype; target public.subcategories%rowtype;
 sealed private.subcategory_write_receipts%rowtype; parent text; child_name text; affected bigint:=0;
begin
 ws:=private.subcategory_command_workspace(p_input);
 if p_request_id is null then raise exception using errcode='22023',message='Identificador da tentativa obrigatório';end if;
 perform pg_advisory_xact_lock(hashtextextended('subcategory-request:'||uid::text||':'||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('category-configuration:'||ws::text,0));
 perform 1 from public.workspaces where id=ws for key share;
 perform 1 from public.workspace_members where workspace_id=ws and user_id=uid for share;
 if not found then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 intent:=jsonb_build_object('operation','write_subcategory','input',p_input);
 select * into sealed from private.subcategory_write_receipts where user_id=uid and request_id=p_request_id;
 if sealed.request_id is not null then
  if sealed.workspace_id<>ws or sealed.payload is distinct from intent then
   raise exception using errcode='22023',message='Identificador reutilizado com dados diferentes';end if;
  return sealed.result;
 end if;
 result:=private.reserve_payment_request(p_request_id,intent);
 if result is not null then raise exception using errcode='42501',message='Recibo não confirmado pelo comando do detalhe';end if;
 child:=(p_input->>'subcategory_id')::uuid;
 if child is not null then
  select * into source from public.subcategories where id=child and workspace_id=ws for update;
  if source.id is null or source.edit_revision<>(p_input->>'expected_revision')::bigint then
   raise exception using errcode='PT409',message='Detalhe alterado. Abra novamente';end if;
 end if;
 if p_input->>'action'='delete' then
  affected:=private.redirect_subcategory(ws,child,null,null,false);
  delete from public.subcategories where id=child and workspace_id=ws;
  result:=jsonb_build_object('workspace_id',ws,'subcategory_id',child,'edit_revision',null,
   'merged',false,'deleted',true,'affected_records',affected);
 else
  parent:=lower(trim(p_input->>'parent_category')); child_name:=lower(trim(p_input->>'name'));
  receiver:=(p_input->>'merge_into_id')::uuid;
  if receiver is not null then
   select * into target from public.subcategories where id=receiver and workspace_id=ws for update;
   if target.id is null or target.edit_revision<>(p_input->>'expected_merge_revision')::bigint then
    raise exception using errcode='PT409',message='Detalhe receptor alterado. Abra novamente';end if;
   if target.parent_key<>private.fold(parent) or target.name_key<>private.fold(child_name) then
    raise exception using errcode='22023',message='O receptor precisa corresponder ao nome e à categoria escolhidos';end if;
   affected:=private.redirect_subcategory(ws,child,receiver,target.parent_category,true);
   delete from public.subcategories where id=child and workspace_id=ws;
   update public.subcategories set name=name where id=receiver returning * into target;
  else
   if exists(select 1 from public.subcategories s where s.workspace_id=ws and s.parent_key=private.fold(parent)
    and s.name_key=private.fold(child_name) and s.id is distinct from child) then
    raise exception using errcode='PT409',message='Já existe um detalhe com esse nome nesta categoria. Confira para juntar';end if;
   if child is null then
    insert into public.subcategories(workspace_id,user_id,parent_category,name,parent_key,name_key)
     values(ws,uid,parent,child_name,private.fold(parent),private.fold(child_name)) returning * into target;
   else
    update public.subcategories set parent_category=parent,name=child_name where id=child returning * into target;
    if source.parent_category is distinct from target.parent_category then
     affected:=private.redirect_subcategory(ws,child,child,target.parent_category,true);
    end if;
   end if;
  end if;
  result:=jsonb_build_object('workspace_id',ws,'subcategory_id',target.id,'edit_revision',target.edit_revision,
   'merged',receiver is not null,'deleted',false,'affected_records',affected);
 end if;
 insert into private.subcategory_write_receipts(user_id,request_id,workspace_id,payload,result)
  values(uid,p_request_id,ws,intent,result);
 perform private.finish_payment_request(p_request_id,result);
 return result;
end $$;
revoke execute on function private.write_subcategory(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.write_subcategory(jsonb,uuid) to authenticated;
create function public.write_subcategory(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.write_subcategory(p_input,p_request_id); $$;
revoke execute on function public.write_subcategory(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.write_subcategory(jsonb,uuid) to authenticated;

create function private.resolve_subcategory_attempt(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid; uid uuid:=auth.uid(); intent jsonb; result jsonb; sealed private.subcategory_write_receipts%rowtype;
begin
 ws:=private.subcategory_command_workspace(p_input);
 if p_request_id is null then raise exception using errcode='22023',message='Identificador da tentativa obrigatório';end if;
 perform pg_advisory_xact_lock(hashtextextended('subcategory-request:'||uid::text||':'||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('category-configuration:'||ws::text,0));
 perform 1 from public.workspaces where id=ws for key share;
 perform 1 from public.workspace_members where workspace_id=ws and user_id=uid for share;
 if not found then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 intent:=jsonb_build_object('operation','write_subcategory','input',p_input);
 select * into sealed from private.subcategory_write_receipts where user_id=uid and request_id=p_request_id;
 if sealed.request_id is not null then
  if sealed.workspace_id<>ws or sealed.payload is distinct from intent then
   raise exception using errcode='22023',message='Identificador reutilizado com dados diferentes';end if;
  return sealed.result;
 end if;
 result:=jsonb_build_object('workspace_id',ws,'cancelled',true);
 insert into private.subcategory_write_receipts(user_id,request_id,workspace_id,payload,result)
  values(uid,p_request_id,ws,intent,result);
 return result;
end $$;
revoke execute on function private.resolve_subcategory_attempt(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function private.resolve_subcategory_attempt(jsonb,uuid) to authenticated;
create function public.resolve_subcategory_attempt(p_input jsonb,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.resolve_subcategory_attempt(p_input,p_request_id); $$;
revoke execute on function public.resolve_subcategory_attempt(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.resolve_subcategory_attempt(jsonb,uuid) to authenticated;

-- Keep the previous multi-workspace category/budget semantics in a static core.
-- The wrappers additionally maintain child namespaces before rewriting legacy text.
alter function public.rename_category(text,text,boolean) set schema private;
alter function private.rename_category(text,text,boolean) rename to rename_category_subcategory_core;
revoke execute on function private.rename_category_subcategory_core(text,text,boolean) from public,anon,authenticated,service_role;
alter function public.delete_category(text) set schema private;
alter function private.delete_category(text) rename to delete_category_subcategory_core;
revoke execute on function private.delete_category_subcategory_core(text) from public,anon,authenticated,service_role;

create function private.rename_category_with_subcategories(p_from text,p_to text,p_juntar boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare spaces uuid[]; ws uuid; source public.subcategories%rowtype; target public.subcategories%rowtype;
 origin text:=trim(p_from); destination text:=lower(trim(p_to)); incumbent text; prior_setting text;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sessão obrigatória';end if;
 if char_length(origin) not between 1 and 40 or char_length(destination) not between 1 and 40
  or origin is null or destination is null or p_juntar is null then
  raise exception using errcode='22023',message='Categoria inválida';end if;
 spaces:=array(select private.my_workspace_ids());
 if origin=destination then return private.rename_category_subcategory_core(origin,destination,p_juntar);end if;
 for ws in select unnest(spaces) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended('category-configuration:'||ws::text,0));
 end loop;
 select x.c into incumbent from (
  select category c from public.transactions where workspace_id=any(spaces)
  union select name from public.categories where workspace_id=any(spaces)
  union select category from public.budgets where workspace_id=any(spaces)
  union select category from public.recurring_transactions where workspace_id=any(spaces)
  union select category from public.installment_plans where workspace_id=any(spaces)
  union select category from public.categorization_rules where workspace_id=any(spaces)
  union select payment_category from public.debts where workspace_id=any(spaces)
  union select parent_category from public.subcategories where workspace_id=any(spaces)
 ) x where x.c is not null and private.fold(x.c)=private.fold(destination) and x.c<>origin
 order by (x.c=destination) desc,x.c limit 1;
 if incumbent is not null and not p_juntar then raise exception 'CATEGORIA_EXISTE: %',incumbent;end if;
 destination:=coalesce(incumbent,destination);
 prior_setting:=current_setting('proops.renomeando_categoria',true);
 perform set_config('proops.renomeando_categoria','on',true);
 for source in select * from public.subcategories where workspace_id=any(spaces)
  and parent_key=private.fold(origin) order by workspace_id,id for update loop
  select * into target from public.subcategories where workspace_id=source.workspace_id
   and parent_key=private.fold(destination) and name_key=source.name_key and id<>source.id for update;
  if target.id is not null then
   perform private.redirect_subcategory(source.workspace_id,source.id,target.id,target.parent_category,true);
   delete from public.subcategories where id=source.id;
   update public.subcategories set name=name where id=target.id;
  else
   update public.subcategories set parent_category=destination where id=source.id;
   perform private.redirect_subcategory(source.workspace_id,source.id,source.id,destination,true);
  end if;
 end loop;
 update public.debt_installment_edits e set category=destination where e.category_set and e.category=origin
  and exists(select 1 from public.debts d where d.id=e.debt_id and d.workspace_id=any(spaces));
 update public.import_items set suggested_category=destination where workspace_id=any(spaces) and suggested_category=origin;
 perform set_config('proops.renomeando_categoria',coalesce(prior_setting,''),true);
 return private.rename_category_subcategory_core(origin,destination,p_juntar);
end $$;
revoke execute on function private.rename_category_with_subcategories(text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function private.rename_category_with_subcategories(text,text,boolean) to authenticated;
create function public.rename_category(p_from text,p_to text,p_juntar boolean default false) returns jsonb
language sql security invoker set search_path='' as $$ select private.rename_category_with_subcategories(p_from,p_to,p_juntar); $$;
revoke execute on function public.rename_category(text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.rename_category(text,text,boolean) to authenticated;

create function private.delete_category_with_subcategories(p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare spaces uuid[]; ws uuid; source public.subcategories%rowtype;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Sessão obrigatória';end if;
 if p_name is null or char_length(trim(p_name)) not between 1 and 40 then
  raise exception using errcode='22023',message='Categoria inválida';end if;
 spaces:=array(select private.my_workspace_ids());
 for ws in select unnest(spaces) order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended('category-configuration:'||ws::text,0));
 end loop;
 for source in select * from public.subcategories where workspace_id=any(spaces)
  and parent_key=private.fold(p_name) order by workspace_id,id for update loop
  perform private.redirect_subcategory(source.workspace_id,source.id,null,null,false);
  delete from public.subcategories where id=source.id;
 end loop;
 update public.debt_installment_edits e set category=null where e.category_set and e.category=trim(p_name)
  and exists(select 1 from public.debts d where d.id=e.debt_id and d.workspace_id=any(spaces));
 update public.import_items set suggested_category=null where workspace_id=any(spaces) and suggested_category=trim(p_name);
 return private.delete_category_subcategory_core(p_name);
end $$;
revoke execute on function private.delete_category_with_subcategories(text) from public,anon,authenticated,service_role;
grant execute on function private.delete_category_with_subcategories(text) to authenticated;
create function public.delete_category(p_name text) returns jsonb
language sql security invoker set search_path='' as $$ select private.delete_category_with_subcategories(p_name); $$;
revoke execute on function public.delete_category(text) from public,anon,authenticated,service_role;
grant execute on function public.delete_category(text) to authenticated;
