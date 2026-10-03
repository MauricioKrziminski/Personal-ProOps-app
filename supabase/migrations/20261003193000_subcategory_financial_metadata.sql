-- F09: optional subcategory snapshots extend the existing atomic financial commands.
-- Full client intent stays in the original receipt. Only the financial core sees stripped metadata.
create or replace function private.subcategory_patch(p_input jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
begin
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Detalhe de categoria inválido';end if;
  if not(p_input?'subcategory_id') then return '{}';end if;
  if jsonb_typeof(p_input->'subcategory_id') not in('string','null') then raise exception 'Detalhe de categoria inválido';end if;
  if p_input->>'subcategory_id' is not null and p_input->>'subcategory_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Identificador do detalhe inválido';end if;
  return jsonb_build_object('subcategory_id',(p_input->>'subcategory_id')::uuid);
end $$;
create or replace function private.financial_metadata_patch(p_input jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select private.expense_classification_patch(p_input)||private.subcategory_patch(p_input)
$$;
create or replace function private.subcategory_compatible(p_workspace uuid,p_category text,p_child uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select p_child is null or exists(select 1 from public.subcategories s where s.id=p_child
    and s.workspace_id=p_workspace and s.parent_key=private.fold(p_category))
$$;
-- Preflight explicit intent against the FINAL parent before calling any financial core.
-- Rows remain protected by source RLS, and the catalog FK protects commit-time races.
create or replace function private.preflight_subcategory(p_table text,p_ids uuid[],p_input jsonb,p_category_key text default 'category')
returns void language plpgsql security invoker set search_path='' as $$
declare p jsonb:=private.subcategory_patch(p_input);r record;parent_col text;
begin
  if p_table is null or p_table not in('transactions','recurring_transactions','installment_plans','debts')
    or p_category_key is null or p_category_key not in('category','p_category','payment_category') then raise exception 'Origem do detalhe inválida';end if;
  if p='{}' then return;end if;
  if p_table='transactions' then
    perform 1 from public.recurring_transactions where id in(select recurring_id from public.transactions where id=any(p_ids)) order by id for update;
    perform 1 from public.installment_plans where id in(select installment_plan_id from public.transactions where id=any(p_ids)) order by id for update;
    perform 1 from public.debts where id in(select debt_id from public.transactions where id=any(p_ids)) order by id for update;
  end if;
  parent_col:=case when p_table='debts' then 'payment_category' else 'category' end;
  for r in execute format('select workspace_id,%I as category from public.%I where id=any($1) order by id for update',parent_col,p_table) using p_ids loop
    perform private.validate_subcategory_reference(r.workspace_id,case when p_input?p_category_key then p_input->>p_category_key else r.category end,(p->>'subcategory_id')::uuid);
  end loop;
end $$;
create or replace function private.apply_subcategory(p_table text,p_ids uuid[],p_input jsonb)
returns bigint language plpgsql security invoker set search_path='' as $$
declare p jsonb:=private.subcategory_patch(p_input);changed bigint;child uuid;
begin
  perform private.preflight_subcategory(p_table,p_ids,p);
  if p='{}' then return 0;end if;
  child:=(p->>'subcategory_id')::uuid;
  if p_table='transactions' then
    perform 1 from public.recurring_transactions where id in(select recurring_id from public.transactions where id=any(p_ids)) order by id for update;
    perform 1 from public.installment_plans where id in(select installment_plan_id from public.transactions where id=any(p_ids)) order by id for update;
    perform 1 from public.debts where id in(select debt_id from public.transactions where id=any(p_ids)) order by id for update;
    if exists(select 1 from public.transactions where id=any(p_ids) and (pays_invoice_id is not null or pix_fee_for_transaction_id is not null) and child is not null) then
      raise exception 'Detalhe pertence ao lançamento principal';end if;
    update public.transactions set subcategory_id=child,subcategory_snapshot_set=true
      where id=any(p_ids) and (subcategory_id is distinct from child or not subcategory_snapshot_set);
  else
    execute format('update public.%I set subcategory_id=$2 where id=any($1) and subcategory_id is distinct from $2',p_table) using p_ids,child;
  end if;
  get diagnostics changed=row_count;return changed;
end $$;
create or replace function private.apply_financial_metadata(p_table text,p_ids uuid[],p_input jsonb)
returns bigint language plpgsql security invoker set search_path='' as $$
declare a bigint;b bigint;
begin
  a:=private.apply_subcategory(p_table,p_ids,p_input);
  b:=private.apply_expense_classification(p_table,p_ids,p_input);
  return greatest(a,b);
end $$;
create or replace function private.recurring_subcategory_at(p_recurring uuid,p_date date)
returns uuid language sql stable security invoker set search_path='' as $$
  select v.subcategory_id from private.recurring_history_versions v where v.recurring_id=p_recurring
    and v.valid_from<=p_date and (v.valid_through is null or v.valid_through>=p_date) order by v.valid_from desc limit 1
$$;
create or replace function private.debt_subcategory_at(p_debt uuid,p_no integer)
returns uuid language sql stable security invoker set search_path='' as $$
  select case when e.subcategory_set then e.subcategory_id else d.subcategory_id end
    from public.debts d left join public.debt_installment_edits e on e.debt_id=d.id and e.installment_no=p_no where d.id=p_debt
$$;
create or replace function private.subcategory_history_scope(p_recurring uuid,p_input jsonb,p_boundary date,p_all boolean)
returns void language plpgsql security definer set search_path='' as $$
declare p jsonb:=private.subcategory_patch(p_input);v private.recurring_history_versions%rowtype;r record;
begin
  if not exists(select 1 from public.recurring_transactions where id=p_recurring and workspace_id in(select private.my_workspace_ids()))
    and not (auth.uid() is null and (
      coalesce(current_setting('role',true),'none')='service_role'
      or session_user in('postgres','supabase_admin') and coalesce(current_setting('role',true),'none') in('none','postgres','supabase_admin'))) then
    raise exception 'Recorrência não autorizada';
  end if;
  if p='{}' then return;end if;
  if p_all is null or not p_all and p_boundary is null then raise exception 'Alcance do detalhe inválido';end if;
  for r in select * from private.recurring_history_versions where recurring_id=p_recurring
    and (p_all or valid_through is null or valid_through>=p_boundary) order by valid_from for update loop
    perform private.validate_subcategory_reference(r.workspace_id,r.category,(p->>'subcategory_id')::uuid);
  end loop;
  if not p_all then
    select * into v from private.recurring_history_versions where recurring_id=p_recurring and valid_from<p_boundary
      and (valid_through is null or valid_through>=p_boundary) order by valid_from desc limit 1 for update;
    if v.recurring_id is not null then
      update private.recurring_history_versions set valid_through=p_boundary-1 where recurring_id=v.recurring_id and valid_from=v.valid_from;
      insert into private.recurring_history_versions(recurring_id,workspace_id,valid_from,valid_through,anchor_date,rrule,kind,
        amount_cents,category,description,account_id,end_date,inferred_before,payment_method,expense_pattern,
        expense_pattern_source,expense_necessity,expense_necessity_source,metadata_snapshot_set,subcategory_id,subcategory_snapshot_set)
      values(v.recurring_id,v.workspace_id,p_boundary,v.valid_through,v.anchor_date,v.rrule,v.kind,v.amount_cents,v.category,
        v.description,v.account_id,v.end_date,v.inferred_before,v.payment_method,v.expense_pattern,v.expense_pattern_source,
        v.expense_necessity,v.expense_necessity_source,true,v.subcategory_id,v.subcategory_snapshot_set);
    end if;
  end if;
  update private.recurring_history_versions set subcategory_id=(p->>'subcategory_id')::uuid,subcategory_snapshot_set=true
    where recurring_id=p_recurring and (p_all or valid_from>=p_boundary);
end $$;
create or replace function private.apply_recurring_financial_metadata(p_recurring uuid,p_ids uuid[],p_input jsonb,p_boundary date,p_all boolean)
returns bigint language plpgsql security invoker set search_path='' as $$
declare a bigint;b bigint;parent_changed bigint;previous text:=coalesce(current_setting('proops.subcategory_scope_adapter',true),'');
begin
  perform set_config('proops.subcategory_scope_adapter','on',true);
  parent_changed:=private.apply_subcategory('recurring_transactions',array[p_recurring],p_input);
  if p_input?'subcategory_id' and parent_changed=0 then
    update public.recurring_transactions set subcategory_id=subcategory_id where id=p_recurring;
    get diagnostics parent_changed=row_count;
  end if;
  perform set_config('proops.subcategory_scope_adapter',previous,true);
  a:=private.apply_subcategory('transactions',p_ids,p_input);
  perform private.subcategory_history_scope(p_recurring,p_input,p_boundary,p_all);
  b:=private.apply_recurring_expense_classification(p_recurring,p_ids,p_input,p_boundary,p_all);
  return greatest(a,b,parent_changed);
end $$;
create or replace function private.track_subcategory_history()
returns trigger language plpgsql security invoker set search_path='' set timezone='America/Sao_Paulo' as $$ begin
  if old.subcategory_id is distinct from new.subcategory_id and coalesce(current_setting('proops.subcategory_scope_adapter',true),'')<>'on'
    and coalesce(current_setting('proops.renomeando_categoria',true),'')<>'on' then
    perform private.subcategory_history_scope(new.id,jsonb_build_object('subcategory_id',new.subcategory_id),current_date,false);
  end if;
  return null;
end $$;
create trigger zz_track_subcategory_history after update of subcategory_id on public.recurring_transactions
  for each row execute function private.track_subcategory_history();
-- INSERT inherits only an omitted snapshot. Adoption deliberately preserves the existing
-- transaction's choice (including null), so linking a past purchase cannot invent detail.
create or replace function private.inherit_subcategory()
returns trigger language plpgsql security invoker set search_path='' as $$
declare child uuid;ws uuid;
begin
  if new.subcategory_snapshot_set or new.subcategory_id is not null then new.subcategory_snapshot_set:=true;return new;end if;
  if new.pays_invoice_id is not null or new.pix_fee_for_transaction_id is not null then new.subcategory_snapshot_set:=true;return new;end if;
  if new.recurring_id is not null then
    select workspace_id into ws from public.recurring_transactions where id=new.recurring_id;
    child:=private.recurring_subcategory_at(new.recurring_id,new.occurred_at);
  elsif new.installment_plan_id is not null or new.down_payment_plan_id is not null then
    select workspace_id,subcategory_id into ws,child from public.installment_plans where id=coalesce(new.installment_plan_id,new.down_payment_plan_id);
  elsif new.debt_id is not null then
    select workspace_id into ws from public.debts where id=new.debt_id;
    child:=private.debt_subcategory_at(new.debt_id,new.debt_payment_no);
  elsif new.down_payment_debt_id is not null then
    select workspace_id,subcategory_id into ws,child from public.debts where id=new.down_payment_debt_id;
  end if;
  if ws is not null and ws is distinct from new.workspace_id then raise exception 'Origem do detalhe precisa pertencer ao mesmo workspace';end if;
  if private.subcategory_compatible(new.workspace_id,new.category,child) then new.subcategory_id:=child;end if;
  new.subcategory_snapshot_set:=true;
  return new;
end $$;
create trigger zy_subcategory_inheritance before insert on public.transactions for each row execute function private.inherit_subcategory();

create or replace function private.payment_history_default()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.recurring_transactions%rowtype;v private.recurring_history_versions%rowtype;
begin
  if not new.metadata_snapshot_set then
    select * into p from public.recurring_transactions where id=new.recurring_id;
    new.payment_method:=p.payment_method;
    select * into v from private.recurring_history_versions where recurring_id=new.recurring_id
      and valid_from<=new.valid_from order by valid_from desc limit 1;
    if v.recurring_id is not null then
      new.expense_pattern:=v.expense_pattern;new.expense_pattern_source:=v.expense_pattern_source;
      new.expense_necessity:=v.expense_necessity;new.expense_necessity_source:=v.expense_necessity_source;
    else
      new.expense_pattern:=p.expense_pattern;new.expense_pattern_source:=p.expense_pattern_source;
      new.expense_necessity:=p.expense_necessity;new.expense_necessity_source:=p.expense_necessity_source;
    end if;
    new.metadata_snapshot_set:=true;
  end if;
  if not new.subcategory_snapshot_set and coalesce(current_setting('proops.subcategory_history_copy',true),'')<>'on' then
    select * into p from public.recurring_transactions where id=new.recurring_id;
    select * into v from private.recurring_history_versions where recurring_id=new.recurring_id and valid_from<=new.valid_from order by valid_from desc limit 1;
    new.subcategory_id:=case when v.recurring_id is not null then v.subcategory_id else p.subcategory_id end;
    if not private.subcategory_compatible(new.workspace_id,new.category,new.subcategory_id) then new.subcategory_id:=null;end if;
    new.subcategory_snapshot_set:=true;
  end if;
  if new.kind<>'expense' then
    new.expense_pattern:=null;new.expense_pattern_source:=null;new.expense_necessity:=null;new.expense_necessity_source:=null;
  end if;
  return new;
end $$;

create or replace function private.expense_classification_history_scope(p_recurring uuid,p_input jsonb,p_boundary date,p_all boolean)
returns void language plpgsql security definer set search_path='' as $$
declare p jsonb:=private.expense_classification_patch(p_input);v private.recurring_history_versions%rowtype;previous_copy text:=coalesce(current_setting('proops.subcategory_history_copy',true),'');
begin
  if not exists(select 1 from public.recurring_transactions r where r.id=p_recurring
    and r.workspace_id in(select private.my_workspace_ids())) then raise exception 'Recorrência não autorizada'; end if;
  if p='{}' then return; end if;
  if p_all is null or not p_all and p_boundary is null then raise exception 'Alcance da classificação inválido'; end if;
  if not p_all then
    select * into v from private.recurring_history_versions where recurring_id=p_recurring
      and valid_from<p_boundary and (valid_through is null or valid_through>=p_boundary)
      order by valid_from desc limit 1 for update;
    if v.recurring_id is not null then
      update private.recurring_history_versions set valid_through=p_boundary-1
        where recurring_id=v.recurring_id and valid_from=v.valid_from;
      perform set_config('proops.subcategory_history_copy','on',true);
      insert into private.recurring_history_versions(recurring_id,workspace_id,valid_from,valid_through,
        anchor_date,rrule,kind,amount_cents,category,description,account_id,end_date,inferred_before,payment_method,
        expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source,metadata_snapshot_set,subcategory_id,subcategory_snapshot_set)
      values(v.recurring_id,v.workspace_id,p_boundary,v.valid_through,v.anchor_date,v.rrule,v.kind,v.amount_cents,
        v.category,v.description,v.account_id,v.end_date,v.inferred_before,v.payment_method,
        v.expense_pattern,v.expense_pattern_source,v.expense_necessity,v.expense_necessity_source,true,v.subcategory_id,v.subcategory_snapshot_set);
      perform set_config('proops.subcategory_history_copy',previous_copy,true);
    end if;
  end if;
  update private.recurring_history_versions set
    expense_pattern=case when p?'expense_pattern' then p->>'expense_pattern' else expense_pattern end,
    expense_pattern_source=case when p?'expense_pattern' then p->>'expense_pattern_source' else expense_pattern_source end,
    expense_necessity=case when p?'expense_necessity' then p->>'expense_necessity' else expense_necessity end,
    expense_necessity_source=case when p?'expense_necessity' then p->>'expense_necessity_source' else expense_necessity_source end
    where recurring_id=p_recurring and (p_all or valid_from>=p_boundary) and kind='expense';
end $$;

create or replace function private.restore_recurring_metadata_history(p_recurring uuid,p_snapshots jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare calendars jsonb;previous_copy text:=coalesce(current_setting('proops.subcategory_history_copy',true),'');
begin
  if p_snapshots is null or jsonb_array_length(p_snapshots)=0 then return; end if;
  select jsonb_agg(to_jsonb(v) order by valid_from) into calendars
    from private.recurring_history_versions v where recurring_id=p_recurring;
  delete from private.recurring_history_versions where recurring_id=p_recurring;
  perform set_config('proops.subcategory_history_copy','on',true);
  insert into private.recurring_history_versions(recurring_id,workspace_id,valid_from,valid_through,
    anchor_date,inferred_before,rrule,kind,amount_cents,category,description,account_id,end_date,payment_method,
    expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source,metadata_snapshot_set,subcategory_id,subcategory_snapshot_set)
  with metadata as (
    select m.*,case when row_number() over(order by valid_from)=1 then '-infinity'::date else valid_from end as starts,
      lead(valid_from) over(order by valid_from)-1 as ends
    from jsonb_populate_recordset(null::private.recurring_history_versions,p_snapshots) m
  )
  select c.recurring_id,c.workspace_id,greatest(c.valid_from,m.starts),
    nullif(least(coalesce(c.valid_through,'infinity'::date),coalesce(m.ends,'infinity'::date)),'infinity'::date),
    c.anchor_date,c.inferred_before,c.rrule,c.kind,c.amount_cents,c.category,c.description,c.account_id,c.end_date,m.payment_method,
    case when c.kind='expense' then m.expense_pattern end,case when c.kind='expense' then m.expense_pattern_source end,
    case when c.kind='expense' then m.expense_necessity end,case when c.kind='expense' then m.expense_necessity_source end,true,
    case when private.subcategory_compatible(c.workspace_id,c.category,m.subcategory_id) then m.subcategory_id end,m.subcategory_snapshot_set
  from jsonb_populate_recordset(null::private.recurring_history_versions,calendars) c join metadata m
    on m.starts<=coalesce(c.valid_through,'infinity'::date) and coalesce(m.ends,'infinity'::date)>=c.valid_from;
  perform set_config('proops.subcategory_history_copy',previous_copy,true);
end $$;

create or replace function private.payment_history_scope(p_recurring uuid,p_method text,p_boundary date,p_all boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v private.recurring_history_versions%rowtype;previous_copy text:=coalesce(current_setting('proops.subcategory_history_copy',true),'');
begin
  if not exists(select 1 from public.recurring_transactions r where r.id=p_recurring
      and r.workspace_id in(select private.my_workspace_ids())) then raise exception 'Recorrência não autorizada'; end if;
  if p_all then
    update private.recurring_history_versions set payment_method=p_method where recurring_id=p_recurring;
  else
    select * into v from private.recurring_history_versions where recurring_id=p_recurring
      and valid_from<p_boundary and (valid_through is null or valid_through>=p_boundary)
      order by valid_from desc limit 1 for update;
    if v.recurring_id is not null then
      update private.recurring_history_versions set valid_through=p_boundary-1 where recurring_id=v.recurring_id and valid_from=v.valid_from;
      perform set_config('proops.subcategory_history_copy','on',true);
      insert into private.recurring_history_versions(recurring_id,workspace_id,valid_from,valid_through,
        anchor_date,rrule,kind,amount_cents,category,description,account_id,end_date,inferred_before,payment_method,expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source,metadata_snapshot_set,subcategory_id,subcategory_snapshot_set)
      values(v.recurring_id,v.workspace_id,p_boundary,v.valid_through,v.anchor_date,v.rrule,v.kind,
        v.amount_cents,v.category,v.description,v.account_id,v.end_date,v.inferred_before,p_method,v.expense_pattern,v.expense_pattern_source,v.expense_necessity,v.expense_necessity_source,true,v.subcategory_id,v.subcategory_snapshot_set);
      perform set_config('proops.subcategory_history_copy',previous_copy,true);
    end if;
    update private.recurring_history_versions set payment_method=p_method where recurring_id=p_recurring and valid_from>=p_boundary;
  end if;
end $$;

create or replace function private.restore_debt_classification_exceptions(p_debt uuid,p_snapshots jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare e record;maximum_no integer;
begin
  select greatest(installments,installments_paid) into maximum_no from public.debts where id=p_debt;
  for e in select * from jsonb_populate_recordset(null::public.debt_installment_edits,coalesce(p_snapshots,'[]'::jsonb)) loop
    if e.installment_no<=maximum_no and (e.expense_pattern_set or e.expense_necessity_set or e.subcategory_set or e.category_set) then
      insert into public.debt_installment_edits(debt_id,installment_no,expense_pattern,expense_pattern_source,
        expense_pattern_set,expense_necessity,expense_necessity_source,expense_necessity_set,subcategory_id,subcategory_set,category,category_set)
      values(p_debt,e.installment_no,e.expense_pattern,e.expense_pattern_source,e.expense_pattern_set,
        e.expense_necessity,e.expense_necessity_source,e.expense_necessity_set,
        case when private.subcategory_compatible((select workspace_id from public.debts where id=p_debt),case when e.category_set then e.category else (select payment_category from public.debts where id=p_debt) end,e.subcategory_id) then e.subcategory_id end,e.subcategory_set,e.category,e.category_set)
      on conflict(debt_id,installment_no) do update set
        expense_pattern=excluded.expense_pattern,expense_pattern_source=excluded.expense_pattern_source,
        expense_pattern_set=excluded.expense_pattern_set,expense_necessity=excluded.expense_necessity,
        expense_necessity_source=excluded.expense_necessity_source,expense_necessity_set=excluded.expense_necessity_set,subcategory_id=excluded.subcategory_id,subcategory_set=excluded.subcategory_set,category=excluded.category,category_set=excluded.category_set;
    end if;
  end loop;
end $$;

create or replace function private.apply_debt_expense_classification(p_debt uuid,p_ids uuid[],p_anchor integer,p_scope text,p_input jsonb)
returns bigint language plpgsql security invoker set search_path='' as $$
declare p jsonb:=private.expense_classification_patch(p_input);d public.debts%rowtype;changed bigint;
begin
  if p='{}' then return 0;end if;
  if p_scope is null or p_scope not in('one','future','all') then raise exception 'Alcance da classificação da dívida inválido';end if;
  select * into d from public.debts where id=p_debt for update;
  if d.id is null then raise exception 'Dívida não encontrada';end if;
  if p_scope='one' then
    insert into public.debt_installment_edits(debt_id,installment_no,expense_pattern,expense_pattern_source,
      expense_pattern_set,expense_necessity,expense_necessity_source,expense_necessity_set)
    values(d.id,p_anchor,p->>'expense_pattern',p->>'expense_pattern_source',p?'expense_pattern',
      p->>'expense_necessity',p->>'expense_necessity_source',p?'expense_necessity')
    on conflict(debt_id,installment_no) do update set
      expense_pattern=case when p?'expense_pattern' then excluded.expense_pattern else debt_installment_edits.expense_pattern end,
      expense_pattern_source=case when p?'expense_pattern' then excluded.expense_pattern_source else debt_installment_edits.expense_pattern_source end,
      expense_pattern_set=debt_installment_edits.expense_pattern_set or excluded.expense_pattern_set,
      expense_necessity=case when p?'expense_necessity' then excluded.expense_necessity else debt_installment_edits.expense_necessity end,
      expense_necessity_source=case when p?'expense_necessity' then excluded.expense_necessity_source else debt_installment_edits.expense_necessity_source end,
      expense_necessity_set=debt_installment_edits.expense_necessity_set or excluded.expense_necessity_set;
    update public.debts set expense_pattern=expense_pattern where id=d.id;
  else
    if p_scope='future' then
      insert into public.debt_installment_edits(debt_id,installment_no,expense_pattern,expense_pattern_source,
        expense_pattern_set,expense_necessity,expense_necessity_source,expense_necessity_set)
      select d.id,n,case when p?'expense_pattern' then d.expense_pattern end,
        case when p?'expense_pattern' then d.expense_pattern_source end,p?'expense_pattern',
        case when p?'expense_necessity' then d.expense_necessity end,
        case when p?'expense_necessity' then d.expense_necessity_source end,p?'expense_necessity'
        from generate_series(1,p_anchor-1) n
      on conflict(debt_id,installment_no) do update set
        expense_pattern=case when debt_installment_edits.expense_pattern_set then debt_installment_edits.expense_pattern else excluded.expense_pattern end,
        expense_pattern_source=case when debt_installment_edits.expense_pattern_set then debt_installment_edits.expense_pattern_source else excluded.expense_pattern_source end,
        expense_pattern_set=debt_installment_edits.expense_pattern_set or excluded.expense_pattern_set,
        expense_necessity=case when debt_installment_edits.expense_necessity_set then debt_installment_edits.expense_necessity else excluded.expense_necessity end,
        expense_necessity_source=case when debt_installment_edits.expense_necessity_set then debt_installment_edits.expense_necessity_source else excluded.expense_necessity_source end,
        expense_necessity_set=debt_installment_edits.expense_necessity_set or excluded.expense_necessity_set;
    end if;
    delete from public.debt_installment_edits where debt_id=d.id and due_date is null and amount_cents is null
      and not payment_method_set and not subcategory_set and not category_set and (not expense_pattern_set or p?'expense_pattern')
      and (not expense_necessity_set or p?'expense_necessity') and (p_scope='all' or installment_no>=p_anchor);
    update public.debt_installment_edits set
      expense_pattern=case when p?'expense_pattern' then null else expense_pattern end,
      expense_pattern_source=case when p?'expense_pattern' then null else expense_pattern_source end,
      expense_pattern_set=case when p?'expense_pattern' then false else expense_pattern_set end,
      expense_necessity=case when p?'expense_necessity' then null else expense_necessity end,
      expense_necessity_source=case when p?'expense_necessity' then null else expense_necessity_source end,
      expense_necessity_set=case when p?'expense_necessity' then false else expense_necessity_set end
      where debt_id=d.id and (p_scope='all' or installment_no>=p_anchor);
    delete from public.debt_installment_edits where debt_id=d.id and due_date is null and amount_cents is null
      and not payment_method_set and not subcategory_set and not category_set and not expense_pattern_set and not expense_necessity_set;
    -- Advance the revision even if resetting exceptions retains the same parent values.
    update public.debts set
      expense_pattern=case when p?'expense_pattern' then p->>'expense_pattern' else expense_pattern end,
      expense_pattern_source=case when p?'expense_pattern' then p->>'expense_pattern_source' else expense_pattern_source end,
      expense_necessity=case when p?'expense_necessity' then p->>'expense_necessity' else expense_necessity end,
      expense_necessity_source=case when p?'expense_necessity' then p->>'expense_necessity_source' else expense_necessity_source end
      where id=d.id;
  end if;
  changed:=private.apply_expense_classification('transactions',p_ids,p);
  return changed;
end $$;

create function private.join_financial_metadata_patches(p_line jsonb,p_series jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare a jsonb:=private.financial_metadata_patch(p_line);b jsonb:=private.financial_metadata_patch(p_series);k text;
begin
  foreach k in array array['expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'] loop
    if a?k and b?k and a->k is distinct from b->k then raise exception 'Classificação da ocorrência e da regra precisam coincidir';end if;
  end loop;
  return a||b;
end $$;

create or replace function private.advance_classification_parent_revision()
returns trigger language plpgsql security invoker set search_path='' as $$ begin
  if row(old.expense_pattern,old.expense_pattern_source,old.expense_necessity,old.expense_necessity_source)
    is distinct from row(new.expense_pattern,new.expense_pattern_source,new.expense_necessity,new.expense_necessity_source) or old.subcategory_id is distinct from new.subcategory_id or old.subcategory_snapshot_set is distinct from new.subcategory_snapshot_set then
    update public.recurring_transactions set expense_pattern=expense_pattern where id=new.recurring_id;
    update public.installment_plans set expense_pattern=expense_pattern where id=new.installment_plan_id;
    update public.debts set expense_pattern=expense_pattern where id=new.debt_id;
  end if;
  return null;
end $$;

create or replace function private.apply_debt_financial_metadata(p_debt uuid,p_ids uuid[],p_anchor integer,p_scope text,p_input jsonb)
returns bigint language plpgsql security invoker set search_path='' as $$
declare p jsonb:=private.subcategory_patch(p_input);d public.debts%rowtype;r record;changed bigint:=0;
begin
  if p<>'{}' then
    if p_scope is null or p_scope not in('one','future','all') or p_anchor is null then raise exception 'Alcance do detalhe da dívida inválido';end if;
    select * into d from public.debts where id=p_debt for update;
    if d.id is null then raise exception 'Dívida não encontrada';end if;
    -- Each explicit exception has its own effective parent after structural moves.
    for r in select case when e.category_set then e.category else d.payment_category end as category
      from generate_series(case when p_scope='all' then 1 else p_anchor end,
        case when p_scope='one' then p_anchor else greatest(d.installments,d.installments_paid) end) g(n)
      left join public.debt_installment_edits e on e.debt_id=d.id and e.installment_no=g.n loop
      perform private.validate_subcategory_reference(d.workspace_id,r.category,(p->>'subcategory_id')::uuid);
    end loop;
    if p_scope='one' then
      insert into public.debt_installment_edits(debt_id,installment_no,subcategory_id,subcategory_set)
        values(d.id,p_anchor,(p->>'subcategory_id')::uuid,true)
        on conflict(debt_id,installment_no) do update set subcategory_id=excluded.subcategory_id,subcategory_set=true;
      update public.debts set subcategory_id=subcategory_id where id=d.id;
    else
      perform private.validate_subcategory_reference(d.workspace_id,d.payment_category,(p->>'subcategory_id')::uuid);
      if p_scope='future' then
        insert into public.debt_installment_edits(debt_id,installment_no,subcategory_id,subcategory_set)
          select d.id,gs.installment_no,d.subcategory_id,true from generate_series(1,p_anchor-1) as gs(installment_no)
          on conflict(debt_id,installment_no) do update set subcategory_id=case when debt_installment_edits.subcategory_set
            then debt_installment_edits.subcategory_id else excluded.subcategory_id end,subcategory_set=true;
      end if;
      delete from public.debt_installment_edits where debt_id=d.id and (p_scope='all' or installment_no>=p_anchor)
        and due_date is null and amount_cents is null and not payment_method_set and not expense_pattern_set
        and not expense_necessity_set and not category_set;
      update public.debt_installment_edits set subcategory_id=null,subcategory_set=false
        where debt_id=d.id and (p_scope='all' or installment_no>=p_anchor);
      delete from public.debt_installment_edits where debt_id=d.id and due_date is null and amount_cents is null
        and not payment_method_set and not expense_pattern_set and not expense_necessity_set and not subcategory_set and not category_set;
      update public.debts set subcategory_id=(p->>'subcategory_id')::uuid where id=d.id;
    end if;
    changed:=private.apply_subcategory('transactions',p_ids,p);
  end if;
  return greatest(changed,private.apply_debt_expense_classification(p_debt,p_ids,p_anchor,p_scope,p_input));
end $$;
-- Category is a dated debt default as soon as an E snapshot needs another parent.
-- Preserve past defaults before the legacy payment core changes the debt parent.
create or replace function private.prepare_debt_subcategory_parent(p_debt uuid,p_anchor integer,p_scope text,p_input jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare d public.debts%rowtype;
begin
  if not(p_input?'category') or p_scope='one' or coalesce(current_setting('proops.renomeando_categoria',true),'')='on' then return;end if;
  select * into d from public.debts where id=p_debt for update;
  if p_scope='from_here' then
    insert into public.debt_installment_edits(debt_id,installment_no,category,category_set,subcategory_id,subcategory_set)
      select d.id,n,d.payment_category,true,d.subcategory_id,true from generate_series(1,p_anchor-1) n
      on conflict(debt_id,installment_no) do update set
        category=case when debt_installment_edits.category_set then debt_installment_edits.category else excluded.category end,
        category_set=true,subcategory_id=case when debt_installment_edits.subcategory_set then debt_installment_edits.subcategory_id else excluded.subcategory_id end,
        subcategory_set=true;
  end if;
  update public.debt_installment_edits set category=p_input->>'category',category_set=true,
    subcategory_set=case when p_input?'subcategory_id' then true else subcategory_set end,
    subcategory_id=case when p_input?'subcategory_id' then (p_input->>'subcategory_id')::uuid
      when private.subcategory_compatible(d.workspace_id,p_input->>'category',subcategory_id) then subcategory_id end
    where debt_id=d.id and (p_scope='all' or installment_no>=p_anchor);
end $$;

create or replace function private.inserir_da_hipotese(p_tabela text,p_linha jsonb,p_permitidas text[])
returns uuid language plpgsql security invoker set search_path=public as $$
declare id uuid;r record;p jsonb:=private.financial_metadata_patch(p_linha);parent text;
begin
  if p_tabela is null or p_tabela not in('transactions','recurring_transactions','debts') then raise exception 'Origem inválida';end if;
  if p_linha?'subcategory_snapshot_set' then raise exception 'Snapshot do detalhe é interno';end if;
  parent:=case when p_tabela='debts' then p_linha->>'payment_category' else p_linha->>'category' end;
  if p?'subcategory_id' then perform private.validate_subcategory_reference(public.my_default_workspace(),parent,(p->>'subcategory_id')::uuid);end if;
  p_permitidas:=p_permitidas||array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'];
  if p_tabela='debts' then p_permitidas:=p_permitidas||array['payment_category'];end if;
  if p_tabela='transactions' and p?'subcategory_id' then
    p_linha:=p_linha||'{"subcategory_snapshot_set":true}'::jsonb;p_permitidas:=p_permitidas||array['subcategory_snapshot_set'];
  end if;
  id:=private.inserir_da_hipotese_payment_core(p_tabela,p_linha,p_permitidas);
  execute format('select payment_method,account_id,workspace_id from public.%I where id=$1',p_tabela) into r using id;
  perform private.validate_payment_method(r.payment_method,r.account_id,r.workspace_id);
  return id;
end $$;

create or replace function private.criar_registro_da_hipotese(p_tipo text,p_dados jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare p jsonb;result jsonb;parent uuid;ids uuid[];
begin
  p:=case when p_tipo='lancamento' then '{}'::jsonb else private.financial_metadata_patch(p_dados) end;
  if p_tipo='parcelada' and p?'subcategory_id' then
    perform private.validate_subcategory_reference(public.my_default_workspace(),p_dados->>'p_category',(p->>'subcategory_id')::uuid);
  end if;
  result:=private.criar_registro_da_hipotese_classification_core(p_tipo,case when p_tipo='parcelada'
    then p_dados-array['expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'] else p_dados end);
  if p_tipo='parcelada' and p<>'{}' then
    parent:=(result->'ids'->>0)::uuid;
    perform private.apply_financial_metadata('installment_plans',array[parent],p);
    ids:=array(select id from public.transactions where installment_plan_id=parent or down_payment_plan_id=parent);
    perform private.apply_financial_metadata('transactions',ids,p);
  end if;
  return result;
end $$;

create or replace function public.update_recurring_one(p_transaction_id uuid,p_patch jsonb,p_expected_revision bigint,p_request_id uuid)
returns bigint language plpgsql security invoker set search_path=public as $$
declare result jsonb;r public.transactions%rowtype;changed bigint:=0;p jsonb:=private.financial_metadata_patch(p_patch);
  financial jsonb:=p_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'];
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','update_recurring_one','id',p_transaction_id,'patch',p_patch,'revision',p_expected_revision));
  if result is not null then return (result->>'changed')::bigint;end if;
  perform private.preflight_subcategory('transactions',array[p_transaction_id],p_patch);
  if not(p_patch?'payment_method') and p='{}' then
    changed:=private.update_recurring_one_payment_core(p_transaction_id,p_patch,p_expected_revision,p_request_id);
  else
    perform 1 from public.recurring_transactions where id=(select recurring_id from public.transactions where id=p_transaction_id) for update;
    select * into r from public.transactions where id=p_transaction_id for update;
    if r.id is null or r.recurring_id is null then raise exception 'Ocorrência recorrente não encontrada';end if;
    if p_expected_revision is null or r.edit_revision is distinct from p_expected_revision then raise exception 'A ocorrência mudou enquanto você editava. Abra de novo';end if;
    if financial<>'{}' then changed:=private.update_recurring_one_payment_core(p_transaction_id,financial,p_expected_revision,p_request_id);end if;
    if p_patch?'payment_method' then changed:=greatest(changed,private.apply_payment_metadata('transactions',array[r.id],p_patch->>'payment_method'));end if;
    changed:=greatest(changed,private.apply_financial_metadata('transactions',array[r.id],p));
  end if;
  perform private.finish_payment_request(p_request_id,jsonb_build_object('changed',changed));return changed;
end $$;

create or replace function public.update_recurring_all(p_recurring_id uuid,p_line_patch jsonb,p_series_patch jsonb,p_expected_revision bigint,p_request_id uuid)
returns bigint language plpgsql security invoker set search_path=public as $$
declare result jsonb;r public.recurring_transactions%rowtype;changed bigint:=0;ids uuid[];
  p jsonb:=private.join_financial_metadata_patches(p_line_patch,p_series_patch);
  lf jsonb:=p_line_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'];
  sf jsonb:=p_series_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'];
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','update_recurring_all','id',p_recurring_id,'lines',p_line_patch,'series',p_series_patch,'revision',p_expected_revision));
  if result is not null then return (result->>'changed')::bigint;end if;
  perform private.preflight_subcategory('recurring_transactions',array[p_recurring_id],p_series_patch||p_line_patch);
  if not(p_line_patch?'payment_method' or p_series_patch?'payment_method') and p='{}' then
    changed:=private.update_recurring_all_payment_core(p_recurring_id,p_line_patch,p_series_patch,p_expected_revision,p_request_id);
  else
    if p_line_patch?'payment_method' and p_series_patch?'payment_method' and p_line_patch->'payment_method' is distinct from p_series_patch->'payment_method' then raise exception 'Forma da ocorrência e da regra precisam coincidir';end if;
    select * into r from public.recurring_transactions where id=p_recurring_id for update;
    if r.id is null then raise exception 'Recorrência não encontrada';end if;
    if p_expected_revision is null or r.edit_revision is distinct from p_expected_revision then raise exception 'A recorrência mudou enquanto você editava. Abra de novo';end if;
    perform 1 from public.transactions where recurring_id=r.id order by id for update;
    if lf<>'{}' or sf<>'{}' then changed:=private.update_recurring_all_payment_core(p_recurring_id,lf,sf,p_expected_revision,p_request_id);end if;
    ids:=array(select id from public.transactions where recurring_id=r.id);
    if p_line_patch?'payment_method' or p_series_patch?'payment_method' then
      changed:=greatest(changed,private.apply_recurring_payment(r.id,ids,(p_series_patch||p_line_patch)->>'payment_method',current_date,true));end if;
    changed:=greatest(changed,private.apply_recurring_financial_metadata(r.id,ids,p,current_date,true));
  end if;
  perform private.finish_payment_request(p_request_id,jsonb_build_object('changed',changed));return changed;
end $$;

create or replace function public.update_recurring_future(p_transaction_id uuid,p_recurring_id uuid,p_line_patch jsonb,p_series_patch jsonb,p_expected_revision bigint,p_request_id uuid)
returns bigint language plpgsql security invoker set search_path=public set timezone='America/Sao_Paulo' as $$
declare result jsonb;r public.recurring_transactions%rowtype;a public.transactions%rowtype;changed bigint:=0;
  ids uuid[];before_ids uuid[];boundary date:=current_date;boundary_key text;previous_boundary text;
  previous_subcategory_scope text:=coalesce(current_setting('proops.subcategory_scope_adapter',true),'');
  previous_classification_scope text:=coalesce(current_setting('proops.classification_scope_adapter',true),'');
  p jsonb:=private.join_financial_metadata_patches(p_line_patch,p_series_patch);
  lf jsonb:=p_line_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'];
  sf jsonb:=p_series_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'];
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','update_recurring_future','id',p_recurring_id,'anchor',p_transaction_id,'lines',p_line_patch,'series',p_series_patch,'revision',p_expected_revision));
  if result is not null then return (result->>'changed')::bigint;end if;
  perform private.preflight_subcategory('recurring_transactions',array[p_recurring_id],p_line_patch||p_series_patch);
  -- Stabilize the same parent/anchor used by the existing selector before computing history.
  select * into r from public.recurring_transactions where id=p_recurring_id for update;
  if r.id is null then raise exception 'Recorrência não encontrada';end if;
  if p_transaction_id is not null then
    select * into a from public.transactions where id=p_transaction_id for update;
    if a.id is null or a.recurring_id is distinct from r.id or a.workspace_id is distinct from r.workspace_id then
      raise exception 'Ocorrência não pertence à recorrência';
    end if;
    boundary:=greatest(current_date,case when a.invoice_id is null then coalesce(a.due_at,a.occurred_at) else a.occurred_at end);
  end if;
  boundary_key:='proops.subcategory_financial_boundary_'||replace(r.id::text,'-','');
  previous_boundary:=coalesce(current_setting(boundary_key,true),'');
  perform set_config(boundary_key,boundary::text,true);
  perform set_config('proops.subcategory_scope_adapter','on',true);
  perform set_config('proops.classification_scope_adapter','on',true);
  if not(p_line_patch?'payment_method' or p_series_patch?'payment_method') and p='{}' then
    changed:=private.update_recurring_future_payment_core(p_transaction_id,p_recurring_id,p_line_patch,p_series_patch,p_expected_revision,p_request_id);
  else
    if p_transaction_id is null and p_line_patch<>'{}' then raise exception 'Uma alteração de ocorrência precisa da referência';end if;
    if p_line_patch?'payment_method' and p_series_patch?'payment_method' and p_line_patch->'payment_method' is distinct from p_series_patch->'payment_method' then raise exception 'Forma da ocorrência e da regra precisam coincidir';end if;
    select * into r from public.recurring_transactions where id=p_recurring_id for update;
    if r.id is null then raise exception 'Recorrência não encontrada';end if;
    if p_expected_revision is null or r.edit_revision is distinct from p_expected_revision then raise exception 'A recorrência mudou enquanto você editava. Abra de novo';end if;
    ids:=private.recurring_payment_targets(r.id,p_transaction_id);
    before_ids:=array(select id from public.transactions where recurring_id=r.id);
    if p_transaction_id is not null then
      select * into a from public.transactions where id=p_transaction_id;
      boundary:=greatest(current_date,case when a.invoice_id is null then coalesce(a.due_at,a.occurred_at) else a.occurred_at end);
    end if;
    if lf<>'{}' or sf<>'{}' then changed:=private.update_recurring_future_payment_core(p_transaction_id,p_recurring_id,lf,sf,p_expected_revision,p_request_id);end if;
    ids:=ids||array(select id from public.transactions where recurring_id=r.id and not(id=any(before_ids)));
    if p_line_patch?'payment_method' or p_series_patch?'payment_method' then
      changed:=greatest(changed,private.apply_recurring_payment(r.id,ids,(p_series_patch||p_line_patch)->>'payment_method',boundary,false));end if;
    changed:=greatest(changed,private.apply_recurring_financial_metadata(r.id,ids,p,boundary,false));
  end if;
  perform set_config(boundary_key,previous_boundary,true);
  perform set_config('proops.subcategory_scope_adapter',previous_subcategory_scope,true);
  perform set_config('proops.classification_scope_adapter',previous_classification_scope,true);
  perform private.finish_payment_request(p_request_id,jsonb_build_object('changed',changed));return changed;
end $$;

create or replace function public.save_transaction_payment(
  p_transaction_id uuid,p_input jsonb,p_fee_cents bigint,p_expected_revision bigint,p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path=public set timezone='America/Sao_Paulo' as $$
declare r public.transactions%rowtype; fee uuid; result jsonb; payload jsonb; uid uuid:=auth.uid();
  allowed text[]:=array['kind','amount_cents','category','description','merchant','account_id','counterparty_account_id','occurred_at','status','due_at','auto_confirm','payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'];
begin
  if uid is null then raise exception 'Autenticação obrigatória'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' or exists(select 1 from jsonb_object_keys(p_input) k where k<>all(allowed)) then raise exception 'Campos do lançamento inválidos'; end if;
  if p_fee_cents<0 or p_fee_cents>9007199254740991 then raise exception 'Juro inválido'; end if;
  if p_input ? 'amount_cents' and (jsonb_typeof(p_input->'amount_cents') is distinct from 'number'
    or (p_input->>'amount_cents')::numeric<>trunc((p_input->>'amount_cents')::numeric)
    or (p_input->>'amount_cents')::numeric not between 1 and 9007199254740991) then raise exception 'Valor em centavos inteiros e positivos obrigatório'; end if;
  if p_input ? 'payment_method' and jsonb_typeof(p_input->'payment_method') not in('string','null') then raise exception 'Forma de pagamento inválida'; end if;
  perform private.financial_metadata_patch(p_input);
  payload:=jsonb_build_object('operation','save_transaction_payment','id',p_transaction_id,'input',p_input,'fee',p_fee_cents,'revision',p_expected_revision);
  result:=private.reserve_payment_request(p_request_id,payload); if result is not null then return result; end if;
  if p_transaction_id is null then
    if p_expected_revision is not null then raise exception 'Criação não recebe revisão anterior'; end if;
    p_transaction_id:=private.inserir_da_hipotese('transactions',p_input||'{"source":"app"}'::jsonb,allowed||array['source']);
  else
    select * into r from public.transactions where id=p_transaction_id for update;
    if r.id is null then raise exception 'Lançamento não encontrado'; end if;
    if p_expected_revision is null or r.edit_revision is distinct from p_expected_revision then raise exception 'O lançamento mudou enquanto você editava. Abra de novo'; end if;
    if r.pix_fee_for_transaction_id is not null then raise exception 'Edite o juro pela compra à qual ele pertence'; end if;
    if r.recurring_id is not null or r.installment_plan_id is not null or r.debt_id is not null then raise exception 'Edite este lançamento pelo alcance da série, compra ou dívida'; end if;
    perform private.preflight_subcategory('transactions',array[r.id],p_input);
    update public.transactions t set
      subcategory_id=case when p_input?'subcategory_id' then (p_input->>'subcategory_id')::uuid else t.subcategory_id end,
      subcategory_snapshot_set=case when p_input?'subcategory_id' then true else t.subcategory_snapshot_set end,
      kind=case when p_input?'kind' then p_input->>'kind' else t.kind end,
      amount_cents=case when p_input?'amount_cents' then (p_input->>'amount_cents')::bigint else t.amount_cents end,
      category=case when p_input?'category' then p_input->>'category' else t.category end,
      description=case when p_input?'description' then p_input->>'description' else t.description end,
      merchant=case when p_input?'merchant' then p_input->>'merchant' else t.merchant end,
      status=case when p_input?'status' then p_input->>'status' else t.status end,
      due_at=case when p_input?'due_at' then (p_input->>'due_at')::date else t.due_at end,
      auto_confirm=case when p_input?'auto_confirm' then (p_input->>'auto_confirm')::boolean else t.auto_confirm end,
      counterparty_account_id=case when p_input?'counterparty_account_id' then (p_input->>'counterparty_account_id')::uuid else t.counterparty_account_id end,
      payment_method=case when p_input?'payment_method' then p_input->>'payment_method' else t.payment_method end,
      expense_pattern=case when p_input?'expense_pattern' then p_input->>'expense_pattern' else t.expense_pattern end,
      expense_pattern_source=case when p_input?'expense_pattern_source' then p_input->>'expense_pattern_source' else t.expense_pattern_source end,
      expense_necessity=case when p_input?'expense_necessity' then p_input->>'expense_necessity' else t.expense_necessity end,
      expense_necessity_source=case when p_input?'expense_necessity_source' then p_input->>'expense_necessity_source' else t.expense_necessity_source end
      where t.id=p_transaction_id;
    if p_input?'account_id' then update public.transactions set account_id=(p_input->>'account_id')::uuid where id=p_transaction_id; end if;
    if p_input?'occurred_at' then update public.transactions set occurred_at=(p_input->>'occurred_at')::date where id=p_transaction_id; end if;
  end if;
  select * into r from public.transactions where id=p_transaction_id;
  perform private.validate_payment_method(r.payment_method,r.account_id,r.workspace_id);
  if r.counterparty_account_id is not null then perform private.validate_payment_method(null,r.counterparty_account_id,r.workspace_id); end if;
  select id into fee from public.transactions where pix_fee_for_transaction_id=r.id for update;
  if fee is not null and p_fee_cents is distinct from 0 and (r.payment_method is not null and r.payment_method<>'pix' or not exists(select 1 from public.accounts where id=r.account_id and type='credit_card')) then raise exception 'Zere o juro do Pix antes de mudar esta forma ou origem'; end if;
  if coalesce(p_fee_cents,0)>0 then
    if r.kind not in('expense','transfer') or r.installment_plan_id is not null or r.recurring_id is not null or r.debt_id is not null
      or r.payment_method is not null and r.payment_method<>'pix'
      or not exists(select 1 from public.accounts where id=r.account_id and type='credit_card') then raise exception 'Juro só vale para Pix no crédito avulso'; end if;
    if fee is null then
      insert into public.transactions(user_id,workspace_id,kind,amount_cents,category,description,account_id,occurred_at,source,status,payment_method,pix_fee_for_transaction_id)
      values(uid,r.workspace_id,'expense',p_fee_cents,'juros','Juros do Pix no crédito',r.account_id,r.occurred_at,'app',r.status,'pix',r.id) returning id into fee;
    else
      update public.transactions set amount_cents=p_fee_cents,account_id=r.account_id,occurred_at=r.occurred_at,payment_method='pix',status=r.status where id=fee;
    end if;
  elsif p_fee_cents=0 and fee is not null then delete from public.transactions where id=fee; fee:=null;
  elsif fee is not null then
    -- Fee omission preserves its amount but follows the explicitly owned parent account/date.
    update public.transactions set account_id=r.account_id,occurred_at=r.occurred_at where id=fee;
  end if;
  select * into r from public.transactions where id=p_transaction_id;
  result:=jsonb_build_object('id',r.id,'revision',r.edit_revision,'fee_id',fee);
  perform private.finish_payment_request(p_request_id,result); return result;
end $$;

create or replace function public.update_installment_occurrence(p_transaction_id uuid,p_patch jsonb)
returns bigint language plpgsql security invoker set search_path=public as $$
declare changed bigint:=0;r public.transactions%rowtype;p jsonb:=private.financial_metadata_patch(p_patch);
  financial jsonb:=p_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'];
begin
  perform private.preflight_subcategory('transactions',array[p_transaction_id],p_patch);
  if not(p_patch?'payment_method') and p='{}' then return private.update_installment_occurrence_payment_core(p_transaction_id,p_patch);end if;
  perform 1 from public.installment_plans where id=(select installment_plan_id from public.transactions where id=p_transaction_id) for update;
  select * into r from public.transactions where id=p_transaction_id for update;
  if r.id is null or r.installment_plan_id is null then raise exception 'Parcela não encontrada';end if;
  if financial<>'{}' then changed:=private.update_installment_occurrence_payment_core(p_transaction_id,financial);end if;
  if p_patch?'payment_method' then changed:=greatest(changed,private.apply_payment_metadata('transactions',array[r.id],p_patch->>'payment_method'));end if;
  return greatest(changed,private.apply_financial_metadata('transactions',array[r.id],p));
end $$;

create or replace function public.update_installment_scope(p_transaction_id uuid,p_scope text,p_patch jsonb)
returns bigint language plpgsql security invoker set search_path=public as $$
declare r public.transactions%rowtype;plan public.installment_plans%rowtype;ids uuid[];changed bigint:=0;
  p jsonb:=private.financial_metadata_patch(p_patch);
  financial jsonb:=p_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'];
begin
  perform private.preflight_subcategory('transactions',array[p_transaction_id],p_patch);
  if not(p_patch?'payment_method') and p='{}' then return private.update_installment_scope_payment_core(p_transaction_id,p_scope,p_patch);end if;
  if p_scope is null or p_scope not in('one','future','all') then raise exception 'Escolha quais parcelas editar';end if;
  select * into plan from public.installment_plans where id=(select installment_plan_id from public.transactions where id=p_transaction_id) for update;
  select * into r from public.transactions where id=p_transaction_id for update;
  if plan.id is null or r.id is null or r.installment_plan_id is distinct from plan.id then raise exception 'Parcela não encontrada';end if;
  perform 1 from public.transactions where installment_plan_id=plan.id order by id for update;
  ids:=array(select id from public.transactions where installment_plan_id=plan.id and
    (p_scope='all' or p_scope='one' and id=r.id or p_scope='future' and installment_no>=r.installment_no));
  if financial<>'{}' then changed:=private.update_installment_scope_payment_core(p_transaction_id,p_scope,financial);end if;
  if p_patch?'payment_method' then
    changed:=greatest(changed,private.apply_payment_metadata('transactions',ids,p_patch->>'payment_method'));
    if p_scope<>'one' then perform private.apply_payment_metadata('installment_plans',array[plan.id],p_patch->>'payment_method');end if;
  end if;
  changed:=greatest(changed,private.apply_financial_metadata('transactions',ids,p));
  if p_scope<>'one' then perform private.apply_financial_metadata('installment_plans',array[plan.id],p);end if;
  return changed;
end $$;

create or replace function public.update_installment_scope_checked(p_transaction_id uuid,p_scope text,p_patch jsonb,
  p_expected_plan_revision bigint,p_expected_anchor_revision bigint,p_request_id uuid,p_last_day boolean default false)
returns bigint language plpgsql security invoker set search_path='' as $$
declare plan public.installment_plans%rowtype;a public.transactions%rowtype;cached jsonb;changed bigint;
begin
  cached:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','update_installment_scope_checked',
    'id',p_transaction_id,'scope',p_scope,'patch',p_patch,'plan_revision',p_expected_plan_revision,
    'anchor_revision',p_expected_anchor_revision,'last_day',p_last_day));
  if cached is not null then return (cached->>'changed')::bigint;end if;
  if p_last_day is null then raise exception 'Escolha de calendário inválida';end if;
  select * into plan from public.installment_plans where id=(select installment_plan_id from public.transactions where id=p_transaction_id) for update;
  select * into a from public.transactions where id=p_transaction_id for update;
  if plan.id is null or a.id is null or a.installment_plan_id is distinct from plan.id then raise exception 'Parcela não encontrada';end if;
  if p_expected_plan_revision is null or p_expected_anchor_revision is null or plan.edit_revision is distinct from p_expected_plan_revision
    or a.edit_revision is distinct from p_expected_anchor_revision then raise exception 'A compra ou a parcela mudou enquanto você editava. Abra de novo';end if;
  changed:=case when p_last_day and p_scope<>'one' then public.update_installment_scope_last_day(p_transaction_id,p_scope,p_patch)
    else public.update_installment_scope(p_transaction_id,p_scope,p_patch) end;
  perform private.finish_payment_request(p_request_id,jsonb_build_object('changed',changed));return changed;
end $$;

create or replace function public.update_installment_plan_payment(p_input jsonb)
returns bigint language plpgsql security invoker set search_path=public as $$
declare plan public.installment_plans%rowtype;changed bigint;cached jsonb;request uuid;method text;explicit boolean;
  ids uuid[];p jsonb;snapshots jsonb;r record;restore jsonb;
begin
  if auth.uid() is null or p_input is null or jsonb_typeof(p_input)<>'object'
    or exists(select 1 from jsonb_object_keys(p_input) k where k not in('p_plan_id','p_total_cents','p_installments',
      'p_first_occurred_at','p_description','p_category','p_merchant','p_account_id','p_paid_installments','p_payment_method',
      'p_expected_revision','p_request_id','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id')) then raise exception 'Dados da compra inválidos';end if;
  p:=private.financial_metadata_patch(p_input);request:=(p_input->>'p_request_id')::uuid;
  if request is not null then
    cached:=private.reserve_payment_request(request,jsonb_build_object('operation','update_installment_plan_payment','input',p_input));
    if cached is not null then return (cached->>'changed')::bigint;end if;
  end if;
  select * into plan from public.installment_plans where id=(p_input->>'p_plan_id')::uuid for update;
  if plan.id is null then raise exception 'Compra parcelada não encontrada';end if;
  if p_input?'p_expected_revision' and (p_input->>'p_expected_revision')::bigint is distinct from plan.edit_revision then raise exception 'A compra mudou enquanto você editava. Abra de novo';end if;
  perform private.preflight_subcategory('installment_plans',array[plan.id],p_input,'p_category');
  explicit:=p_input?'p_payment_method';method:=case when explicit then p_input->>'p_payment_method' else plan.payment_method end;
  select jsonb_agg(jsonb_build_object('n',installment_no,'id',id,'expense_pattern',expense_pattern,
    'expense_pattern_source',expense_pattern_source,'expense_necessity',expense_necessity,'expense_necessity_source',expense_necessity_source,'subcategory_id',subcategory_id,'subcategory_snapshot_set',subcategory_snapshot_set))
    into snapshots from public.transactions where installment_plan_id=plan.id;
  select array_agg(id) into ids from public.transactions where installment_plan_id=plan.id;
  -- New children inherit the updated contract; saved numbered snapshots restore omitted dims.
  perform private.apply_expense_classification('installment_plans',array[plan.id],p);
  changed:=public.update_installment_plan(plan.id,(p_input->>'p_total_cents')::bigint,(p_input->>'p_installments')::integer,
    (p_input->>'p_first_occurred_at')::date,p_input->>'p_description',p_input->>'p_category',p_input->>'p_merchant',
    (p_input->>'p_account_id')::uuid,(p_input->>'p_paid_installments')::integer);
  if exists(select 1 from public.installment_plans where id=plan.id) then
    perform private.apply_subcategory('installment_plans',array[plan.id],p);
    perform private.apply_payment_metadata('installment_plans',array[plan.id],method);
    ids:=array(select id from public.transactions where installment_plan_id=plan.id);
    for r in select value from jsonb_array_elements(coalesce(snapshots,'[]'::jsonb)) loop
      restore:='{}';
      if not(p?'subcategory_id') then
        restore:=jsonb_build_object('subcategory_id',case when private.subcategory_compatible(plan.workspace_id,
          (select category from public.installment_plans where id=plan.id),(r.value->>'subcategory_id')::uuid) then r.value->'subcategory_id' else 'null'::jsonb end);
      end if;
      if not(p?'expense_pattern') then restore:=restore||jsonb_build_object('expense_pattern',r.value->'expense_pattern','expense_pattern_source',r.value->'expense_pattern_source');end if;
      if not(p?'expense_necessity') then restore:=restore||jsonb_build_object('expense_necessity',r.value->'expense_necessity','expense_necessity_source',r.value->'expense_necessity_source');end if;
      perform private.apply_financial_metadata('transactions',array(select id from public.transactions
        where installment_plan_id=plan.id and installment_no=(r.value->>'n')::integer),restore);
      if not(p?'subcategory_id') then
        update public.transactions set subcategory_snapshot_set=coalesce((r.value->>'subcategory_snapshot_set')::boolean,false)
          where installment_plan_id=plan.id and installment_no=(r.value->>'n')::integer;
      end if;
    end loop;
  end if;
  if explicit then changed:=greatest(changed,private.apply_payment_metadata('transactions',ids,method));end if;
  changed:=greatest(changed,private.apply_financial_metadata('transactions',ids,p));
  if request is not null then perform private.finish_payment_request(request,jsonb_build_object('changed',changed));end if;
  return changed;
end $$;

create or replace function public.update_debt_contract_scoped(p_debt_id uuid,p_anchor_no integer,p_scope text,p_patch jsonb,
  p_expected_revision bigint,p_expected_payment_versions jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;d public.debts%rowtype;ids uuid[];method text;changed bigint:=0;saved jsonb;classes jsonb;e record;
  p jsonb:=private.financial_metadata_patch(p_patch);
  financial jsonb:=p_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'];
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','debt_contract','id',p_debt_id,
    'anchor',p_anchor_no,'scope',p_scope,'patch',p_patch,'revision',p_expected_revision,'versions',p_expected_payment_versions));
  if result is not null then return result;end if;
  perform private.preflight_subcategory('debts',array[p_debt_id],p_patch);
  select * into d from public.debts where id=p_debt_id for update;
  select jsonb_agg(to_jsonb(x)) into classes from public.debt_installment_edits x where debt_id=p_debt_id;
  select jsonb_agg(jsonb_build_object('n',installment_no,'method',payment_method)) into saved
    from public.debt_installment_edits where debt_id=p_debt_id and payment_method_set;
  if not(p_patch?'payment_method') and p='{}' then
    result:=private.update_debt_contract_scoped_payment_core(p_debt_id,p_anchor_no,p_scope,p_patch,p_expected_revision,p_expected_payment_versions,p_request_id);
  else
    if p_scope is null or p_scope not in('one','future','all') then raise exception 'Escopo da dívida inválido';end if;
    if d.id is null or d.archived then raise exception 'Dívida ativa não encontrada';end if;
    if d.edit_revision is distinct from p_expected_revision then raise exception 'A dívida mudou enquanto você editava';end if;
    if d.installments is null or p_anchor_no is null or p_anchor_no<>d.installments_paid+1
      or (p_scope<>'all' and p_anchor_no>d.installments) then raise exception 'Abra novamente a próxima parcela para editar esta dívida';end if;
    ids:=array(select id from public.transactions where debt_id=d.id);
    if p_scope='all' then perform private.check_payment_versions(ids,p_expected_payment_versions);end if;
    if financial<>'{}' then
      result:=private.update_debt_contract_scoped_payment_core(p_debt_id,p_anchor_no,p_scope,financial,p_expected_revision,p_expected_payment_versions,p_request_id);
    else result:=jsonb_build_object('scope',p_scope,'anchor_no',p_anchor_no,'recorded_changed',0,'contract_changed',p_scope<>'one');end if;
  end if;
  perform private.restore_debt_classification_exceptions(p_debt_id,classes);
  if not(p_patch?'payment_method') then
    for e in select value from jsonb_array_elements(coalesce(saved,'[]'::jsonb)) loop
      insert into public.debt_installment_edits(debt_id,installment_no,payment_method,payment_method_set)
        values(p_debt_id,(e.value->>'n')::int,e.value->>'method',true) on conflict(debt_id,installment_no)
        do update set payment_method=excluded.payment_method,payment_method_set=true;
    end loop;
  else
    method:=p_patch->>'payment_method';select * into d from public.debts where id=p_debt_id;
    perform private.validate_payment_method(method,d.account_id,d.workspace_id);
    if p_scope='one' then
      insert into public.debt_installment_edits(debt_id,installment_no,payment_method,payment_method_set)
        values(d.id,p_anchor_no,method,true) on conflict(debt_id,installment_no) do update set payment_method=excluded.payment_method,payment_method_set=true;
      update public.debts set payment_method=payment_method where id=d.id;
    else
      if p_scope='future' then
        insert into public.debt_installment_edits(debt_id,installment_no,payment_method,payment_method_set)
          select d.id,n,d.payment_method,true from generate_series(1,p_anchor_no-1) n
          on conflict(debt_id,installment_no) do update set payment_method=case when debt_installment_edits.payment_method_set
            then debt_installment_edits.payment_method else excluded.payment_method end,payment_method_set=true;
      end if;
      delete from public.debt_installment_edits where debt_id=d.id and payment_method_set and due_date is null and amount_cents is null
        and not expense_pattern_set and not expense_necessity_set and not subcategory_set and not category_set and (p_scope='all' or installment_no>=p_anchor_no);
      update public.debt_installment_edits set payment_method=null,payment_method_set=false
        where debt_id=d.id and (p_scope='all' or installment_no>=p_anchor_no);
      delete from public.debt_installment_edits where debt_id=d.id and due_date is null and amount_cents is null
        and not payment_method_set and not expense_pattern_set and not expense_necessity_set and not subcategory_set and not category_set;
      perform private.apply_payment_metadata('debts',array[d.id],method);
      if p_scope='all' then changed:=private.apply_payment_metadata('transactions',ids,method);end if;
    end if;
  end if;
  if p<>'{}' then changed:=greatest(changed,private.apply_debt_financial_metadata(p_debt_id,
    case when p_scope='all' then ids else '{}'::uuid[] end,p_anchor_no,p_scope,p));end if;
  result:=jsonb_set(result,'{recorded_changed}',to_jsonb(greatest(changed,(result->>'recorded_changed')::bigint)));
  perform private.finish_payment_request(p_request_id,result);return result;
end $$;

create or replace function public.update_debt_payment_scoped(p_anchor_id uuid,p_scope text,p_patch jsonb,p_expected_debt_revision bigint,
  p_expected_anchor_revision bigint,p_expected_payment_versions jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb;a public.transactions%rowtype;d public.debts%rowtype;ids uuid[];changed bigint:=0;method text;classes jsonb;
  p jsonb:=private.financial_metadata_patch(p_patch);
  financial jsonb:=p_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'];
begin
  result:=private.reserve_payment_request(p_request_id,jsonb_build_object('operation','debt_payment','id',p_anchor_id,
    'scope',p_scope,'patch',p_patch,'debt_revision',p_expected_debt_revision,'revision',p_expected_anchor_revision,'versions',p_expected_payment_versions));
  if result is not null then return result;end if;
  perform private.preflight_subcategory('transactions',array[p_anchor_id],p_patch);
  select * into a from public.transactions where id=p_anchor_id;
  select * into d from public.debts where id=a.debt_id for update;
  perform private.prepare_debt_subcategory_parent(d.id,a.debt_payment_no,p_scope,p_patch);
  select jsonb_agg(to_jsonb(x)) into classes from public.debt_installment_edits x where debt_id=d.id;
  if not(p_patch?'payment_method') and p='{}' then
    result:=private.update_debt_payment_scoped_payment_core(p_anchor_id,p_scope,p_patch,p_expected_debt_revision,p_expected_anchor_revision,p_expected_payment_versions,p_request_id);
  else
    if p_scope is null or p_scope not in('one','from_here','all') then raise exception 'Escopo de pagamento inválido';end if;
    select * into a from public.transactions where id=p_anchor_id for update;
    if d.id is null or d.archived or a.debt_payment_no is null or a.kind<>'expense' or a.status<>'cleared'
      or a.debt_principal_cents is null or a.invoice_id is not null or a.pays_invoice_id is not null then raise exception 'Pagamento de dívida inválido';end if;
    if d.edit_revision is distinct from p_expected_debt_revision or a.edit_revision is distinct from p_expected_anchor_revision then
      raise exception 'A dívida ou o pagamento mudou enquanto você editava';end if;
    if p_scope<>'one' and exists(select 1 from public.transactions where debt_id=d.id and debt_payment_no is null) then raise exception 'Há pagamento sem número da parcela';end if;
    ids:=array(select id from public.transactions where debt_id=d.id and
      (p_scope='all' or p_scope='from_here' and debt_payment_no>=a.debt_payment_no or p_scope='one' and id=a.id));
    perform private.check_payment_versions(ids,p_expected_payment_versions);
    if financial<>'{}' then
      result:=private.update_debt_payment_scoped_payment_core(p_anchor_id,p_scope,financial,p_expected_debt_revision,p_expected_anchor_revision,p_expected_payment_versions,p_request_id);
    else result:=jsonb_build_object('recorded_changed',0,'contract_changed',false,'future_installments',greatest(d.installments-d.installments_paid,0));end if;
  end if;
  perform private.restore_debt_classification_exceptions(d.id,classes);
  if p_patch?'payment_method' then
    method:=p_patch->>'payment_method';changed:=private.apply_payment_metadata('transactions',ids,method);
    if p_scope<>'one' then
      -- Method changes must freeze past numbered defaults without erasing class exceptions.
      if p_scope='from_here' then
        insert into public.debt_installment_edits(debt_id,installment_no,payment_method,payment_method_set)
          select d.id,n,d.payment_method,true from generate_series(1,a.debt_payment_no-1) n
          on conflict(debt_id,installment_no) do update set payment_method=case when debt_installment_edits.payment_method_set
            then debt_installment_edits.payment_method else excluded.payment_method end,payment_method_set=true;
      end if;
      perform private.apply_payment_metadata('debts',array[d.id],method);
      delete from public.debt_installment_edits where debt_id=d.id and payment_method_set and due_date is null and amount_cents is null
        and not expense_pattern_set and not expense_necessity_set and not subcategory_set and not category_set and (p_scope='all' or installment_no>=a.debt_payment_no);
      update public.debt_installment_edits set payment_method=null,payment_method_set=false
        where debt_id=d.id and (p_scope='all' or installment_no>=a.debt_payment_no);
      delete from public.debt_installment_edits where debt_id=d.id and due_date is null and amount_cents is null
        and not payment_method_set and not expense_pattern_set and not expense_necessity_set and not subcategory_set and not category_set;
      result:=jsonb_set(result,'{contract_changed}','true');
    end if;
  end if;
  if p<>'{}' then
    if p_scope='one' then changed:=greatest(changed,private.apply_financial_metadata('transactions',ids,p));
    else
      changed:=greatest(changed,private.apply_debt_financial_metadata(d.id,ids,a.debt_payment_no,
        case when p_scope='all' then 'all' else 'future' end,p));
      result:=jsonb_set(result,'{contract_changed}','true');
    end if;
  end if;
  result:=jsonb_set(result,'{recorded_changed}',to_jsonb(greatest(changed,(result->>'recorded_changed')::bigint)));
  perform private.finish_payment_request(p_request_id,result);return result;
end $$;

create or replace function public.update_recurring_series(p_recurring_id uuid,p_patch jsonb,p_propagate boolean default true)
returns bigint language plpgsql security invoker set search_path=public set timezone='America/Sao_Paulo' as $$
declare ids uuid[];before_ids uuid[];changed bigint:=0;p jsonb:=private.financial_metadata_patch(p_patch);
  financial jsonb:=p_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'];
begin
  perform private.preflight_subcategory('recurring_transactions',array[p_recurring_id],p_patch);
  if not(p_patch?'payment_method') and p='{}' then return private.update_recurring_series_payment_core(p_recurring_id,p_patch,p_propagate);end if;
  ids:=private.recurring_payment_targets(p_recurring_id,null);
  before_ids:=array(select id from public.transactions where recurring_id=p_recurring_id);
  if financial<>'{}' then changed:=private.update_recurring_series_payment_core(p_recurring_id,financial,p_propagate);end if;
  ids:=case when p_propagate then ids||array(select id from public.transactions where recurring_id=p_recurring_id and not(id=any(before_ids))) else '{}'::uuid[] end;
  if p_patch?'payment_method' then changed:=greatest(changed,private.apply_recurring_payment(p_recurring_id,ids,p_patch->>'payment_method',current_date,false));end if;
  return greatest(changed,private.apply_recurring_financial_metadata(p_recurring_id,ids,p,current_date,false));
end $$;

create or replace function public.update_transaction_scoped(p_transaction_id uuid,p_scope text,p_patch jsonb)
returns bigint language plpgsql security invoker set search_path=public as $$
declare r public.transactions%rowtype;ids uuid[];changed bigint:=0;p jsonb:=private.financial_metadata_patch(p_patch);
  financial jsonb:=p_patch-array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'];
begin
  perform private.preflight_subcategory('transactions',array[p_transaction_id],p_patch);
  if not(p_patch?'payment_method') and p='{}' then return private.update_transaction_scoped_payment_core(p_transaction_id,p_scope,p_patch);end if;
  if p_scope is null or p_scope not in('one','future') then raise exception 'Escopo inválido';end if;
  perform 1 from public.recurring_transactions where id=(select recurring_id from public.transactions where id=p_transaction_id) for update;
  perform 1 from public.installment_plans where id=(select installment_plan_id from public.transactions where id=p_transaction_id) for update;
  select * into r from public.transactions where id=p_transaction_id for update;
  if r.id is null then raise exception 'Lançamento não encontrado';end if;
  if p_scope='future' and r.recurring_id is null and r.installment_plan_id is null then raise exception 'Esse lançamento não faz parte de uma série';end if;
  ids:=array(select t.id from public.transactions t where t.workspace_id=r.workspace_id and
    (t.id=r.id or p_scope='future' and t.status='pending' and t.occurred_at>=r.occurred_at
      and (r.recurring_id is not null and t.recurring_id=r.recurring_id or r.installment_plan_id is not null and t.installment_plan_id=r.installment_plan_id)));
  perform 1 from public.transactions where id=any(ids) order by id for update;
  if financial<>'{}' then changed:=private.update_transaction_scoped_payment_core(p_transaction_id,p_scope,financial);end if;
  if p_patch?'payment_method' then
    changed:=greatest(changed,private.apply_payment_metadata('transactions',ids,p_patch->>'payment_method'));
    if p_scope='future' and r.recurring_id is not null then perform private.apply_recurring_payment(r.recurring_id,'{}'::uuid[],p_patch->>'payment_method',greatest(current_date,r.occurred_at),false);
    elsif p_scope='future' and r.installment_plan_id is not null then perform private.apply_payment_metadata('installment_plans',array[r.installment_plan_id],p_patch->>'payment_method');end if;
  end if;
  changed:=greatest(changed,private.apply_financial_metadata('transactions',ids,p));
  if p_scope='future' and r.recurring_id is not null then perform private.apply_recurring_financial_metadata(r.recurring_id,'{}'::uuid[],p,greatest(current_date,r.occurred_at),false);
  elsif p_scope='future' and r.installment_plan_id is not null then perform private.apply_financial_metadata('installment_plans',array[r.installment_plan_id],p);end if;
  return changed;
end $$;

create or replace function public.convert_transaction_to_installments(p_transaction_id uuid,p_total_cents bigint,p_installments integer,
  p_first_occurred_at date,p_description text default null,p_category text default null,p_merchant text default null,
  p_account_id uuid default null,p_paid_installments integer default null)
returns uuid language plpgsql security invoker set search_path=public as $$
declare r public.transactions%rowtype;plan uuid;p jsonb;
begin
  select * into r from public.transactions where id=p_transaction_id for update;
  p:=private.financial_metadata_patch(to_jsonb(r));
  if not private.subcategory_compatible(r.workspace_id,p_category,(p->>'subcategory_id')::uuid) then p:=p||'{"subcategory_id":null}'::jsonb;end if;
  if exists(select 1 from public.transactions where pix_fee_for_transaction_id=p_transaction_id) then raise exception 'Zere o juro vinculado antes de converter esta compra';end if;
  plan:=private.convert_transaction_to_installments_payment_core(p_transaction_id,p_total_cents,p_installments,
    p_first_occurred_at,p_description,p_category,p_merchant,p_account_id,p_paid_installments);
  perform private.apply_payment_metadata('installment_plans',array[plan],r.payment_method);
  perform private.apply_payment_metadata('transactions',array(select id from public.transactions where installment_plan_id=plan),r.payment_method);
  perform private.apply_financial_metadata('installment_plans',array[plan],p);
  perform private.apply_financial_metadata('transactions',array(select id from public.transactions where installment_plan_id=plan),p);
  return plan;
end $$;

-- Conversion inherits each source snapshot only where its actual final parent agrees.
-- A debt template and its adopted paid transaction can legitimately have different parents.
create or replace function private.apply_compatible_subcategory(p_table text,p_ids uuid[],p_input jsonb)
returns bigint language plpgsql security invoker set search_path='' as $$
declare p jsonb:=private.subcategory_patch(p_input);chosen jsonb;r record;parent_col text;changed bigint:=0;n bigint;
begin
  if p_table is null or p_table not in('transactions','recurring_transactions','installment_plans','debts') then raise exception 'Origem do detalhe inválida';end if;
  if p='{}' then return 0;end if;
  parent_col:=case when p_table='debts' then 'payment_category' else 'category' end;
  for r in execute format('select id,workspace_id,%I as category from public.%I where id=any($1) order by id',parent_col,p_table) using p_ids loop
    chosen:=case when private.subcategory_compatible(r.workspace_id,r.category,(p->>'subcategory_id')::uuid) then p else '{"subcategory_id":null}'::jsonb end;
    if p_table='recurring_transactions' then
      n:=private.apply_recurring_financial_metadata(r.id,'{}'::uuid[],chosen,current_date,true);
    else n:=private.apply_subcategory(p_table,array[r.id],chosen);end if;
    changed:=changed+n;
  end loop;
  return changed;
end $$;
revoke execute on function private.apply_compatible_subcategory(text,uuid[],jsonb) from public,anon;
grant execute on function private.apply_compatible_subcategory(text,uuid[],jsonb) to authenticated,service_role;

create or replace function public.converter_registro(p_origem jsonb,p_alcance text,p_destino jsonb)
returns jsonb language plpgsql security invoker set search_path=public set timezone='America/Sao_Paulo' as $$
declare result jsonb; method text; explicit boolean; tipo text:=p_destino->>'tipo'; data jsonb:=p_destino->'dados';
  created_id uuid; ids uuid[]; tab text; source_tab text; fee uuid; classification jsonb; explicit_class jsonb; source_record jsonb;child jsonb;explicit_child jsonb;final_parent text;
begin
  source_tab:=case p_origem->>'tipo' when 'transacao' then 'transactions' when 'serie' then 'recurring_transactions' when 'plano' then 'installment_plans' when 'divida' then 'debts' end;
  if source_tab is not null then execute format('select payment_method from public.%I where id=$1 for update',source_tab) into method using (p_origem->>'id')::uuid; end if;
  if source_tab is not null then execute format('select to_jsonb(t) from public.%I t where id=$1',source_tab) into source_record using (p_origem->>'id')::uuid; end if;
  classification:=private.financial_metadata_patch(coalesce(source_record,'{}'::jsonb));
  explicit_class:=private.financial_metadata_patch(case when tipo='lancamento' then data->'linhas'->0 else data end);
  classification:=classification||explicit_class;
  explicit_child:=private.subcategory_patch(case when tipo='lancamento' then data->'linhas'->0 else data end);
  final_parent:=case when tipo='parcelada' then data->>'p_category' when tipo='lancamento' then data->'linhas'->0->>'category'
    when tipo='financiamento' then data->>'payment_category' else data->>'category' end;
  if explicit_child<>'{}' then
    perform private.validate_subcategory_reference(public.my_default_workspace(),final_parent,(explicit_child->>'subcategory_id')::uuid);
    if tipo='financiamento' and p_origem->>'tipo'='transacao' and p_alcance in('converter','so_esta') then
      perform private.validate_subcategory_reference((source_record->>'workspace_id')::uuid,source_record->>'category',(explicit_child->>'subcategory_id')::uuid);
    end if;
  else
    child:=private.subcategory_patch(classification);classification:=classification-'subcategory_id';
  end if;
  explicit:=case when tipo='parcelada' then data?'p_payment_method' when tipo='lancamento' then data->'linhas'->0?'payment_method' else data?'payment_method' end;
  if explicit then method:=case when tipo='parcelada' then data->>'p_payment_method' when tipo='lancamento' then data->'linhas'->0->>'payment_method' else data->>'payment_method' end; end if;
  -- The adopted first line changes in place; the existing converter doesn't insert it via
  -- the generic builder. Apply method to every returned financial id after the core finishes.
  if p_origem->>'tipo'='transacao' and exists(select 1 from public.transactions where pix_fee_for_transaction_id=(p_origem->>'id')::uuid)
    and (tipo<>'lancamento' or not(data?'fee_cents')) then
    raise exception 'Zere o juro vinculado antes de converter esta compra';
  end if;
  result:=private.converter_registro_payment_core(p_origem,p_alcance,p_destino);
  created_id:=(result->'ids'->>0)::uuid;
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(result->'ids');
  tab:=case tipo when 'parcelada' then 'installment_plans' when 'recorrente' then 'recurring_transactions' when 'financiamento' then 'debts' end;
  if tab is not null then perform private.apply_payment_metadata(tab,array[created_id],method); end if;
  if tipo='parcelada' then perform private.apply_payment_metadata('transactions',array(select t.id from public.transactions t where t.installment_plan_id=created_id),method);
  elsif tipo='recorrente' then
    perform private.apply_payment_metadata('transactions',array(select t.id from public.transactions t where t.recurring_id=created_id),method);
    perform private.payment_history_scope(created_id,method,current_date,true);
  elsif tipo='lancamento' then
    perform private.apply_payment_metadata('transactions',array[(result->'ids'->>0)::uuid],method);
  end if;
  if tipo='recorrente' and (select kind from public.recurring_transactions where id=created_id)<>'expense' then
    classification:=private.subcategory_patch(classification)||jsonb_build_object('expense_pattern',null,'expense_pattern_source',null,'expense_necessity',null,'expense_necessity_source',null);
  end if;
  if tab is not null then perform private.apply_financial_metadata(tab,array[created_id],classification); end if;
  if tipo='parcelada' then
    perform private.apply_financial_metadata('transactions',array(select id from public.transactions
      where installment_plan_id=created_id or down_payment_plan_id=created_id),classification);
  elsif tipo='recorrente' then
    perform private.apply_recurring_financial_metadata(created_id,array(select id from public.transactions where recurring_id=created_id),classification,current_date,true);
  elsif tipo='financiamento' then
    perform private.apply_financial_metadata('transactions',array(select id from public.transactions
      where debt_id=created_id or down_payment_debt_id=created_id),classification);
  elsif tipo='lancamento' then
    if (select kind from public.transactions where id=created_id)<>'expense' then
      classification:=private.subcategory_patch(classification)||jsonb_build_object('expense_pattern',null,'expense_pattern_source',null,'expense_necessity',null,'expense_necessity_source',null);
    end if;
    perform private.apply_financial_metadata('transactions',array[created_id],classification);
  end if;
  if explicit_child='{}' and child<>'{}' then
    if tab is not null then perform private.apply_compatible_subcategory(tab,array[created_id],child);end if;
    if tipo='parcelada' then ids:=array(select id from public.transactions where installment_plan_id=created_id or down_payment_plan_id=created_id);
    elsif tipo='recorrente' then ids:=array(select id from public.transactions where recurring_id=created_id);
    elsif tipo='financiamento' then ids:=array(select id from public.transactions where debt_id=created_id or down_payment_debt_id=created_id);
    else ids:=array[created_id];end if;
    perform private.apply_compatible_subcategory('transactions',ids,child);
  end if;
  if data?'fee_cents' then
    if tipo<>'lancamento' or jsonb_array_length(data->'linhas')<>1 then raise exception 'Juro explícito exige um lançamento principal'; end if;
    fee:=private.set_owned_pix_fee(created_id,(data->>'fee_cents')::bigint);
    if fee is not null and not(result->'ids' @> jsonb_build_array(fee)) then result:=jsonb_set(result,'{ids}',(result->'ids')||to_jsonb(fee)); end if;
  end if;
  return result;
end $$;


create or replace function public.materialize_recurring_occurrence(
  p_recurring_id uuid, p_date date
) returns uuid
language plpgsql volatile security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  achado uuid;
  prevista record;
  serie public.recurring_transactions%rowtype;
begin
  if p_recurring_id is null or p_date is null then
    raise exception 'Informe a recorrente e o dia';
  end if;
  select * into serie from public.recurring_transactions r where r.id = p_recurring_id for share;
  if serie.id is null then
    raise exception 'Essa ocorrência não existe mais na recorrente.' using errcode = 'P0001';
  end if;

  select t.id into achado from public.transactions t
   where t.recurring_id = p_recurring_id and t.occurred_at = p_date;
  if achado is not null then
    return achado;
  end if;

  select * into prevista
    from public.expected_recurring_occurrences(p_date, p_date, p_recurring_id) e
   where e.due_date = p_date
   limit 1;
  if not found then
    raise exception 'Essa ocorrência não existe mais na recorrente.' using errcode = 'P0001';
  end if;
  if prevista.inferred_start then
    raise exception 'Essa data é uma estimativa da recorrente: não vira lançamento.' using errcode = 'P0001';
  end if;

  if p_date <= current_date then
    update public.transactions t set recurring_id = serie.id, subcategory_snapshot_set=true
     where t.id = (
       select g.id from public.transactions g
        where g.workspace_id = serie.workspace_id and g.recurring_id is null
          and g.kind = prevista.kind and g.amount_cents = prevista.amount_cents
          and g.account_id is not distinct from prevista.account_id and g.occurred_at = p_date
          and extensions.unaccent(lower(coalesce(g.description, '')))
            = extensions.unaccent(lower(coalesce(serie.description, '')))
        order by g.created_at
        limit 1)
    returning t.id into achado;
    if achado is not null then
      return achado;
    end if;
  end if;

  insert into public.transactions
    (user_id, workspace_id, kind, amount_cents, currency, category, description, merchant,
     account_id, occurred_at, due_at, source, status, recurring_id, auto_confirm)
  values
    (serie.user_id, serie.workspace_id, prevista.kind, prevista.amount_cents, serie.currency,
     -- a leitura preenche o vazio ('outros', 'Recorrente'); a linha guarda o que a série guarda
     case when prevista.category = coalesce(serie.category, 'outros') then serie.category
          else prevista.category end,
     case when prevista.description = coalesce(nullif(serie.description, ''), serie.category, 'Recorrente')
          then serie.description else prevista.description end,
     serie.merchant, prevista.account_id, p_date, p_date, 'recurring',
     case when p_date <= current_date and serie.auto_confirm then 'cleared' else 'pending' end,
     serie.id, serie.auto_confirm)
  on conflict (recurring_id, occurred_at) where recurring_id is not null do nothing
  returning id into achado;

  if achado is null then
    select t.id into achado from public.transactions t
     where t.recurring_id = p_recurring_id and t.occurred_at = p_date;
  end if;
  if achado is null then
    raise exception 'Não consegui abrir essa ocorrência.';
  end if;
  return achado;
end;
$$;

revoke execute on function private.subcategory_patch(jsonb) from public,anon;
grant execute on function private.subcategory_patch(jsonb) to authenticated,service_role;

revoke execute on function private.financial_metadata_patch(jsonb) from public,anon;
grant execute on function private.financial_metadata_patch(jsonb) to authenticated,service_role;

revoke execute on function private.subcategory_compatible(uuid,text,uuid) from public,anon;
grant execute on function private.subcategory_compatible(uuid,text,uuid) to authenticated,service_role;

revoke execute on function private.preflight_subcategory(text,uuid[],jsonb,text) from public,anon;
grant execute on function private.preflight_subcategory(text,uuid[],jsonb,text) to authenticated,service_role;

revoke execute on function private.apply_subcategory(text,uuid[],jsonb) from public,anon;
grant execute on function private.apply_subcategory(text,uuid[],jsonb) to authenticated,service_role;

revoke execute on function private.apply_financial_metadata(text,uuid[],jsonb) from public,anon;
grant execute on function private.apply_financial_metadata(text,uuid[],jsonb) to authenticated,service_role;

revoke execute on function private.recurring_subcategory_at(uuid,date) from public,anon;
grant execute on function private.recurring_subcategory_at(uuid,date) to authenticated,service_role;

revoke execute on function private.debt_subcategory_at(uuid,integer) from public,anon;
grant execute on function private.debt_subcategory_at(uuid,integer) to authenticated,service_role;

revoke execute on function private.subcategory_history_scope(uuid,jsonb,date,boolean) from public,anon;
grant execute on function private.subcategory_history_scope(uuid,jsonb,date,boolean) to authenticated,service_role;

revoke execute on function private.apply_recurring_financial_metadata(uuid,uuid[],jsonb,date,boolean) from public,anon;
grant execute on function private.apply_recurring_financial_metadata(uuid,uuid[],jsonb,date,boolean) to authenticated,service_role;

revoke execute on function private.join_financial_metadata_patches(jsonb,jsonb) from public,anon;
grant execute on function private.join_financial_metadata_patches(jsonb,jsonb) to authenticated,service_role;

revoke execute on function private.apply_debt_financial_metadata(uuid,uuid[],integer,text,jsonb) from public,anon;
grant execute on function private.apply_debt_financial_metadata(uuid,uuid[],integer,text,jsonb) to authenticated,service_role;

revoke execute on function private.prepare_debt_subcategory_parent(uuid,integer,text,jsonb) from public,anon;
grant execute on function private.prepare_debt_subcategory_parent(uuid,integer,text,jsonb) to authenticated,service_role;

revoke execute on function private.track_subcategory_history() from public,anon,authenticated,service_role;

revoke execute on function private.inherit_subcategory() from public,anon,authenticated,service_role;

-- Trusted service-role callers already have source-write authority; no authenticated/no-UID bypass.

-- E may have a dated parent independent of today's debt template. A raw legacy parent
-- update freezes incumbent exceptions; scoped commands pre-set their selected final parent.
-- During a catalog move the child is already reparented, so use its proven catalog parent.
create or replace function private.preserve_debt_exception_parent()
returns trigger language plpgsql security invoker set search_path='' as $$
declare e public.debt_installment_edits%rowtype;parent text;structural boolean:=coalesce(current_setting('proops.renomeando_categoria',true),'')='on';
begin
  if old.payment_category is not distinct from new.payment_category and old.workspace_id is not distinct from new.workspace_id then return null;end if;
  for e in select * from public.debt_installment_edits where debt_id=new.id order by installment_no for update loop
    parent:=case when e.category_set then e.category else old.payment_category end;
    if structural and not e.category_set and e.subcategory_id is not null then
      select s.parent_category into parent from public.subcategories s where s.id=e.subcategory_id and s.workspace_id=new.workspace_id;
      if not found then parent:=old.payment_category;end if;
    end if;
    update public.debt_installment_edits set category=parent,category_set=true,
      subcategory_id=case when private.subcategory_compatible(new.workspace_id,parent,e.subcategory_id) then e.subcategory_id end
      where debt_id=e.debt_id and installment_no=e.installment_no;
  end loop;
  return null;
end $$;
revoke execute on function private.preserve_debt_exception_parent() from public,anon,authenticated,service_role;
create trigger zzz_preserve_debt_exception_parent after update of payment_category,workspace_id on public.debts
  for each row execute function private.preserve_debt_exception_parent();

-- FUTURE validates/locks its selected occurrence before publishing this transaction-local
-- boundary. Calendar changes still use the original new_anchor; ALL/unscoped behavior remains.
CREATE OR REPLACE FUNCTION private.track_recurring_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  tz text;
  new_anchor date;
  boundary date;
  is_all boolean;
  original_start date;
  original_inferred date;
begin
  select coalesce(p.timezone,'America/Sao_Paulo') into tz
    from public.profiles p where p.id=new.user_id;
  tz:=coalesce(tz,'America/Sao_Paulo');
  if tg_op='INSERT' then
    new_anchor:=(coalesce(new.dtstart,new.next_run_at) at time zone tz)::date;
    insert into private.recurring_history_versions
      (recurring_id,workspace_id,valid_from,anchor_date,rrule,kind,
       amount_cents,category,description,account_id,end_date)
    values(new.id,new.workspace_id,new_anchor,new_anchor,new.rrule,new.kind,
      new.amount_cents,new.category,new.description,new.account_id,new.end_date);
    return new;
  end if;
  -- Renomear ou apagar uma categoria (20260929170000) reescreve o histórico por conta própria
  -- (`private.renomear_no_historico`). Versionar aqui partiria a série em hoje e, havendo uma
  -- versão futura de calendário, a trocaria por outra com a âncora antiga.
  if current_setting('proops.renomeando_categoria', true) = 'on'
     and row(old.rrule,old.dtstart,old.kind,old.amount_cents,
      old.description,old.account_id,old.end_date)
      is not distinct from
     row(new.rrule,new.dtstart,new.kind,new.amount_cents,
      new.description,new.account_id,new.end_date) then return new; end if;
  if row(old.rrule,old.dtstart,old.kind,old.amount_cents,old.category,
      old.description,old.account_id,old.end_date)
      is not distinct from
     row(new.rrule,new.dtstart,new.kind,new.amount_cents,new.category,
      new.description,new.account_id,new.end_date) then return new; end if;
  new_anchor:=(coalesce(new.dtstart,new.next_run_at) at time zone tz)::date;
  select exists(select 1 from private.recurring_all_edit_requests e
    where e.recurring_id=new.id and e.user_id=auth.uid() and e.result is null)
    into is_all;
  if is_all then
    select min(valid_from),min(inferred_before) into original_start,original_inferred
      from private.recurring_history_versions where recurring_id=new.id;
    if new.rrule ~ '^FREQ=MONTHLY' then
      -- "All" corrects the whole first eligible monthly period, even when the
      -- new day falls before the old first due date. Mark that edge as inferred.
      if date_trunc('month',original_start::timestamp)::date<original_start then
        original_inferred:=coalesce(original_inferred,original_start);
        original_start:=date_trunc('month',original_start::timestamp)::date;
      end if;
      if date_trunc('month',new.created_at at time zone tz)::date<original_start then
        original_inferred:=coalesce(original_inferred,original_start);
        original_start:=date_trunc('month',new.created_at at time zone tz)::date;
      end if;
    end if;
    delete from private.recurring_history_versions where recurring_id=new.id;
    insert into private.recurring_history_versions
      (recurring_id,workspace_id,valid_from,anchor_date,inferred_before,rrule,
       kind,amount_cents,category,description,account_id,end_date)
    values(new.id,new.workspace_id,original_start,original_start,
      original_inferred,new.rrule,new.kind,new.amount_cents,new.category,
      new.description,new.account_id,new.end_date);
  else
    boundary:=case when old.rrule is distinct from new.rrule
      or old.dtstart is distinct from new.dtstart then new_anchor
      else coalesce(nullif(current_setting('proops.subcategory_financial_boundary_'||replace(new.id::text,'-',''),true),'')::date,
        (now() at time zone tz)::date) end;
    delete from private.recurring_history_versions
      where recurring_id=new.id and valid_from>=boundary;
    update private.recurring_history_versions
      set valid_through=boundary-1
      where recurring_id=new.id and valid_from<boundary
        and (valid_through is null or valid_through>=boundary);
    insert into private.recurring_history_versions
      (recurring_id,workspace_id,valid_from,anchor_date,rrule,kind,
       amount_cents,category,description,account_id,end_date)
    values(new.id,new.workspace_id,boundary,
      case when old.rrule is distinct from new.rrule
        or old.dtstart is distinct from new.dtstart then new_anchor
        else coalesce((select anchor_date from private.recurring_history_versions
          where recurring_id=new.id order by valid_from desc limit 1),new_anchor) end,
      new.rrule,new.kind,new.amount_cents,new.category,new.description,
      new.account_id,new.end_date);
  end if;
  return new;
end;
$$;
