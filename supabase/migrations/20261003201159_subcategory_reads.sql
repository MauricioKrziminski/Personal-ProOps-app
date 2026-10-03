-- F09: versioned reads leave all legacy ledger/report signatures intact.
create function public.ledger_expected_lines_detailed(p_from date,p_to date,p_recurring_id uuid default null)
returns table(origin text,ref_id uuid,due_date date,amount_cents bigint,kind text,description text,category text,
  account_id uuid,installment_no integer,installments_total integer,inferred_start boolean,status text,payment_method text,
  expense_pattern text,expense_pattern_source text,expense_necessity text,expense_necessity_source text,
  subcategory_id uuid,subcategory_name text,workspace_id uuid)
language sql stable security invoker set search_path='' as $$
  select l.origin,l.ref_id,l.due_date,l.amount_cents,l.kind,l.description,p.category,
    l.account_id,l.installment_no,l.installments_total,l.inferred_start,l.status,l.payment_method,
    l.expense_pattern,l.expense_pattern_source,l.expense_necessity,l.expense_necessity_source,
    s.id,s.name,p.workspace_id
  from public.ledger_expected_lines_classified(p_from,p_to,p_recurring_id) l
  left join public.recurring_transactions r on l.origin='recurring' and r.id=l.ref_id
  left join public.debts d on l.origin<>'recurring' and d.id=l.ref_id
  left join public.debt_installment_edits e on e.debt_id=d.id and e.installment_no=l.installment_no
  cross join lateral (select
    case when l.origin<>'recurring' and e.category_set then e.category else l.category end as category,
    coalesce(r.workspace_id,d.workspace_id) as workspace_id,
    case when l.origin='recurring' then private.recurring_subcategory_at(l.ref_id,l.due_date)
      else private.debt_subcategory_at(l.ref_id,l.installment_no) end as child) p
  left join public.subcategories s on s.id=p.child and s.workspace_id=p.workspace_id
    and s.parent_key=private.fold(p.category)
$$;
revoke execute on function public.ledger_expected_lines_detailed(date,date,uuid) from public,anon;
grant execute on function public.ledger_expected_lines_detailed(date,date,uuid) to authenticated;

-- Report selection matches annual_by_category: actual cleared rows, excluding transfers.
-- Exact parent spelling matches its existing report row; null is displayed as "outros".
create function public.category_detail_breakdown(p_from date,p_to date,p_kind text,p_parent_category text,
  p_workspace_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare scopes uuid[];result jsonb;uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'Autenticação obrigatória' using errcode='42501';end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366
    or p_kind is null or p_kind not in('expense','income') or p_parent_category is null
    or char_length(p_parent_category) not between 1 and 40 then
    raise exception 'Período ou categoria inválidos' using errcode='22023';
  end if;
  scopes:=array(select private.my_workspace_ids());
  if p_workspace_id is not null then
    if not(p_workspace_id=any(scopes)) then raise exception 'Espaço não disponível' using errcode='42501';end if;
    scopes:=array[p_workspace_id];
  end if;
  with source as (
    select t.subcategory_id,t.amount_cents from public.transactions t
    where t.workspace_id=any(scopes) and t.kind=p_kind and t.status='cleared'
      and t.occurred_at between p_from and p_to and coalesce(t.category,'outros')=p_parent_category
  ), grouped as (
    select x.subcategory_id,sum(x.amount_cents)::bigint as cents,count(*)::bigint as uses
    from source x group by x.subcategory_id
  ), lines as (
    select g.subcategory_id,s.name,w.name as workspace_name,g.cents,g.uses
    from grouped g left join public.subcategories s on s.id=g.subcategory_id
      left join public.workspaces w on w.id=s.workspace_id
  ) select jsonb_build_object('from',p_from,'to',p_to,'workspace_id',p_workspace_id,
    'kind',p_kind,'parent_category',p_parent_category,
    'total_cents',coalesce((select sum(x.amount_cents)::bigint from source x),0),
    'lines',coalesce((select jsonb_agg(jsonb_build_object('subcategory_id',l.subcategory_id,
      'name',l.name,'workspace_name',l.workspace_name,'total_cents',l.cents,'tx_count',l.uses)
      order by l.cents desc,l.name nulls last,l.subcategory_id) from lines l),'[]'::jsonb)) into result;
  return result;
end $$;
revoke execute on function public.category_detail_breakdown(date,date,text,text,uuid) from public,anon;
grant execute on function public.category_detail_breakdown(date,date,text,text,uuid) to authenticated;

create function public.subcategory_filter_states() returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(public.subcategory_state(w.id) order by w.id),'[]'::jsonb)
  from public.workspaces w where w.id in (select private.my_workspace_ids())
$$;
revoke execute on function public.subcategory_filter_states() from public,anon;
grant execute on function public.subcategory_filter_states() to authenticated;
