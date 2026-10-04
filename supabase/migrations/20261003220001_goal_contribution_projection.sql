-- Keep the published F08 helper untouched for regression evidence. It supplies
-- real cash/reserve facts with ALL intentions explicitly disabled; only the plan
-- calendar is overlaid below. No invoice/debt/event source is duplicated.
alter function private.goal_planning_state(uuid,integer,text,text,jsonb) rename to goal_planning_state_f08;
revoke execute on function private.goal_planning_state_f08(uuid,integer,text,text,jsonb) from public,anon,service_role;
grant execute on function private.goal_planning_state_f08(uuid,integer,text,text,jsonb) to authenticated;

create function private.goal_planning_state_v2(p_workspace_id uuid,p_days integer,p_view text,p_mode text,p_preview jsonb default null)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='America/Sao_Paulo' as $$
declare ws uuid:=p_workspace_id;today date:=current_date;finish date;fingerprint text;empty_preview jsonb;base jsonb;items jsonb;
 goals jsonb:='[]';horizons jsonb:='[]';incomplete jsonb:='[]';excluded jsonb:='[]';missed jsonb:='[]';
 g public.goals%rowtype;stored public.goal_plan_items%rowtype;i jsonb;r jsonb;b jsonb;origin text;suggested numeric;
 included boolean;monthly numeric;estimate date;first_on date;close_day integer;daily jsonb;months jsonb;
 first_pressure date;minimum_available numeric;unsafe boolean;context jsonb;maxsafe constant numeric:=9007199254740991;
begin
 if auth.uid() is null or ws is null or not exists(select 1 from public.workspace_members where workspace_id=ws and user_id=auth.uid())
 then raise exception using errcode='42501',message='Workspace não autorizado';end if;
 if p_view is null or p_view not in('civil','cycle') or p_mode is null or p_mode not in('month','day')
 then raise exception using errcode='22023',message='Régua ou modo de planejamento inválido';end if;
 fingerprint:=private.goal_planning_fingerprint(ws);
 if p_preview is not null then
  if jsonb_typeof(p_preview) is distinct from 'object' or not(p_preview?&array['goals_fingerprint','items'])
   or (select count(*) from jsonb_object_keys(p_preview))<>2
   or jsonb_typeof(p_preview->'goals_fingerprint') is distinct from 'string' or (p_preview->>'goals_fingerprint')!~'^[a-f0-9]{32}$'
  then raise exception using errcode='22023',message='Preview de metas inválido';end if;
  if p_preview->>'goals_fingerprint'<>fingerprint then raise exception using errcode='PT409',message='Metas alteradas; reabra o planejamento';end if;
  items:=private.validate_goal_plan_items_v2(ws,p_preview->'items',false,today);
 end if;
 select jsonb_build_object('goals_fingerprint',fingerprint,'items',coalesce(jsonb_agg(jsonb_build_object('goal_id',id,
  'included',false,'monthly_cents',null,'first_on',null) order by id),'[]')) into empty_preview
  from public.goals where workspace_id=ws and not archived and saved_cents<target_cents;
 base:=private.goal_planning_state_f08(ws,p_days,p_view,'day',empty_preview);
 finish:=today+(base->>'days')::integer;close_day:=private.cycle_close_day(array[ws],p_view);
 for g in select * from public.goals where workspace_id=ws and not archived and saved_cents<target_cents order by id loop
  select value into b from jsonb_array_elements(base->'goals') where value->>'goal_id'=g.id::text;
  suggested:=(b->>'suggested_cents')::numeric;
  if p_preview is not null then
   select value into i from jsonb_array_elements(items) where value->>'goal_id'=g.id::text;origin:='draft';
  else
   select * into stored from public.goal_plan_items where workspace_id=ws and goal_id=g.id;
   if stored.goal_id is null then
    origin:='suggested';
    i:=jsonb_build_object('goal_id',g.id,'included',true,'mode',case when g.deadline>=today then 'deadline' else 'monthly' end,
     'monthly_cents',null,'first_on',today,'deadline_on',case when g.deadline>=today then g.deadline else null end,
     'initial_cents',0,'initial_on',null);
   else origin:='saved';i:=private.goal_plan_item_source(stored);end if;
  end if;
  r:=private.goal_contribution_result(private.goal_contribution_input(g,i,today));
  included:=(i->>'included')::boolean;monthly:=(r->>'monthly_cents')::numeric;first_on:=(i->>'first_on')::date;estimate:=(r->>'estimated_on')::date;
  if not included then excluded:=excluded||jsonb_build_array(g.id);
  elsif r->>'status'<>'ready' then incomplete:=incomplete||jsonb_build_array(g.id);end if;
  if included and g.deadline is not null and (g.deadline<today or r->>'status'<>'ready' or estimate>g.deadline)
  then missed:=missed||jsonb_build_array(g.id);end if;
  goals:=goals||jsonb_build_array(b||jsonb_build_object('included',included,'monthly_cents',monthly::text,'first_on',first_on,'origin',origin));
  -- Currency is decimal text in BOTH item and result. Counts stay JSON numbers.
  horizons:=horizons||jsonb_build_array(jsonb_build_object('item',i||jsonb_build_object('monthly_cents',(i->>'monthly_cents')::numeric::text,
   'initial_cents',(i->>'initial_cents')::numeric::text),'result',r));
 end loop;
 with active as (
  select h->'item' as item,h->'result' as result,(h->'item'->>'goal_id')::uuid as id,
   (h->'result'->>'anchor_on')::date as anchor,(h->'result'->>'first_offset')::integer as first_offset,
   (h->'result'->>'monthly_count')::numeric as monthly_count,(h->'result'->>'monthly_cents')::numeric as monthly,
   (h->'result'->>'last_cents')::numeric as last_amount,(h->'result'->>'initial_applied_cents')::numeric as initial,
   (h->'item'->>'initial_on')::date as initial_on,
   case when h->'item'->>'mode'='legacy' then least(finish,coalesce(plan_goal.deadline,finish)) else finish end as until
  from jsonb_array_elements(horizons) h join public.goals plan_goal on plan_goal.id=(h->'item'->>'goal_id')::uuid and plan_goal.workspace_id=ws
  where (h->'item'->>'included')::boolean and h->'result'->>'status'='ready'
 ), monthly_calendar as (
  -- Bound enumeration to the visible <=3650 day window, never monthly_count.
  -- Older anchors can be year 0001; computing the first future offset was O(1).
  select a.*,n as monthly_index,private.goal_contribution_month_on(a.anchor,a.first_offset+n) as day
  from active a cross join lateral generate_series(0,
   least(a.monthly_count-1,greatest(-1,(extract(year from a.until)::integer-extract(year from a.anchor)::integer)*12
    +extract(month from a.until)::integer-extract(month from a.anchor)::integer-a.first_offset))::integer) n
  where a.anchor is not null and a.first_offset is not null
 ), intentions as (
  select day,sum(amount) as planned from (
   select calendar_entry.day,case when calendar_entry.monthly_index=calendar_entry.monthly_count-1 then calendar_entry.last_amount else calendar_entry.monthly end as amount
    from monthly_calendar calendar_entry where calendar_entry.day between today and calendar_entry.until
   union all
   select initial_entry.initial_on,initial_entry.initial from active initial_entry where initial_entry.initial>0 and initial_entry.initial_on between today and initial_entry.until
  ) contributions group by day
 ), running as (
  select (base_point->>'day')::date as day,(base_point->>'cash_cents')::numeric as cash,coalesce(intention.planned,0) as planned,
   sum(coalesce(intention.planned,0)) over(order by (base_point->>'day')::date) as cumulative,
   (base_point->>'available_cents')::numeric as base_available
  from jsonb_array_elements(base->'points') base_point left join intentions intention on intention.day=(base_point->>'day')::date
 ), state as materialized (
  select *,base_available-cumulative as available,private.cycle_month_of(close_day,day) as month from running
 ), grouped as (
  select month,min(day) as first_day,max(day) as last_day,sum(planned) as planned,
   (array_agg(cash order by day desc))[1] as cash,(array_agg(cumulative order by day desc))[1] as cumulative,
   (array_agg(available order by day desc))[1] as available,min(day) filter(where available<0) as pressure
  from state group by month
 )
 select exists(select 1 from state where planned>maxsafe or cumulative>maxsafe or abs(available)>maxsafe),
  (select min(day) from state where available<0),(select min(available) from state),
  case when p_mode='day' then (select jsonb_agg(jsonb_build_object('day',day,'cash_cents',cash::text,'planned_cents',planned::text,
   'cumulative_planned_cents',cumulative::text,'available_cents',available::text) order by day) from state) else '[]'::jsonb end,
  case when p_mode='month' then (select jsonb_agg(jsonb_build_object('month',to_char(m.month,'YYYY-MM'),'from',period_bounds.ini,'to',period_bounds.fim,
   'partial',m.first_day<>period_bounds.ini or m.last_day<>period_bounds.fim,'cash_cents',m.cash::text,'planned_cents',m.planned::text,
   'cumulative_planned_cents',m.cumulative::text,'available_cents',m.available::text,'first_pressure_on',m.pressure) order by m.month)
   from grouped m cross join lateral private.cycle_bounds(close_day,m.month) period_bounds) else '[]'::jsonb end
 into unsafe,first_pressure,minimum_available,daily,months;
 if unsafe then raise exception using errcode='22003',message='Projeção ultrapassa centavos seguros';end if;
 select jsonb_build_object('workspace_name',w.name,'cycle_close_day',w.cycle_close_day) into context from public.workspaces w where w.id=ws;
 if context is null then raise exception using errcode='42501',message='Espaço não autorizado';end if;
 base:=base||context||jsonb_build_object('mode',p_mode,'goals',goals,'incomplete_goal_ids',incomplete,'excluded_goal_ids',excluded,
  'missed_deadline_goal_ids',missed,'points',daily,'months',months,'first_pressure_on',first_pressure,'minimum_available_cents',minimum_available::text);
 return jsonb_build_object('state',base,'horizons',horizons);
end $$;

-- v1 callers keep the exact DTO and shape; omitted F10 intentions are inherited
-- only when their legacy monthly/date source matches the CURRENT calculated read.
create function private.goal_planning_state(p_workspace_id uuid,p_days integer,p_view text,p_mode text,p_preview jsonb default null)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='America/Sao_Paulo' as $$
declare preview jsonb:=p_preview;result jsonb;
begin
 if p_preview is not null then
  -- Validate the published preview envelope before adapting its four-field items.
  if jsonb_typeof(p_preview) is distinct from 'object' or not(p_preview?&array['goals_fingerprint','items'])
   or (select count(*) from jsonb_object_keys(p_preview))<>2
   or jsonb_typeof(p_preview->'goals_fingerprint') is distinct from 'string' or (p_preview->>'goals_fingerprint')!~'^[a-f0-9]{32}$'
  then raise exception using errcode='22023',message='Preview de metas inválido';end if;
  if auth.uid() is null or p_workspace_id is null or not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid())
  then raise exception using errcode='42501',message='Workspace não autorizado';end if;
  preview:=p_preview||jsonb_build_object('items',private.goal_plan_upgrade_items(p_workspace_id,p_preview->'items',current_date));
 end if;
 result:=private.goal_planning_state_v2(p_workspace_id,p_days,p_view,p_mode,preview);
 return result->'state';
end $$;
-- Replace the existing public body explicitly: pooled connections must not keep
-- a cached dependency on the renamed F08 helper after this migration.
create or replace function public.goal_planning_state(p_workspace_id uuid,p_days integer,p_view text,p_mode text,p_preview jsonb default null)
returns jsonb language sql stable security invoker set search_path='' set timezone='America/Sao_Paulo' as $$
 select private.goal_planning_state(p_workspace_id,p_days,p_view,p_mode,p_preview);
$$;
create function public.goal_planning_state_v2(p_workspace_id uuid,p_days integer,p_view text,p_mode text,p_preview jsonb default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.goal_planning_state_v2(p_workspace_id,p_days,p_view,p_mode,p_preview);
$$;
revoke execute on function private.goal_planning_state_v2(uuid,integer,text,text,jsonb),
 private.goal_planning_state(uuid,integer,text,text,jsonb),public.goal_planning_state(uuid,integer,text,text,jsonb),
 public.goal_planning_state_v2(uuid,integer,text,text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function private.goal_planning_state_v2(uuid,integer,text,text,jsonb),
 private.goal_planning_state(uuid,integer,text,text,jsonb),public.goal_planning_state(uuid,integer,text,text,jsonb),
 public.goal_planning_state_v2(uuid,integer,text,text,jsonb)
 to authenticated;
