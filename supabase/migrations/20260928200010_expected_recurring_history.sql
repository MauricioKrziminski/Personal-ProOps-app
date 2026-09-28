-- Historical recurrence is a read model. Only the scheduler and edit RPCs write
-- transactions; an expected occurrence never claims payment or settlement.

create table private.recurring_history_versions (
  recurring_id uuid not null references public.recurring_transactions(id) on delete cascade,
  workspace_id uuid not null,
  valid_from date not null,
  valid_through date,
  anchor_date date not null,
  inferred_before date,
  rrule text not null,
  kind text not null,
  amount_cents bigint not null,
  category text,
  description text,
  account_id uuid,
  end_date date,
  primary key (recurring_id, valid_from),
  check (valid_through is null or valid_through >= valid_from)
);
create index recurring_history_versions_window_idx
  on private.recurring_history_versions(workspace_id, valid_from, valid_through);
alter table private.recurring_history_versions enable row level security;
create policy "workspace recurring history read" on private.recurring_history_versions
  for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));
grant select on private.recurring_history_versions to authenticated, service_role;

create table private.recurring_moved_occurrences (
  recurring_id uuid not null references public.recurring_transactions(id) on delete cascade,
  workspace_id uuid not null,
  original_date date not null,
  primary key (recurring_id, original_date)
);
alter table private.recurring_moved_occurrences enable row level security;
create policy "workspace recurring moves read" on private.recurring_moved_occurrences
  for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));
grant select on private.recurring_moved_occurrences to authenticated, service_role;

-- For old series, only a completed all-scope edit plus creation in an earlier
-- month supports a retroactive first monthly period. The RPC marks that period
-- as inferred. A merely future first due date is never backdated.
insert into private.recurring_history_versions
  (recurring_id, workspace_id, valid_from, anchor_date, inferred_before,
   rrule, kind, amount_cents, category, description, account_id, end_date)
select r.id, r.workspace_id,
       case when inferred.infer then date_trunc('month',
         r.created_at at time zone coalesce(p.timezone,'America/Sao_Paulo'))::date
         else least(anchor.due_date, coalesce(real.first_date, anchor.due_date)) end,
       case when inferred.infer then date_trunc('month',
         r.created_at at time zone coalesce(p.timezone,'America/Sao_Paulo'))::date
         else least(anchor.due_date, coalesce(real.first_date, anchor.due_date)) end,
       case when inferred.infer then anchor.due_date end,
       r.rrule, r.kind, r.amount_cents, r.category, r.description,
       r.account_id, r.end_date
from public.recurring_transactions r
left join public.profiles p on p.id=r.user_id
cross join lateral (select (coalesce(r.dtstart,r.next_run_at)
  at time zone coalesce(p.timezone,'America/Sao_Paulo'))::date as due_date) anchor
left join lateral (select min(t.occurred_at) first_date from public.transactions t
  where t.recurring_id=r.id and t.workspace_id=r.workspace_id) real on true
cross join lateral (select
  r.rrule ~ '^FREQ=MONTHLY' and
  date_trunc('month',r.created_at at time zone coalesce(p.timezone,'America/Sao_Paulo'))
    < date_trunc('month',coalesce(r.dtstart,r.next_run_at)
      at time zone coalesce(p.timezone,'America/Sao_Paulo')) and
  exists (select 1 from private.recurring_all_edit_requests e
    where e.recurring_id=r.id and e.result is not null) as infer) inferred;

-- One shared calendar expander supplies both future financial projections and
-- historical list projections. Unsupported RRULEs produce no guessed dates.
create function private.recurring_dates_for(
  p_rule text, p_anchor date, p_from date, p_to date
) returns table(due_date date)
language sql immutable set search_path = public
as $$
  select d.due_date from (
    select private.day_in_month(m::date,
      case when substring(p_rule from 'BYMONTHDAY=(-?[0-9]+)')='-1' then 31
           else substring(p_rule from 'BYMONTHDAY=([0-9]+)')::int end) due_date
    from generate_series(date_trunc('month',p_from::timestamp),
      date_trunc('month',p_to::timestamp),interval '1 month') m
    where p_rule ~ '^FREQ=MONTHLY(;INTERVAL=([2-9]|[1-9][0-9]))?;BYMONTHDAY=(-1|[1-9]|[12][0-9]|3[01])$'
      and ((extract(year from m)::int-extract(year from p_anchor)::int)*12
        +extract(month from m)::int-extract(month from p_anchor)::int)
          % coalesce(substring(p_rule from 'INTERVAL=([0-9]+)')::int,1)=0
    union all
    select (wk::date+case substring(p_rule from 'BYDAY=([A-Z]{2})')
      when 'MO' then 0 when 'TU' then 1 when 'WE' then 2 when 'TH' then 3
      when 'FR' then 4 when 'SA' then 5 when 'SU' then 6 end)::date
    from generate_series(date_trunc('week',p_from::timestamp),
      date_trunc('week',p_to::timestamp),interval '1 week') wk
    where p_rule ~ '^FREQ=WEEKLY;BYDAY=(SU|MO|TU|WE|TH|FR|SA)$'
    union all
    select private.day_in_month(make_date(yr,
      substring(p_rule from 'BYMONTH=([0-9]+)')::int,1),
      substring(p_rule from 'BYMONTHDAY=([0-9]+)')::int)
    from generate_series(extract(year from p_from)::int,
      extract(year from p_to)::int) yr
    where p_rule ~ '^FREQ=YEARLY;BYMONTH=([1-9]|1[0-2]);BYMONTHDAY=([1-9]|[12][0-9]|3[01])$'
  ) d where d.due_date between p_from and p_to and d.due_date>=p_anchor;
$$;
revoke execute on function private.recurring_dates_for(text,date,date,date) from public,anon;
grant execute on function private.recurring_dates_for(text,date,date,date) to authenticated,service_role;

create or replace function private.recurring_projection_for(
  ws_ids uuid[], from_date date, to_date date
) returns table(recurring_id uuid,kind text,amount_cents bigint,category text,
  description text,account_id uuid,due_date date)
language sql stable set search_path = public
as $$
  select r.id,r.kind,r.amount_cents,coalesce(r.category,'outros'),
    coalesce(nullif(r.description,''),r.category,'Recorrente'),r.account_id,d.due_date
  from public.recurring_transactions r
  left join public.profiles p on p.id=r.user_id
  cross join lateral private.recurring_dates_for(r.rrule,
    (coalesce(r.dtstart,r.next_run_at) at time zone
      coalesce(p.timezone,'America/Sao_Paulo'))::date,from_date,to_date) d
  where r.workspace_id=any(ws_ids) and r.active
    and d.due_date >= (now() at time zone coalesce(p.timezone,'America/Sao_Paulo'))::date
    and d.due_date > coalesce((r.materialized_until at time zone
      coalesce(p.timezone,'America/Sao_Paulo'))::date,date '1900-01-01')
    and (r.end_date is null or d.due_date<=r.end_date)
    and not exists (select 1 from public.transactions t
      where t.workspace_id=r.workspace_id and t.recurring_id=r.id
        and t.occurred_at=d.due_date);
$$;
revoke execute on function private.recurring_projection_for(uuid[],date,date) from public,anon;
grant execute on function private.recurring_projection_for(uuid[],date,date) to authenticated,service_role;

create function private.track_recurring_history() returns trigger
language plpgsql security definer
set search_path = ''
as $$
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
      else (now() at time zone tz)::date end;
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
create trigger track_recurring_history_insert after insert on public.recurring_transactions
  for each row execute function private.track_recurring_history();
create trigger track_recurring_history_update after update on public.recurring_transactions
  for each row execute function private.track_recurring_history();

create function private.track_recurring_one_move() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.recurring_id is not null and old.occurred_at is distinct from new.occurred_at
    and exists(select 1 from private.recurring_one_edit_requests e
      where e.transaction_id=old.id and e.user_id=auth.uid() and e.result is null) then
    insert into private.recurring_moved_occurrences
      (recurring_id,workspace_id,original_date)
    values(old.recurring_id,old.workspace_id,old.occurred_at)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger track_recurring_one_move after update of occurred_at on public.transactions
  for each row execute function private.track_recurring_one_move();

create function public.expected_recurring_occurrences(
  p_from date,p_to date,p_recurring_id uuid default null
) returns table(id uuid,recurring_id uuid,due_date date,amount_cents bigint,
  kind text,description text,category text,account_id uuid,inferred_start boolean)
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
begin
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>61 then
    raise exception 'Informe uma janela de no máximo 62 dias';
  end if;
  return query
    select (md5(v.recurring_id::text||':'||d.due_date::text))::uuid,
      v.recurring_id,d.due_date,v.amount_cents,v.kind,
      coalesce(nullif(v.description,''),v.category,'Recorrente'),
      coalesce(v.category,'outros'),v.account_id,
      v.inferred_before is not null and d.due_date<v.inferred_before
    from private.recurring_history_versions v
    join public.recurring_transactions r on r.id=v.recurring_id
      and r.workspace_id=v.workspace_id
    cross join lateral private.recurring_dates_for(v.rrule,v.anchor_date,
      greatest(p_from,v.valid_from),least(p_to,coalesce(v.valid_through,p_to))) d
    where v.workspace_id in (select private.my_workspace_ids())
      and (p_recurring_id is null or v.recurring_id=p_recurring_id)
      and v.valid_from<=p_to and coalesce(v.valid_through,p_to)>=p_from
      and r.active and (v.end_date is null or d.due_date<=v.end_date)
      and not exists(select 1 from public.transactions t
        where t.workspace_id=v.workspace_id and t.recurring_id=v.recurring_id
          and t.occurred_at=d.due_date)
      and not exists(select 1 from private.recurring_moved_occurrences m
        where m.recurring_id=v.recurring_id and m.original_date=d.due_date)
    order by d.due_date,v.recurring_id;
end;
$$;
revoke execute on function public.expected_recurring_occurrences(date,date,uuid)
  from public,anon;
grant execute on function public.expected_recurring_occurrences(date,date,uuid)
  to authenticated;
