-- F09 foundation. Category remains free text; null never infers a detail.
create table public.subcategories (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 parent_category text not null check(parent_category=lower(trim(parent_category)) and char_length(parent_category) between 1 and 40),
 parent_key text not null,
 name text not null check(name=lower(trim(name)) and char_length(name) between 1 and 40),
 name_key text not null,
 edit_revision bigint not null default 1 check(edit_revision between 1 and 9007199254740991),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,parent_key,name_key),
 unique(id,workspace_id,parent_key)
);
-- fold uses unaccent and is STABLE, never a falsely IMMUTABLE index expression.
create function private.normalize_subcategory() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.parent_category:=lower(trim(new.parent_category)); new.name:=lower(trim(new.name));
 new.parent_key:=private.fold(new.parent_category); new.name_key:=private.fold(new.name);
 if tg_op='INSERT' then
  new.edit_revision:=1;
 else
  if old.edit_revision>=9007199254740991 then
   raise exception using errcode='22023',message='Limite de revisão atingido';
  end if;
  new.edit_revision:=old.edit_revision+1;
  new.created_at:=old.created_at; new.updated_at:=now();
 end if;
 return new;
end $$;
revoke execute on function private.normalize_subcategory() from public,anon,authenticated,service_role;
create trigger normalize_subcategory before insert or update on public.subcategories
 for each row execute function private.normalize_subcategory();
create index subcategories_author_idx on public.subcategories(user_id);
alter table public.subcategories enable row level security;
create policy subcategory_members_read on public.subcategories for select to authenticated
 using(workspace_id in(select private.my_workspace_ids()));
revoke all on public.subcategories from public,anon,authenticated,service_role;
grant select on public.subcategories to authenticated,service_role;
grant execute on function private.fold(text) to service_role;

-- Strict RPC preflight: explicit unknown, foreign or incompatible IDs are errors.
-- RLS limits authenticated lookups; trusted scheduler writes retain their role.
-- Financial RLS and public command membership checks own write authorization.
create function private.validate_subcategory_reference(p_workspace_id uuid,p_parent_category text,p_subcategory_id uuid)
returns uuid language plpgsql stable security invoker set search_path='' as $$
begin
 if p_subcategory_id is null then return null; end if;
 if not exists(select 1 from public.subcategories s where s.id=p_subcategory_id
  and s.workspace_id=p_workspace_id and s.parent_key=private.fold(p_parent_category)) then
  raise exception using errcode='22023',message='Detalhe desconhecido ou incompatível com a categoria e o espaço';
 end if;
 return p_subcategory_id;
end $$;
revoke execute on function private.validate_subcategory_reference(uuid,text,uuid) from public,anon;
grant execute on function private.validate_subcategory_reference(uuid,text,uuid) to authenticated,service_role;

-- Derived keys plus deferred composite FKs close the catalog-move/concurrent-insert
-- race that an MVCC SELECT alone cannot close. No catalog-first advisory/row lock
-- is introduced into the established R/I/D -> T financial lock order.
-- A move may change the catalog first, then reparent every source in the same TX.
do $$ declare schema_name text; table_name text; id_column text; begin
 for schema_name,table_name,id_column in values
  ('public','transactions','subcategory_id'),
  ('public','recurring_transactions','subcategory_id'),
  ('public','installment_plans','subcategory_id'),
  ('public','debts','subcategory_id'),
  ('public','categorization_rules','subcategory_id'),
  ('private','recurring_history_versions','subcategory_id'),
  ('public','import_items','suggested_subcategory_id')
 loop
  execute format('alter table %I.%I add column %I uuid references public.subcategories(id) on delete set null,
   add column subcategory_parent_key text,
   add constraint %I check((%I is null)=(subcategory_parent_key is null)),
   add constraint %I foreign key(%I,workspace_id,subcategory_parent_key)
    references public.subcategories(id,workspace_id,parent_key) deferrable initially deferred',
   schema_name,table_name,id_column,table_name||'_subcategory_key_check',id_column,
   table_name||'_subcategory_scope_fkey',id_column);
  execute format('create index %I on %I.%I(%I) where %I is not null',
   table_name||'_subcategory_idx',schema_name,table_name,id_column,id_column);
 end loop;
end $$;
alter table public.transactions add column subcategory_snapshot_set boolean not null default false;
alter table private.recurring_history_versions add column subcategory_snapshot_set boolean not null default false;

-- An exception may snapshot a parent independently of its debt. Workspace always
-- comes from the debt; unsnapshotted rows keep its payment_category as their parent.
-- Root integration must recompute/clear affected rows when the linked debt changes.
alter table public.debt_installment_edits
 add column subcategory_id uuid references public.subcategories(id) on delete set null,
 add column subcategory_parent_key text,
 add column subcategory_workspace_id uuid,
 add column subcategory_set boolean not null default false,
 add column category text,
 add column category_set boolean not null default false,
 add constraint debt_installment_subcategory_key_check check(
  (subcategory_id is null and subcategory_parent_key is null and subcategory_workspace_id is null)
  or (subcategory_id is not null and subcategory_parent_key is not null and subcategory_workspace_id is not null)),
 add constraint debt_installment_subcategory_scope_fkey foreign key(subcategory_id,subcategory_workspace_id,subcategory_parent_key)
  references public.subcategories(id,workspace_id,parent_key) deferrable initially deferred,
 add constraint debt_installment_subcategory_flag_check check(subcategory_set or subcategory_id is null),
 add constraint debt_installment_category_flag_check check(category_set or category is null);
create index debt_installment_edits_subcategory_idx on public.debt_installment_edits(subcategory_id) where subcategory_id is not null;
alter table public.debt_installment_edits drop constraint debt_installment_edits_check;
alter table public.debt_installment_edits add constraint debt_installment_edits_check
 check(due_date is not null or amount_cents is not null or payment_method_set
  or expense_pattern_set or expense_necessity_set or subcategory_set or category_set);

create function private.check_subcategory_reference() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
 n jsonb:=to_jsonb(new); o jsonb; child uuid; ws uuid; parent text;
 child_column text:=tg_argv[0]; parent_column text:=tg_argv[1];
 old_ws uuid; derived_parent_key text;
begin
 child:=(n->>child_column)::uuid;
 if tg_table_name='debt_installment_edits' then
  select d.workspace_id,d.payment_category into ws,parent from public.debts d where d.id=new.debt_id;
  if new.category_set then parent:=new.category; end if;
 else
  ws:=(n->>'workspace_id')::uuid; parent:=n->>parent_column;
 end if;
 derived_parent_key:=private.fold(parent);
 if child is not null and tg_op='UPDATE' then
  o:=to_jsonb(old);
  old_ws:=case when tg_table_name='debt_installment_edits' then (o->>'subcategory_workspace_id')::uuid
   else (o->>'workspace_id')::uuid end;
  -- Raw row triggers cannot distinguish an explicitly resent same UUID from
  -- an omitted UUID. RPCs must strictly preflight explicit intent before DML.
  if child is not distinct from (o->>child_column)::uuid
   and (ws is distinct from old_ws or derived_parent_key is distinct from o->>'subcategory_parent_key')
   and not exists(select 1 from public.subcategories s where s.id=child
    and s.workspace_id=ws and s.parent_key=derived_parent_key) then
   child:=null;
  end if;
 end if;
 perform private.validate_subcategory_reference(ws,parent,child);
 n:=jsonb_build_object(child_column,child,'subcategory_parent_key',case when child is not null then derived_parent_key end);
 if tg_table_name='debt_installment_edits' then
  n:=n||jsonb_build_object('subcategory_workspace_id',case when child is not null then ws end);
 end if;
 new:=jsonb_populate_record(new,n);
 return new;
end $$;
revoke execute on function private.check_subcategory_reference() from public,anon,authenticated,service_role;
do $$ declare schema_name text; table_name text; id_column text; parent_column text; begin
 for schema_name,table_name,id_column,parent_column in values
  ('public','transactions','subcategory_id','category'),
  ('public','recurring_transactions','subcategory_id','category'),
  ('public','installment_plans','subcategory_id','category'),
  ('public','debts','subcategory_id','payment_category'),
  ('public','categorization_rules','subcategory_id','category'),
  ('private','recurring_history_versions','subcategory_id','category'),
  ('public','import_items','suggested_subcategory_id','suggested_category'),
  ('public','debt_installment_edits','subcategory_id','payment_category')
 loop
  -- After source numbering/inheritance and the existing revision trigger. The
  -- invariant must see final parent/child values before any AFTER materializer.
  execute format('create trigger zzz_subcategory_reference before insert or update on %I.%I
   for each row execute function private.check_subcategory_reference(%L,%L)',schema_name,table_name,id_column,parent_column);
 end loop;
end $$;

create function public.subcategory_state(p_workspace_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_workspace_id is null or auth.uid() is null or not exists(
  select 1 from private.my_workspace_ids() as membership(workspace_id) where membership.workspace_id=p_workspace_id
 ) then raise exception using errcode='42501',message='Sem acesso ao espaço dos detalhes'; end if;
 if exists(select 1 from public.transactions t where t.workspace_id=p_workspace_id and t.subcategory_id is not null
  group by t.subcategory_id having count(*)>9007199254740991) then
  raise exception using errcode='22023',message='Contagem de detalhes fora do limite seguro';
 end if;
 select jsonb_build_object('workspace_id',p_workspace_id,'items',coalesce(jsonb_agg(
  jsonb_build_object('id',s.id,'workspace_id',s.workspace_id,'parent_category',s.parent_category,
   'name',s.name,'edit_revision',s.edit_revision,'uses',coalesce(u.uses,0))
  order by s.parent_key,s.name_key,s.id),'[]'::jsonb)) into result
 from public.subcategories s left join (
  select t.subcategory_id,count(*) as uses from public.transactions t
  where t.workspace_id=p_workspace_id and t.subcategory_id is not null group by t.subcategory_id
 ) u on u.subcategory_id=s.id where s.workspace_id=p_workspace_id;
 return result;
end $$;
revoke execute on function public.subcategory_state(uuid) from public,anon,service_role;
grant execute on function public.subcategory_state(uuid) to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename='subcategories') then
  alter publication supabase_realtime add table public.subcategories;
 end if;
end $$;
