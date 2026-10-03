-- F06: optional, independent spending snapshots. No automatic legacy backfill.
create or replace function private.expense_classification_is_valid(
  p_pattern text,p_pattern_source text,p_necessity text,p_necessity_source text
) returns boolean language sql immutable set search_path='' as $$
  select coalesce(
    (p_pattern is null or p_pattern in('fixed','variable'))
    and (p_necessity is null or p_necessity in('essential','discretionary'))
    and (p_pattern_source is null or p_pattern_source in('explicit','category_default'))
    and (p_necessity_source is null or p_necessity_source in('explicit','category_default'))
    and (p_pattern is null or p_pattern_source is not null)
    and (p_necessity is null or p_necessity_source is not null)
    and (p_pattern_source is distinct from 'category_default' or p_pattern is not null)
    and (p_necessity_source is distinct from 'category_default' or p_necessity is not null),false)
$$;
revoke execute on function private.expense_classification_is_valid(text,text,text,text) from public,anon;
grant execute on function private.expense_classification_is_valid(text,text,text,text) to authenticated,service_role;

do $$ declare t text; begin
  foreach t in array array['transactions','recurring_transactions','installment_plans','debts','debt_installment_edits'] loop
    execute format('alter table public.%I add column if not exists expense_pattern text,
      add column if not exists expense_pattern_source text,add column if not exists expense_necessity text,
      add column if not exists expense_necessity_source text',t);
    execute format('alter table public.%I add constraint %I check(private.expense_classification_is_valid(
      expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source))',t,t||'_expense_classification_check');
  end loop;
end $$;
alter table private.recurring_history_versions add column if not exists expense_pattern text,
  add column if not exists expense_pattern_source text,add column if not exists expense_necessity text,
  add column if not exists expense_necessity_source text,
  add column if not exists metadata_snapshot_set boolean not null default false,
  add constraint recurring_history_expense_classification_check check(private.expense_classification_is_valid(
    expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source));
alter table public.categories add column if not exists default_expense_pattern text
    check(default_expense_pattern in('fixed','variable')),
  add column if not exists default_expense_necessity text check(default_expense_necessity in('essential','discretionary')),
  add column if not exists edit_revision bigint not null default 0;
create trigger zz_edit_revision before update on public.categories
  for each row execute function public.tg_finance_edit_revision();
alter table public.debt_installment_edits add column if not exists expense_pattern_set boolean not null default false,
  add column if not exists expense_necessity_set boolean not null default false;
alter table public.debt_installment_edits drop constraint debt_installment_edits_check;
alter table public.debt_installment_edits add constraint debt_installment_edits_check
  check(due_date is not null or amount_cents is not null or payment_method_set or expense_pattern_set or expense_necessity_set);
alter table public.debt_installment_edits add constraint debt_installment_classification_flags_check
  check((expense_pattern_set or expense_pattern is null and expense_pattern_source is null)
    and (expense_necessity_set or expense_necessity is null and expense_necessity_source is null));

-- Old clients may change the kind without knowing these new fields. Clear a preserved
-- expense snapshot on that transition; newly supplied non-spending metadata is rejected.
create or replace function private.clear_nonexpense_classification()
returns trigger language plpgsql security invoker set search_path='' as $$ begin
  if new.kind<>'expense' and row(new.expense_pattern,new.expense_pattern_source,new.expense_necessity,new.expense_necessity_source)
    is not distinct from row(old.expense_pattern,old.expense_pattern_source,old.expense_necessity,old.expense_necessity_source) then
    new.expense_pattern:=null;new.expense_pattern_source:=null;
    new.expense_necessity:=null;new.expense_necessity_source:=null;
  end if;
  return new;
end $$;
revoke execute on function private.clear_nonexpense_classification() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['transactions','recurring_transactions'] loop
    execute format('create trigger clear_nonexpense_classification before update of kind on public.%I
      for each row execute function private.clear_nonexpense_classification()',t);
    execute format('alter table public.%I add constraint %I check(kind=''expense'' or
      expense_pattern is null and expense_pattern_source is null and expense_necessity is null and expense_necessity_source is null)',t,t||'_classification_expense_only');
  end loop;
end $$;
alter table public.transactions add constraint transactions_classification_consumption_only check(pays_invoice_id is null or
  expense_pattern is null and expense_pattern_source is null and expense_necessity is null and expense_necessity_source is null);

-- A dimension patch always contains its value AND provenance, including explicit null.
create or replace function private.expense_classification_patch(p_input jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb:='{}';k text;
begin
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Classificação de gasto inválida'; end if;
  if (p_input?'expense_pattern')<>(p_input?'expense_pattern_source')
    or (p_input?'expense_necessity')<>(p_input?'expense_necessity_source') then
    raise exception 'Classificação exige valor e origem juntos';
  end if;
  foreach k in array array['expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source'] loop
    if p_input?k then
      if jsonb_typeof(p_input->k) not in('string','null') then raise exception 'Classificação de gasto inválida'; end if;
      result:=result||jsonb_build_object(k,p_input->k);
    end if;
  end loop;
  if not private.expense_classification_is_valid(result->>'expense_pattern',result->>'expense_pattern_source',
    result->>'expense_necessity',result->>'expense_necessity_source') then raise exception 'Classificação de gasto inválida'; end if;
  return result;
end $$;
revoke execute on function private.expense_classification_patch(jsonb) from public,anon;
grant execute on function private.expense_classification_patch(jsonb) to authenticated,service_role;
create or replace function private.apply_expense_classification(p_table text,p_ids uuid[],p_input jsonb)
returns bigint language plpgsql security invoker set search_path='' as $$
declare p jsonb:=private.expense_classification_patch(p_input);changed bigint;
begin
  if p_table not in('transactions','recurring_transactions','installment_plans','debts') or p_table is null then
    raise exception 'Origem da classificação inválida'; end if;
  if p='{}' then return 0; end if;
  if p_table='transactions' then
    perform 1 from public.recurring_transactions where id in(select recurring_id from public.transactions where id=any(p_ids)) order by id for update;
    perform 1 from public.installment_plans where id in(select installment_plan_id from public.transactions where id=any(p_ids)) order by id for update;
    perform 1 from public.debts where id in(select debt_id from public.transactions where id=any(p_ids)) order by id for update;
  end if;
  execute format('update public.%I set
    expense_pattern=case when $2?''expense_pattern'' then $2->>''expense_pattern'' else expense_pattern end,
    expense_pattern_source=case when $2?''expense_pattern'' then $2->>''expense_pattern_source'' else expense_pattern_source end,
    expense_necessity=case when $2?''expense_necessity'' then $2->>''expense_necessity'' else expense_necessity end,
    expense_necessity_source=case when $2?''expense_necessity'' then $2->>''expense_necessity_source'' else expense_necessity_source end
    where id=any($1) and (($2?''expense_pattern'' and row(expense_pattern,expense_pattern_source)
      is distinct from row($2->>''expense_pattern'',$2->>''expense_pattern_source''))
      or ($2?''expense_necessity'' and row(expense_necessity,expense_necessity_source)
      is distinct from row($2->>''expense_necessity'',$2->>''expense_necessity_source'')))',p_table) using p_ids,p;
  get diagnostics changed=row_count;return changed;
end $$;
revoke execute on function private.apply_expense_classification(text,uuid[],jsonb) from public,anon;
grant execute on function private.apply_expense_classification(text,uuid[],jsonb) to authenticated,service_role;

create or replace function private.recurring_expense_classification_at(p_recurring uuid,p_date date)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('expense_pattern',v.expense_pattern,'expense_pattern_source',v.expense_pattern_source,
    'expense_necessity',v.expense_necessity,'expense_necessity_source',v.expense_necessity_source)
  from private.recurring_history_versions v where v.recurring_id=p_recurring and v.valid_from<=p_date
    and (v.valid_through is null or v.valid_through>=p_date) order by v.valid_from desc limit 1
$$;
revoke execute on function private.recurring_expense_classification_at(uuid,date) from public,anon;
grant execute on function private.recurring_expense_classification_at(uuid,date) to authenticated,service_role;
create or replace function private.debt_expense_classification_at(p_debt uuid,p_no integer)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'expense_pattern',case when e.expense_pattern_set then e.expense_pattern else d.expense_pattern end,
    'expense_pattern_source',case when e.expense_pattern_set then e.expense_pattern_source else d.expense_pattern_source end,
    'expense_necessity',case when e.expense_necessity_set then e.expense_necessity else d.expense_necessity end,
    'expense_necessity_source',case when e.expense_necessity_set then e.expense_necessity_source else d.expense_necessity_source end)
  from public.debts d left join public.debt_installment_edits e on e.debt_id=d.id and e.installment_no=p_no
  where d.id=p_debt
$$;
revoke execute on function private.debt_expense_classification_at(uuid,integer) from public,anon;
grant execute on function private.debt_expense_classification_at(uuid,integer) to authenticated,service_role;

-- Explicit full snapshots are used when splitting an existing version. Incumbent calendar
-- writers omit them and inherit prior dated classification rather than today's parent.
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
  if new.kind<>'expense' then
    new.expense_pattern:=null;new.expense_pattern_source:=null;new.expense_necessity:=null;new.expense_necessity_source:=null;
  end if;
  return new;
end $$;

create or replace function private.expense_classification_history_scope(p_recurring uuid,p_input jsonb,p_boundary date,p_all boolean)
returns void language plpgsql security definer set search_path='' as $$
declare p jsonb:=private.expense_classification_patch(p_input);v private.recurring_history_versions%rowtype;
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
      insert into private.recurring_history_versions(recurring_id,workspace_id,valid_from,valid_through,
        anchor_date,rrule,kind,amount_cents,category,description,account_id,end_date,inferred_before,payment_method,
        expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source,metadata_snapshot_set)
      values(v.recurring_id,v.workspace_id,p_boundary,v.valid_through,v.anchor_date,v.rrule,v.kind,v.amount_cents,
        v.category,v.description,v.account_id,v.end_date,v.inferred_before,v.payment_method,
        v.expense_pattern,v.expense_pattern_source,v.expense_necessity,v.expense_necessity_source,true);
    end if;
  end if;
  update private.recurring_history_versions set
    expense_pattern=case when p?'expense_pattern' then p->>'expense_pattern' else expense_pattern end,
    expense_pattern_source=case when p?'expense_pattern' then p->>'expense_pattern_source' else expense_pattern_source end,
    expense_necessity=case when p?'expense_necessity' then p->>'expense_necessity' else expense_necessity end,
    expense_necessity_source=case when p?'expense_necessity' then p->>'expense_necessity_source' else expense_necessity_source end
    where recurring_id=p_recurring and (p_all or valid_from>=p_boundary) and kind='expense';
end $$;
revoke execute on function private.expense_classification_history_scope(uuid,jsonb,date,boolean) from public,anon;
grant execute on function private.expense_classification_history_scope(uuid,jsonb,date,boolean) to authenticated;
create or replace function private.apply_recurring_expense_classification(p_recurring uuid,p_ids uuid[],p_input jsonb,p_boundary date,p_all boolean)
returns bigint language plpgsql security invoker set search_path='' as $$
declare changed bigint; previous text:=coalesce(current_setting('proops.classification_scope_adapter',true),'');
begin
  perform set_config('proops.classification_scope_adapter','on',true);
  perform private.apply_expense_classification('recurring_transactions',array[p_recurring],p_input);
  perform set_config('proops.classification_scope_adapter',previous,true);
  changed:=private.apply_expense_classification('transactions',p_ids,p_input);
  perform private.expense_classification_history_scope(p_recurring,p_input,p_boundary,p_all);
  return changed;
end $$;
revoke execute on function private.apply_recurring_expense_classification(uuid,uuid[],jsonb,date,boolean) from public,anon;
grant execute on function private.apply_recurring_expense_classification(uuid,uuid[],jsonb,date,boolean) to authenticated;
create or replace function private.track_expense_classification_history()
returns trigger language plpgsql security invoker set search_path='' set timezone='America/Sao_Paulo' as $$ begin
  if row(old.expense_pattern,old.expense_pattern_source,old.expense_necessity,old.expense_necessity_source)
    is distinct from row(new.expense_pattern,new.expense_pattern_source,new.expense_necessity,new.expense_necessity_source)
    and coalesce(current_setting('proops.classification_scope_adapter',true),'')<>'on' then
    perform private.expense_classification_history_scope(new.id,jsonb_build_object(
      'expense_pattern',new.expense_pattern,'expense_pattern_source',new.expense_pattern_source,
      'expense_necessity',new.expense_necessity,'expense_necessity_source',new.expense_necessity_source),current_date,false);
  end if;
  return null;
end $$;
revoke execute on function private.track_expense_classification_history() from public,anon,authenticated;
create trigger zz_track_expense_classification_history after update of expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source
  on public.recurring_transactions for each row execute function private.track_expense_classification_history();

create or replace function private.inherit_expense_classification()
returns trigger language plpgsql security invoker set search_path='' as $$
declare c jsonb;parent_ws uuid;
begin
  if new.kind<>'expense' or new.pays_invoice_id is not null or new.pix_fee_for_transaction_id is not null then return new; end if;
  if new.recurring_id is not null then
    c:=private.recurring_expense_classification_at(new.recurring_id,new.occurred_at);
  elsif new.installment_plan_id is not null or new.down_payment_plan_id is not null then
    select jsonb_build_object('expense_pattern',expense_pattern,'expense_pattern_source',expense_pattern_source,
      'expense_necessity',expense_necessity,'expense_necessity_source',expense_necessity_source),workspace_id into c,parent_ws
      from public.installment_plans where id=coalesce(new.installment_plan_id,new.down_payment_plan_id);
  elsif new.debt_id is not null then c:=private.debt_expense_classification_at(new.debt_id,new.debt_payment_no);
  elsif new.down_payment_debt_id is not null then
    select jsonb_build_object('expense_pattern',expense_pattern,'expense_pattern_source',expense_pattern_source,
      'expense_necessity',expense_necessity,'expense_necessity_source',expense_necessity_source),workspace_id into c,parent_ws
      from public.debts where id=new.down_payment_debt_id;
  end if;
  if parent_ws is not null and parent_ws is distinct from new.workspace_id then raise exception 'Origem da classificação precisa pertencer ao mesmo workspace'; end if;
  if new.expense_pattern is null and new.expense_pattern_source is null then
    new.expense_pattern:=c->>'expense_pattern';new.expense_pattern_source:=c->>'expense_pattern_source';
  end if;
  if new.expense_necessity is null and new.expense_necessity_source is null then
    new.expense_necessity:=c->>'expense_necessity';new.expense_necessity_source:=c->>'expense_necessity_source';
  end if;
  return new;
end $$;
revoke execute on function private.inherit_expense_classification() from public,anon,authenticated;
-- The debt ledger and payment metadata triggers run first and establish origin/number.
create trigger zz_inherit_expense_classification before insert on public.transactions
  for each row execute function private.inherit_expense_classification();

-- Calendar writers legitimately replace financial versions. Overlay the saved metadata
-- timeline onto the resulting calendar so a financial edit cannot erase independent choices.
-- This internal helper is executable only by the owning history trigger, never by app clients.
create or replace function private.restore_recurring_metadata_history(p_recurring uuid,p_snapshots jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare calendars jsonb;
begin
  if p_snapshots is null or jsonb_array_length(p_snapshots)=0 then return; end if;
  select jsonb_agg(to_jsonb(v) order by valid_from) into calendars
    from private.recurring_history_versions v where recurring_id=p_recurring;
  delete from private.recurring_history_versions where recurring_id=p_recurring;
  insert into private.recurring_history_versions(recurring_id,workspace_id,valid_from,valid_through,
    anchor_date,inferred_before,rrule,kind,amount_cents,category,description,account_id,end_date,payment_method,
    expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source,metadata_snapshot_set)
  with metadata as (
    select m.*,case when row_number() over(order by valid_from)=1 then '-infinity'::date else valid_from end as starts,
      lead(valid_from) over(order by valid_from)-1 as ends
    from jsonb_populate_recordset(null::private.recurring_history_versions,p_snapshots) m
  )
  select c.recurring_id,c.workspace_id,greatest(c.valid_from,m.starts),
    nullif(least(coalesce(c.valid_through,'infinity'::date),coalesce(m.ends,'infinity'::date)),'infinity'::date),
    c.anchor_date,c.inferred_before,c.rrule,c.kind,c.amount_cents,c.category,c.description,c.account_id,c.end_date,m.payment_method,
    case when c.kind='expense' then m.expense_pattern end,case when c.kind='expense' then m.expense_pattern_source end,
    case when c.kind='expense' then m.expense_necessity end,case when c.kind='expense' then m.expense_necessity_source end,true
  from jsonb_populate_recordset(null::private.recurring_history_versions,calendars) c join metadata m
    on m.starts<=coalesce(c.valid_through,'infinity'::date) and coalesce(m.ends,'infinity'::date)>=c.valid_from;
end $$;
revoke execute on function private.restore_recurring_metadata_history(uuid,jsonb) from public,anon,authenticated;

-- Extend the existing F01 capture/restore triggers instead of duplicating the financial
-- calendar writer. BEFORE captures proven rows, AFTER restores independently dated metadata.
create or replace function private.capture_payment_history()
returns trigger language plpgsql security definer set search_path='' as $$
declare snapshots jsonb;
begin
  if row(old.rrule,old.dtstart,old.kind,old.amount_cents,old.category,old.description,old.account_id,old.end_date)
    is not distinct from row(new.rrule,new.dtstart,new.kind,new.amount_cents,new.category,new.description,new.account_id,new.end_date)
    or current_setting('proops.renomeando_categoria',true)='on' and
      row(old.rrule,old.dtstart,old.kind,old.amount_cents,old.description,old.account_id,old.end_date)
      is not distinct from row(new.rrule,new.dtstart,new.kind,new.amount_cents,new.description,new.account_id,new.end_date) then
    -- Clear a previous statement's capture as well: this transaction may edit the same
    -- parent repeatedly. A revision/metadata-only update has no calendar to reconstruct.
    perform set_config('proops.payment_history_'||replace(old.id::text,'-',''),'',true);
    return new;
  end if;
  select coalesce(jsonb_agg(to_jsonb(v) order by valid_from),'[]'::jsonb) into snapshots
    from private.recurring_history_versions v where recurring_id=old.id;
  perform set_config('proops.payment_history_'||replace(old.id::text,'-',''),snapshots::text,true);
  return new;
end $$;
create or replace function private.restore_payment_history()
returns trigger language plpgsql security definer set search_path='' as $$
declare snapshots jsonb;
begin
  snapshots:=nullif(current_setting('proops.payment_history_'||replace(new.id::text,'-',''),true),'')::jsonb;
  perform private.restore_recurring_metadata_history(new.id,snapshots);
  return null;
end $$;
