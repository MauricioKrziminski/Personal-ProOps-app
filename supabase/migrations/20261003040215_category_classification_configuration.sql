-- F06: one atomic category configuration command, optional explicit historical backfill.
-- Financial values and contract snapshots are never recalculated by this command.

create table private.category_classification_backfill_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  transaction_id uuid not null,
  category text not null,
  period_from date not null,
  period_to date not null check (period_to >= period_from),
  author_id uuid not null references public.profiles(id) on delete cascade,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (author_id, request_id, transaction_id)
);
alter table private.category_classification_backfill_audit enable row level security;
create policy category_classification_audit_members on private.category_classification_backfill_audit
  for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));
-- Private, not published to Realtime, and never directly editable/readable by app users.
revoke all on private.category_classification_backfill_audit from public, anon, authenticated;

-- Only the trigger can append real OLD/NEW snapshots. No caller-supplied snapshot can be
-- recorded. The invoker RPC updates RLS-visible transactions; this narrow definer writes audit.
create function private.audit_category_classification_backfill()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_request uuid;
  v_payload jsonb;
  v_input jsonb;
  v_category text;
  v_from date;
  v_to date;
  v_before jsonb;
  v_after jsonb;
begin
  if nullif(current_setting('proops.category_backfill_request', true), '') is null then return new; end if;
  v_request := current_setting('proops.category_backfill_request')::uuid;
  v_category := current_setting('proops.category_backfill_category');
  select r.payload into v_payload from private.payment_write_requests r
    where r.user_id = auth.uid() and r.request_id = v_request and r.result is null;
  v_input := v_payload->'input';
  v_from := (v_input->>'backfill_from')::date;
  v_to := (v_input->>'backfill_to')::date;
  if auth.uid() is null or v_payload->>'api' is distinct from 'save_category_configuration'
    or (v_payload->>'workspace_id')::uuid is distinct from public.my_default_workspace()
    or new.workspace_id is distinct from (v_payload->>'workspace_id')::uuid
    or old.workspace_id is distinct from new.workspace_id
    or not exists(select 1 from private.my_workspace_ids() w where w = new.workspace_id)
    or v_from is null or v_to is null or v_to < v_from
    or new.occurred_at not between v_from and v_to
    or new.kind <> 'expense' or new.pays_invoice_id is not null
    or new.category is distinct from v_category
    or private.fold(new.category) is distinct from private.fold(v_input->>'name') then
    raise exception 'Aplicação histórica sem autorização válida' using errcode = '42501';
  end if;
  -- A manually adjusted dimension, including explicit null, is always immutable here.
  if new.expense_pattern is distinct from (case when old.expense_pattern_source = 'explicit'
      then old.expense_pattern else v_input->>'default_expense_pattern' end)
    or new.expense_pattern_source is distinct from (case when old.expense_pattern_source = 'explicit'
      then old.expense_pattern_source when v_input->>'default_expense_pattern' is not null then 'category_default' end)
    or new.expense_necessity is distinct from (case when old.expense_necessity_source = 'explicit'
      then old.expense_necessity else v_input->>'default_expense_necessity' end)
    or new.expense_necessity_source is distinct from (case when old.expense_necessity_source = 'explicit'
      then old.expense_necessity_source when v_input->>'default_expense_necessity' is not null then 'category_default' end) then
    raise exception 'Aplicação histórica não corresponde à intenção reservada' using errcode = '42501';
  end if;
  v_before := jsonb_build_object('expense_pattern',old.expense_pattern,'expense_pattern_source',old.expense_pattern_source,
    'expense_necessity',old.expense_necessity,'expense_necessity_source',old.expense_necessity_source);
  v_after := jsonb_build_object('expense_pattern',new.expense_pattern,'expense_pattern_source',new.expense_pattern_source,
    'expense_necessity',new.expense_necessity,'expense_necessity_source',new.expense_necessity_source);
  if v_before is distinct from v_after then
    insert into private.category_classification_backfill_audit
      (request_id,workspace_id,transaction_id,category,period_from,period_to,author_id,before_snapshot,after_snapshot)
      values(v_request,new.workspace_id,new.id,new.category,v_from,v_to,auth.uid(),v_before,v_after);
  end if;
  return new;
end $$;
revoke execute on function private.audit_category_classification_backfill() from public, anon, authenticated;
create trigger zz_category_classification_backfill_audit
  after update of expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source on public.transactions
  for each row execute function private.audit_category_classification_backfill();

-- public.save_category_configuration(p_input jsonb,p_request_id uuid) -> jsonb:
-- {configuration_id, category, default_expense_pattern, default_expense_necessity,
--  edit_revision, juntou, orcamentos_descartados, backfill_updated}.
-- Defaults are both required (JSON null clears); appearance may be null/omitted.
-- category_id+expected_revision identify an existing default-workspace configuration.
-- No ID means CREATE, or rename_from identifies a virtual category without configuration.
-- Historical dates must be both absent/null or both ISO dates. Periods require an existing
-- configuration and cannot accompany merges. An unchanged default can be reapplied explicitly.
create function public.save_category_configuration(p_input jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_ws uuid := public.my_default_workspace();
  v_id uuid;
  v_revision bigint;
  v_old public.categories%rowtype;
  v_result_category public.categories%rowtype;
  v_name text;
  v_rename_from text;
  v_icon text;
  v_color text;
  v_pattern text;
  v_necessity text;
  v_from date;
  v_to date;
  v_juntar boolean := false;
  v_rename jsonb := '{"juntou":false,"orcamentos_descartados":0}'::jsonb;
  v_cached jsonb;
  v_result jsonb;
  v_key text;
  v_updated bigint := 0;
  v_old_request text;
  v_old_category text;
  v_actual_category text;
  v_destination_workspaces uuid[];
  v_lock_ws uuid;
begin
  if auth.uid() is null or v_ws is null or p_request_id is null then
    raise exception 'Sessão e identificador da requisição obrigatórios' using errcode='22023';
  end if;
  if jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'Configuração da categoria deve ser um objeto' using errcode='22023';
  end if;
  for v_key in select jsonb_object_keys(p_input) loop
    if v_key <> all(array['name','icon','color','rename_from','category_id','expected_revision','juntar',
      'default_expense_pattern','default_expense_necessity','backfill_from','backfill_to']) then
      raise exception 'Campo de configuração desconhecido: %',v_key using errcode='22023';
    end if;
  end loop;
  if jsonb_typeof(p_input->'name') is distinct from 'string'
    or not (p_input ? 'default_expense_pattern' and p_input ? 'default_expense_necessity') then
    raise exception 'Nome e os dois padrões são obrigatórios' using errcode='22023';
  end if;
  foreach v_key in array array['icon','color','rename_from','category_id','default_expense_pattern',
      'default_expense_necessity','backfill_from','backfill_to'] loop
    if p_input ? v_key and jsonb_typeof(p_input->v_key) not in ('string','null') then
      raise exception 'Campo de configuração deve ser texto ou null: %',v_key using errcode='22023';
    end if;
  end loop;
  if p_input ? 'juntar' and jsonb_typeof(p_input->'juntar') <> 'boolean' then
    raise exception 'Juntar deve ser booleano' using errcode='22023';
  end if;
  if p_input ? 'expected_revision' and jsonb_typeof(p_input->'expected_revision') not in ('number','null') then
    raise exception 'Revisão deve ser um inteiro ou null' using errcode='22023';
  end if;
  v_name := lower(trim(p_input->>'name'));
  v_rename_from := trim(p_input->>'rename_from');
  v_icon := p_input->>'icon'; v_color := p_input->>'color';
  v_pattern := p_input->>'default_expense_pattern';
  v_necessity := p_input->>'default_expense_necessity';
  v_juntar := coalesce((p_input->>'juntar')::boolean,false);
  if char_length(v_name) not between 1 and 40
    or (v_rename_from is not null and char_length(v_rename_from) not between 1 and 40)
    or (v_icon is not null and char_length(v_icon) not between 1 and 60)
    or (v_color is not null and v_color not in ('grafite','oceano','violeta','magenta','terra','mostarda','musgo','turquesa'))
    or (v_pattern is not null and v_pattern not in ('fixed','variable'))
    or (v_necessity is not null and v_necessity not in ('essential','discretionary')) then
    raise exception 'Nome, aparência ou padrões da categoria inválidos' using errcode='22023';
  end if;
  if (p_input->>'category_id' is null) <> (p_input->>'expected_revision' is null) then
    raise exception 'Identificador e revisão devem ser fornecidos juntos' using errcode='22023';
  end if;
  if p_input->>'expected_revision' is not null and (p_input->>'expected_revision') !~ '^[0-9]+$' then
    raise exception 'Revisão deve ser um inteiro não negativo' using errcode='22023';
  end if;
  begin
    v_id := (p_input->>'category_id')::uuid;
    v_revision := (p_input->>'expected_revision')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Identificador ou revisão inválidos' using errcode='22023';
  end;
  if (p_input->>'backfill_from' is null) <> (p_input->>'backfill_to' is null) then
    raise exception 'As duas datas do período são obrigatórias' using errcode='22023';
  end if;
  if p_input->>'backfill_from' is not null then
    if (p_input->>'backfill_from') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (p_input->>'backfill_to') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Datas devem usar AAAA-MM-DD' using errcode='22023';
    end if;
    begin
      v_from := (p_input->>'backfill_from')::date; v_to := (p_input->>'backfill_to')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Período inválido' using errcode='22023';
    end;
    if v_to < v_from or v_id is null or v_juntar then
      raise exception 'Período exige edição de categoria existente, sem juntar, e datas em ordem' using errcode='22023';
    end if;
  end if;
  if v_juntar and v_rename_from is null then
    raise exception 'Juntar exige a categoria de origem' using errcode='22023';
  end if;

  -- Full intent, including default workspace, is reserved before CAS or other mutable state.
  v_cached := private.reserve_payment_request(p_request_id,
    jsonb_build_object('api','save_category_configuration','workspace_id',v_ws,'input',p_input));
  if v_cached is not null then return v_cached; end if;
  -- Global renames serialize every accessible workspace before absence checks/capture.
  -- Always acquire the whole workspace set in UUID order, never default-first: callers with
  -- different default workspaces must share the same ordering. Local edits lock only default.
  if v_rename_from is null then
    perform pg_advisory_xact_lock(hashtextextended('category-configuration:'||v_ws::text,0));
  else
    for v_lock_ws in select distinct w from private.my_workspace_ids() w order by w loop
      perform pg_advisory_xact_lock(hashtextextended('category-configuration:'||v_lock_ws::text,0));
    end loop;
  end if;
  -- Legacy category APIs still cannot cause an overwrite: final creation uses INSERT.
  -- A global rename may touch configurations in multiple accessible workspaces. Lock both
  -- names in a stable order before selecting the destination or invoking the incumbent rename.
  perform c.id from public.categories c
    where c.workspace_id in (select private.my_workspace_ids())
      and (c.id=v_id or c.name=lower(v_rename_from) or private.fold(c.name)=private.fold(v_name))
    order by c.workspace_id,c.name,c.id for update;

  if v_id is not null then
    select * into v_old from public.categories where id=v_id and workspace_id=v_ws;
    if not found or v_old.edit_revision<>v_revision
      or (v_rename_from is not null and v_old.name<>lower(v_rename_from))
      or (v_rename_from is null and v_old.name<>v_name) then
      raise exception 'CATEGORIA_CONFIGURACAO_DESATUALIZADA: reabra a categoria';
    end if;
  else
    if exists(select 1 from public.categories where workspace_id=v_ws
      and (private.fold(name)=private.fold(coalesce(v_rename_from,v_name)))) then
      raise exception 'CATEGORIA_CONFIGURACAO_DESATUALIZADA: a categoria já tem configuração';
    end if;
    if v_rename_from is not null and not exists (
      select 1 from public.categories_used() where category=v_rename_from
      union all select 1 from public.budgets where workspace_id in(select private.my_workspace_ids()) and category=v_rename_from
      union all select 1 from public.recurring_transactions where workspace_id in(select private.my_workspace_ids()) and category=v_rename_from
      union all select 1 from public.installment_plans where workspace_id in(select private.my_workspace_ids()) and category=v_rename_from
      union all select 1 from public.categorization_rules where workspace_id in(select private.my_workspace_ids()) and category=v_rename_from
      union all select 1 from public.debts where workspace_id in(select private.my_workspace_ids()) and payment_category=v_rename_from) then
      raise exception 'Categoria não encontrada' using errcode='22023';
    end if;
  end if;

  v_actual_category := v_name;
  if v_rename_from is not null then
    -- Finance writers lock parents before occurrences. The incumbent global rename writes
    -- children first, so acquire the affected parents in the shared table/ID order up front.
    -- Include parents referenced by a source-category child even when their own category
    -- differs because that child may invalidate its parent's edit revision.
    perform r.id from public.recurring_transactions r
      where r.workspace_id in(select private.my_workspace_ids()) and
        (r.category=v_rename_from or exists(select 1 from public.transactions t
          where t.workspace_id=r.workspace_id and t.category=v_rename_from and t.recurring_id=r.id))
      order by r.id for update;
    perform p.id from public.installment_plans p
      where p.workspace_id in(select private.my_workspace_ids()) and
        (p.category=v_rename_from or exists(select 1 from public.transactions t
          where t.workspace_id=p.workspace_id and t.category=v_rename_from and t.installment_plan_id=p.id))
      order by p.id for update;
    perform d.id from public.debts d
      where d.workspace_id in(select private.my_workspace_ids()) and
        (d.payment_category=v_rename_from or exists(select 1 from public.transactions t
          where t.workspace_id=d.workspace_id and t.category=v_rename_from and t.debt_id=d.id))
      order by d.id for update;
    perform t.id from public.transactions t
      where t.workspace_id in(select private.my_workspace_ids()) and t.category=v_rename_from
      order by t.id for update;
    -- Choose the same receiver spelling/order as rename_category; its global collision and
    -- budget merge behavior remain authoritative, as do contract/history category renames.
    select x.c into v_actual_category from (
      select category c from public.transactions where workspace_id in(select private.my_workspace_ids())
      union select name from public.categories where workspace_id in(select private.my_workspace_ids())
      union select category from public.budgets where workspace_id in(select private.my_workspace_ids())
      union select category from public.recurring_transactions where workspace_id in(select private.my_workspace_ids())
      union select category from public.installment_plans where workspace_id in(select private.my_workspace_ids())
      union select category from public.categorization_rules where workspace_id in(select private.my_workspace_ids())
      union select payment_category from public.debts where workspace_id in(select private.my_workspace_ids())
    ) x where x.c is not null and private.fold(x.c)=private.fold(v_name) and x.c<>v_rename_from
      order by (x.c=v_name) desc,x.c limit 1;
    v_actual_category := coalesce(v_actual_category,v_name);
    v_destination_workspaces := array(select workspace_id from public.categories
      where workspace_id in(select private.my_workspace_ids()) and name=lower(v_actual_category)
        and (v_id is null or id<>v_id));
    v_rename := public.rename_category(v_rename_from,v_name,v_juntar);
  end if;

  if (v_rename->>'juntou')::boolean then
    -- rename_category keeps the incumbent receiver appearance. A virtual receiver has
    -- unknown classification defaults; source defaults must not become receiver defaults.
    -- This rename is global. In every accessible workspace without an original receiver
    -- configuration, its moved source appearance survives but defaults become unknown.
    update public.categories set default_expense_pattern=null,default_expense_necessity=null
      where workspace_id in(select private.my_workspace_ids()) and name=lower(v_actual_category)
        and not (workspace_id=any(v_destination_workspaces))
        and (default_expense_pattern is not null or default_expense_necessity is not null);
    select * into v_result_category from public.categories
      where workspace_id=v_ws and name=lower(v_actual_category);
    if not found then
      insert into public.categories(workspace_id,user_id,name,icon,color,default_expense_pattern,default_expense_necessity)
        values(v_ws,auth.uid(),lower(v_actual_category),null,null,null,null) returning * into v_result_category;
    end if;
  elsif v_id is not null then
    update public.categories set icon=v_icon,color=v_color,
      default_expense_pattern=v_pattern,default_expense_necessity=v_necessity
      where id=v_id and workspace_id=v_ws returning * into v_result_category;
  else
    begin
      insert into public.categories(workspace_id,user_id,name,icon,color,default_expense_pattern,default_expense_necessity)
        values(v_ws,auth.uid(),v_name,v_icon,v_color,v_pattern,v_necessity) returning * into v_result_category;
    exception when unique_violation then
      raise exception 'CATEGORIA_CONFIGURACAO_DESATUALIZADA: a categoria já tem configuração';
    end;
  end if;

  if v_from is not null then
    -- Classification backfill updates only RLS-visible expense occurrences. Their metadata
    -- revision trigger may touch a parent, whose lock must precede every child lock/update.
    perform r.id from public.recurring_transactions r where exists(
      select 1 from public.transactions t where t.recurring_id=r.id and t.workspace_id=v_ws
        and t.category=v_actual_category and t.kind='expense' and t.pays_invoice_id is null
        and t.occurred_at between v_from and v_to and
          (t.expense_pattern_source is distinct from 'explicit' or t.expense_necessity_source is distinct from 'explicit'))
      order by r.id for update;
    perform p.id from public.installment_plans p where exists(
      select 1 from public.transactions t where t.installment_plan_id=p.id and t.workspace_id=v_ws
        and t.category=v_actual_category and t.kind='expense' and t.pays_invoice_id is null
        and t.occurred_at between v_from and v_to and
          (t.expense_pattern_source is distinct from 'explicit' or t.expense_necessity_source is distinct from 'explicit'))
      order by p.id for update;
    perform d.id from public.debts d where exists(
      select 1 from public.transactions t where t.debt_id=d.id and t.workspace_id=v_ws
        and t.category=v_actual_category and t.kind='expense' and t.pays_invoice_id is null
        and t.occurred_at between v_from and v_to and
          (t.expense_pattern_source is distinct from 'explicit' or t.expense_necessity_source is distinct from 'explicit'))
      order by d.id for update;
    perform t.id from public.transactions t where t.workspace_id=v_ws and t.category=v_actual_category
      and t.kind='expense' and t.pays_invoice_id is null and t.occurred_at between v_from and v_to
      and (t.expense_pattern_source is distinct from 'explicit' or t.expense_necessity_source is distinct from 'explicit')
      order by t.id for update;
    v_old_request := current_setting('proops.category_backfill_request',true);
    v_old_category := current_setting('proops.category_backfill_category',true);
    perform set_config('proops.category_backfill_request',p_request_id::text,true);
    perform set_config('proops.category_backfill_category',v_actual_category,true);
    update public.transactions t set
      expense_pattern=case when t.expense_pattern_source='explicit' then t.expense_pattern else v_pattern end,
      expense_pattern_source=case when t.expense_pattern_source='explicit' then 'explicit' when v_pattern is not null then 'category_default' end,
      expense_necessity=case when t.expense_necessity_source='explicit' then t.expense_necessity else v_necessity end,
      expense_necessity_source=case when t.expense_necessity_source='explicit' then 'explicit' when v_necessity is not null then 'category_default' end
      where t.workspace_id=v_ws and t.category=v_actual_category and t.kind='expense' and t.pays_invoice_id is null
        and t.occurred_at between v_from and v_to and (
          (t.expense_pattern_source is distinct from 'explicit' and
            (t.expense_pattern is distinct from v_pattern or t.expense_pattern_source is distinct from
              case when v_pattern is not null then 'category_default' end))
          or (t.expense_necessity_source is distinct from 'explicit' and
            (t.expense_necessity is distinct from v_necessity or t.expense_necessity_source is distinct from
              case when v_necessity is not null then 'category_default' end)));
    get diagnostics v_updated = row_count;
    perform set_config('proops.category_backfill_request',coalesce(v_old_request,''),true);
    perform set_config('proops.category_backfill_category',coalesce(v_old_category,''),true);
  end if;
  v_result := jsonb_build_object('configuration_id',v_result_category.id,'category',v_actual_category,
    'default_expense_pattern',v_result_category.default_expense_pattern,'default_expense_necessity',v_result_category.default_expense_necessity,
    'edit_revision',v_result_category.edit_revision,'juntou',(v_rename->>'juntou')::boolean,
    'orcamentos_descartados',(v_rename->>'orcamentos_descartados')::bigint,'backfill_updated',v_updated);
  perform private.finish_payment_request(p_request_id,v_result);
  return v_result;
end $$;
revoke execute on function public.save_category_configuration(jsonb,uuid) from public, anon;
grant execute on function public.save_category_configuration(jsonb,uuid) to authenticated;

-- Append four fields to the incumbent five columns. Appearance retains its global fallback;
-- configuration identity/defaults/revision exclusively come from the default workspace.
drop function public.categories_used();
create function public.categories_used()
returns table(category text,uses bigint,icon text,color text,budgets bigint,
  configuration_id uuid,default_expense_pattern text,default_expense_necessity text,edit_revision bigint)
language sql stable security invoker set search_path = ''
as $$
  with usadas as (
    select t.category,count(*)::bigint uses from public.transactions t
      where t.workspace_id in(select private.my_workspace_ids()) and coalesce(t.category,'')<>'' group by t.category
  ), nomes as (
    select usadas.category from usadas
    union select c.name from public.categories c where c.workspace_id in(select private.my_workspace_ids())
  )
  select n.category,coalesce(u.uses,0)::bigint,c.icon,c.color,
    (select count(*) from public.budgets b where b.category=n.category and b.workspace_id in(select private.my_workspace_ids()))::bigint,
    config.id,config.default_expense_pattern,config.default_expense_necessity,config.edit_revision
  from nomes n left join usadas u on u.category=n.category
  left join lateral (
    select c.icon,c.color from public.categories c where c.name=lower(n.category)
      and c.workspace_id in(select private.my_workspace_ids())
      order by (c.workspace_id=public.my_default_workspace()) desc,c.created_at limit 1
  ) c on true
  left join public.categories config on config.workspace_id=public.my_default_workspace() and config.name=lower(n.category)
  order by coalesce(u.uses,0) desc,n.category;
$$;
revoke execute on function public.categories_used() from public, anon;
grant execute on function public.categories_used() to authenticated;
