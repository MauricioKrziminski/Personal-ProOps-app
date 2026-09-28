-- A leitura alem do horizonte usa as mesmas formas de RRULE aceitas pela edicao da serie.
-- dtstart (ou next_run_at nas series antigas) ancora o intervalo; materialized_until
-- e a data da ultima ocorrencia real no fuso do dono da serie.
create or replace function private.recurring_projection_for(
  ws_ids uuid[], from_date date, to_date date
)
returns table (
  recurring_id uuid, kind text, amount_cents bigint, category text,
  description text, account_id uuid, due_date date
)
language sql stable
set search_path = public
as $$
  with series as (
    select r.*,
           (coalesce(r.dtstart, r.next_run_at)
             at time zone coalesce(p.timezone, 'America/Sao_Paulo'))::date as anchor_date,
           (r.materialized_until
             at time zone coalesce(p.timezone, 'America/Sao_Paulo'))::date as covered_date,
           (now() at time zone coalesce(p.timezone, 'America/Sao_Paulo'))::date as today
    from public.recurring_transactions r
    left join public.profiles p on p.id = r.user_id
    where r.workspace_id = any(ws_ids) and r.active
  )
  select r.id, r.kind, r.amount_cents, coalesce(r.category, 'outros'),
         coalesce(nullif(r.description, ''), r.category, 'Recorrente'),
         r.account_id, d.due_date
  from series r
  cross join lateral (
    -- Mensal: o intervalo e contado desde o mes da ancora, nunca desde o mes
    -- consultado (consultas em janelas diferentes precisam dar o mesmo resultado).
    select private.day_in_month(m::date,
             case when substring(r.rrule from 'BYMONTHDAY=(-?[0-9]+)') = '-1'
                  then 31
                  else substring(r.rrule from 'BYMONTHDAY=([0-9]+)')::int end) as due_date
    from generate_series(date_trunc('month', from_date::timestamp),
                         date_trunc('month', to_date::timestamp), interval '1 month') m
    where r.rrule ~ '^FREQ=MONTHLY(;INTERVAL=([2-9]|[1-9][0-9]))?;BYMONTHDAY=(-1|[1-9]|[12][0-9]|3[01])$'
      and (
        (extract(year from m)::int - extract(year from r.anchor_date)::int) * 12
        + extract(month from m)::int - extract(month from r.anchor_date)::int
      ) % coalesce(substring(r.rrule from 'INTERVAL=([0-9]+)')::int, 1) = 0

    union all

    -- Uma ocorrencia por semana no dia escolhido; a ancora corta a semana
    -- inicial se o dia escolhido ainda antecedia dtstart.
    select (wk::date + case substring(r.rrule from 'BYDAY=([A-Z]{2})')
      when 'MO' then 0 when 'TU' then 1 when 'WE' then 2
      when 'TH' then 3 when 'FR' then 4 when 'SA' then 5
      when 'SU' then 6 end) as due_date
    from generate_series(date_trunc('week', from_date::timestamp),
                         date_trunc('week', to_date::timestamp), interval '1 week') wk
    where r.rrule ~ '^FREQ=WEEKLY;BYDAY=(SU|MO|TU|WE|TH|FR|SA)$'

    union all

    -- Anual: day_in_month aplica o mesmo clamp do agendador a 29/02.
    select private.day_in_month(
             make_date(yr, substring(r.rrule from 'BYMONTH=([0-9]+)')::int, 1),
             substring(r.rrule from 'BYMONTHDAY=([0-9]+)')::int) as due_date
    from generate_series(extract(year from from_date)::int,
                         extract(year from to_date)::int) yr
    where r.rrule ~ '^FREQ=YEARLY;BYMONTH=([1-9]|1[0-2]);BYMONTHDAY=([1-9]|[12][0-9]|3[01])$'
  ) d
  where d.due_date between from_date and to_date
    and d.due_date >= r.anchor_date
    and d.due_date >= r.today
    and d.due_date > coalesce(r.covered_date, date '1900-01-01')
    and (r.end_date is null or d.due_date <= r.end_date)
    -- Uma edicao pode zerar materialized_until e manter uma linha pendente,
    -- deslocada para a primeira data da nova regra. Ela ja e a ocorrencia real.
    and not exists (
      select 1 from public.transactions t
      where t.workspace_id = r.workspace_id and t.recurring_id = r.id
        and t.occurred_at = d.due_date
    );
$$;

revoke execute on function private.recurring_projection_for(uuid[], date, date) from public, anon;
grant execute on function private.recurring_projection_for(uuid[], date, date) to authenticated, service_role;
