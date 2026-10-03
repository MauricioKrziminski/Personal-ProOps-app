-- F08: civil contribution intentions share the existing workspace cash/event sources.
-- No financial row is written by this projection or its calendar helpers.
create function private.goal_plan_month_on(p_anchor date,p_offset integer)
returns date language sql immutable strict security invoker set search_path='' as $$
 select (date_trunc('month',p_anchor)+p_offset*interval '1 month')::date
  + (least(extract(day from p_anchor)::integer,
      extract(day from date_trunc('month',p_anchor)+(p_offset+1)*interval '1 month'-interval '1 day')::integer)-1);
$$;
create function private.goal_plan_occurrence_count(p_anchor date,p_from date,p_to date)
returns integer language plpgsql immutable strict security invoker set search_path='' as $$
declare lo integer;hi integer;
begin
 if p_to<p_from or p_anchor>p_to then return 0;end if;
 lo:=greatest(0,(extract(year from p_from)::integer-extract(year from p_anchor)::integer)*12
  +extract(month from p_from)::integer-extract(month from p_anchor)::integer);
 hi:=(extract(year from p_to)::integer-extract(year from p_anchor)::integer)*12
  +extract(month from p_to)::integer-extract(month from p_anchor)::integer;
 if private.goal_plan_month_on(p_anchor,lo)<p_from then lo:=lo+1;end if;
 if private.goal_plan_month_on(p_anchor,hi)>p_to then hi:=hi-1;end if;
 return greatest(hi-lo+1,0);
end $$;
revoke execute on function private.goal_plan_month_on(date,integer),
 private.goal_plan_occurrence_count(date,date,date) from public,anon;
grant execute on function private.goal_plan_month_on(date,integer),
 private.goal_plan_occurrence_count(date,date,date) to authenticated;

create function public.goal_planning_state(p_workspace_id uuid,p_days integer,p_view text,p_mode text,p_preview jsonb default null)
returns jsonb language plpgsql stable security invoker set search_path='' set timezone='America/Sao_Paulo' as $$
declare
 ws uuid:=p_workspace_id;today date:=current_date;days integer:=private.clamp_forecast_days(p_days);
 finish date;close_day integer;fingerprint text;revision bigint;items jsonb;goals jsonb:='[]';
 incomplete jsonb:='[]';excluded jsonb:='[]';missed jsonb:='[]';points jsonb;months jsonb;
 reserve_state jsonb;reserved numeric;unassigned numeric;initial_cash numeric;income boolean;
 g record;i jsonb;included boolean;monthly numeric;first_on date;suggested numeric;origin text;
 remaining numeric;occurrences integer;first_pressure date;minimum_available numeric;unsafe boolean;
 maxsafe constant numeric:=9007199254740991;
begin
 if auth.uid() is null or ws is null or not exists(select 1 from public.workspace_members m where m.workspace_id=ws and m.user_id=auth.uid())
 then raise exception using errcode='42501',message='Workspace não autorizado';end if;
 if p_view is null or p_view not in('civil','cycle') or p_mode is null or p_mode not in('month','day')
 then raise exception using errcode='22023',message='Régua ou modo de planejamento inválido';end if;
 finish:=today+days;close_day:=private.cycle_close_day(array[ws],p_view);
 fingerprint:=private.goal_planning_fingerprint(ws);
 select p.edit_revision into revision from public.goal_plans p where p.workspace_id=ws;
 if p_preview is not null then
  if jsonb_typeof(p_preview)<>'object' or not(p_preview ?& array['goals_fingerprint','items'])
    or (select count(*) from jsonb_object_keys(p_preview))<>2
    or jsonb_typeof(p_preview->'goals_fingerprint')<>'string'
    or (p_preview->>'goals_fingerprint')!~'^[a-f0-9]{32}$'
  then raise exception using errcode='22023',message='Preview de metas inválido';end if;
  if p_preview->>'goals_fingerprint'<>fingerprint
  then raise exception using errcode='PT409',message='Metas alteradas; reabra o planejamento';end if;
  items:=private.validate_goal_plan_items(ws,p_preview->'items',false);
 end if;
 for g in select * from public.goals where workspace_id=ws and not archived and saved_cents<target_cents order by id loop
  if g.target_cents not between 1 and maxsafe or g.saved_cents not between 0 and maxsafe
    or g.deadline is not null and (g.deadline<date '0001-01-01' or g.deadline>date '9999-12-31')
  then raise exception using errcode='22003',message='Meta ultrapassa os limites seguros';end if;
  remaining:=g.target_cents::numeric-g.saved_cents::numeric;
  occurrences:=case when g.deadline>=today then private.goal_plan_occurrence_count(today,today,g.deadline) else 0 end;
  suggested:=case when occurrences>0 then ceil(remaining/occurrences) else null end;
  i:=null;
  if p_preview is not null then
   select x into i from jsonb_array_elements(items) x where x->>'goal_id'=g.id::text;
   origin:='draft';
  else
   select jsonb_build_object('included',p.included,'monthly_cents',p.monthly_cents,'first_on',p.first_on)
    into i from public.goal_plan_items p where p.workspace_id=ws and p.goal_id=g.id;
   origin:=case when i is null then 'suggested' else 'saved' end;
  end if;
  included:=coalesce((i->>'included')::boolean,true);
  monthly:=case when i is null then suggested else (i->>'monthly_cents')::numeric end;
  first_on:=case when i is null and suggested is not null then today else (i->>'first_on')::date end;
  if not included then
   monthly:=null;first_on:=null;excluded:=excluded||jsonb_build_array(g.id);
  elsif monthly is null or first_on is null then incomplete:=incomplete||jsonb_build_array(g.id);
  end if;
  if monthly is not null and (monthly<1 or monthly>maxsafe or monthly<>trunc(monthly))
    or first_on is not null and (first_on<date '0001-01-01' or first_on>date '9999-12-31')
  then raise exception using errcode='22003',message='Plano ultrapassa os limites seguros';end if;
  -- Only future intentions count toward a deadline. Past scheduled dates are not paid.
  if included and g.deadline is not null and (g.deadline<today or monthly is null or first_on is null
    or monthly*private.goal_plan_occurrence_count(first_on,today,g.deadline)<remaining)
  then missed:=missed||jsonb_build_array(g.id);end if;
  goals:=goals||jsonb_build_array(jsonb_build_object('goal_id',g.id,'name',g.name,
   'target_cents',g.target_cents::text,'saved_cents',g.saved_cents::text,'deadline',g.deadline,
   'included',included,'monthly_cents',monthly::text,'first_on',first_on,'suggested_cents',suggested::text,
   'origin',origin,'deadline_status',case when g.deadline is null then 'none' when g.deadline<today then 'past' else 'future' end));
 end loop;
 reserve_state:=public.emergency_reserve_state(ws,today);
 unassigned:=(reserve_state->>'unassigned_goals_cents')::numeric;
 -- Reserve state already validates eligibility and confirmed reserve liquidity. Goals
 -- share diminished backing proportionally; assets outside cash never subtract twice.
 select coalesce(sum((x->>'effective_cents')::numeric+
   case when (x->>'allocated_cents')::numeric+(x->>'other_allocated_cents')::numeric>0
   then floor((x->>'other_allocated_cents')::numeric*
    least((x->>'available_cents')::numeric,(x->>'allocated_cents')::numeric+(x->>'other_allocated_cents')::numeric)/
    ((x->>'allocated_cents')::numeric+(x->>'other_allocated_cents')::numeric)) else 0 end),0)
 into reserved from jsonb_array_elements(reserve_state->'sources') x where x->>'kind'='account' and (x->>'eligible')::boolean;
 initial_cash:=private.cash_total(array[ws]);
 if abs(initial_cash)>maxsafe or reserved>maxsafe or unassigned>maxsafe
 then raise exception using errcode='22003',message='Total ultrapassa centavos seguros';end if;
 with events as materialized (
  select e.day,e.in_cents::numeric as incoming,e.out_cents::numeric as outgoing
  from private.eventos_de_caixa(array[ws],finish) e
 ), active as (
  select (x->>'goal_id')::uuid as id,(x->>'first_on')::date as anchor,(x->>'monthly_cents')::numeric as monthly,
   (x->>'target_cents')::numeric-(x->>'saved_cents')::numeric as remaining,
   least(finish,coalesce((x->>'deadline')::date,finish)) as until
  from jsonb_array_elements(goals) x where (x->>'included')::boolean
   and x->>'monthly_cents' is not null and x->>'first_on' is not null
 ), calendar as (
  select a.*,private.goal_plan_month_on(a.anchor,n) as day
  from active a cross join lateral generate_series(
    greatest(0,(extract(year from today)::integer-extract(year from a.anchor)::integer)*12
     +extract(month from today)::integer-extract(month from a.anchor)::integer),
    (extract(year from a.until)::integer-extract(year from a.anchor)::integer)*12
     +extract(month from a.until)::integer-extract(month from a.anchor)::integer) n
 ), upcoming as (
  select c.*,row_number() over(partition by id order by day) as occurrence from calendar c where day between today and until
 ), intentions as (
  select u.day,sum(least(u.monthly,greatest(u.remaining-(u.occurrence-1)::numeric*u.monthly,0))) as planned
  from upcoming u group by u.day
 ), daily_events as (
  select day,sum(incoming-outgoing) as delta from events group by day
 ), daily as (
  select d.day,coalesce(e.delta,0) as delta,
   coalesce(i.planned,0) as planned
  from generate_series(today,finish,interval '1 day') n
  cross join lateral (select n::date as day) d left join intentions i using(day) left join daily_events e using(day)
 ), running as (
  select day,planned,initial_cash+sum(delta) over(order by day) as cash,
   sum(planned) over(order by day) as cumulative from daily
 ), state as materialized (
  select *,cash-reserved-cumulative as available,private.cycle_month_of(close_day,day) as month from running
 ), grouped as (
  select month,min(day) as first_day,max(day) as last_day,sum(planned) as planned,
   (array_agg(cash order by day desc))[1] as cash,(array_agg(cumulative order by day desc))[1] as cumulative,
   (array_agg(available order by day desc))[1] as available,min(day) filter(where available<0) as pressure
  from state group by month
 )
 select exists(select 1 from state where abs(cash)>maxsafe or planned>maxsafe or cumulative>maxsafe or abs(available)>maxsafe)
   or exists(select 1 from events where abs(incoming)>maxsafe or abs(outgoing)>maxsafe),
  exists(select 1 from events where day between today and finish and incoming>0),
  (select min(day) from state where available<0),
  (select min(available) from state),
  case when p_mode='day' then (select jsonb_agg(jsonb_build_object('day',day,'cash_cents',cash::text,
   'planned_cents',planned::text,'cumulative_planned_cents',cumulative::text,'available_cents',available::text) order by day) from state) else '[]'::jsonb end,
  case when p_mode='month' then (select jsonb_agg(jsonb_build_object('month',to_char(m.month,'YYYY-MM'),'from',b.ini,'to',b.fim,
   'partial',m.first_day<>b.ini or m.last_day<>b.fim,'cash_cents',m.cash::text,'planned_cents',m.planned::text,
   'cumulative_planned_cents',m.cumulative::text,'available_cents',m.available::text,'first_pressure_on',m.pressure) order by m.month)
   from grouped m cross join lateral private.cycle_bounds(close_day,m.month) b) else '[]'::jsonb end
 into unsafe,income,first_pressure,minimum_available,points,months;
 if unsafe then raise exception using errcode='22003',message='Projeção ultrapassa centavos seguros';end if;
 return jsonb_build_object('workspace_id',ws,'as_of',today,'days',days,'view',p_view,'mode',p_mode,
  'edit_revision',revision,'goals_fingerprint',fingerprint,'goals',goals,'reserved_cash_cents',reserved::text,
  'unassigned_goals_cents',unassigned::text,'income_present',income,'incomplete_goal_ids',incomplete,
  'excluded_goal_ids',excluded,'missed_deadline_goal_ids',missed,'points',points,'months',months,'first_pressure_on',first_pressure,
  'minimum_available_cents',minimum_available::text);
end $$;
revoke execute on function public.goal_planning_state(uuid,integer,text,text,jsonb) from public,anon;
grant execute on function public.goal_planning_state(uuid,integer,text,text,jsonb) to authenticated;
