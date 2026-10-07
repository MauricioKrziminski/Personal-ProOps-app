-- Pausar com prazo (spec 2026-10-07-pausar-e-carencia-design.md, secao 1). O periodo e [de, ate).
alter table public.recurring_transactions
  add column if not exists paused_from date,
  add column if not exists paused_until date,
  add constraint recurring_pause_window check (
    (paused_from is null) = (paused_until is null)
    and (paused_until is null or paused_until > paused_from));
alter table public.reminders
  add column if not exists paused_from date,
  add column if not exists paused_until date,
  add constraint reminders_pause_window check (
    (paused_from is null) = (paused_until is null)
    and (paused_until is null or paused_until > paused_from));

-- UM predicado para "esta data esta pausada". O agente (recurrence.py `em_pausa`) e o app
-- (src/lib/pausa.ts `emPausa`) repetem a MESMA regua: fim exclusivo.
create or replace function private.em_pausa(p_dia date, p_de date, p_ate date)
returns boolean language sql immutable as $$
  select p_de is not null and p_dia >= p_de and p_dia < p_ate
$$;
revoke execute on function private.em_pausa(date, date, date) from public, anon;
grant execute on function private.em_pausa(date, date, date) to authenticated, service_role;

create or replace function private.recurring_projection_all_for(
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
    and not private.em_pausa(d.due_date, r.paused_from, r.paused_until)
    and not exists (select 1 from public.transactions t
      where t.workspace_id=r.workspace_id and t.recurring_id=r.id
        and t.occurred_at=d.due_date);
$$;
revoke execute on function private.recurring_projection_all_for(uuid[],date,date) from public,anon;
grant execute on function private.recurring_projection_all_for(uuid[],date,date) to authenticated,service_role;

create or replace function public.expected_recurring_occurrences(
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
    select x.id, x.recurring_id, x.due_date, x.amount_cents, x.kind, x.description,
           x.category, x.account_id, x.inferred_start
    from (
      select distinct on (v.recurring_id, date_trunc(pr.periodo, d.due_date))
        (md5(v.recurring_id::text||':'||d.due_date::text))::uuid as id,
        v.recurring_id, v.workspace_id, d.due_date, v.amount_cents, v.kind,
        coalesce(nullif(v.description,''),v.category,'Recorrente') as description,
        coalesce(v.category,'outros') as category, v.account_id,
        v.inferred_before is not null and d.due_date<v.inferred_before as inferred_start,
        pr.periodo, pr.gerado_desde, pr.gerado_ate
      from private.recurring_history_versions v
      join public.recurring_transactions r on r.id=v.recurring_id
        and r.workspace_id=v.workspace_id
      left join public.profiles p on p.id=r.user_id
      cross join lateral private.recurring_dates_for(v.rrule,v.anchor_date,
        greatest(p_from,v.valid_from),least(p_to,coalesce(v.valid_through,p_to))) d
      cross join lateral (select case when v.rrule like 'FREQ=WEEKLY%' then 'week'
        when v.rrule like 'FREQ=YEARLY%' then 'year' else 'month' end as periodo,
        (r.materialized_until at time zone coalesce(p.timezone,'America/Sao_Paulo'))::date as gerado_ate,
        (select min(t.occurred_at) from public.transactions t
          where t.recurring_id=r.id and t.workspace_id=r.workspace_id) as gerado_desde) pr
      where v.workspace_id in (select private.my_workspace_ids())
        and (p_recurring_id is null or v.recurring_id=p_recurring_id)
        and v.valid_from<=p_to and coalesce(v.valid_through,p_to)>=p_from
        and r.active and (v.end_date is null or d.due_date<=v.end_date)
        and not private.em_pausa(d.due_date, r.paused_from, r.paused_until)
      order by v.recurring_id, date_trunc(pr.periodo, d.due_date), v.valid_from desc
    ) x
    where not coalesce(x.due_date between x.gerado_desde and x.gerado_ate, false)
      and not exists(select 1 from public.transactions t
        where t.workspace_id=x.workspace_id and t.recurring_id=x.recurring_id
          and date_trunc(x.periodo, case when t.invoice_id is null
                then coalesce(t.due_at,t.occurred_at) else t.occurred_at end)
            = date_trunc(x.periodo, x.due_date))
      and not exists(select 1 from private.recurring_moved_occurrences m
        where m.recurring_id=x.recurring_id and m.original_date=x.due_date)
    order by x.due_date, x.recurring_id;
end;
$$;
revoke execute on function public.expected_recurring_occurrences(date,date,uuid) from public,anon;
grant execute on function public.expected_recurring_occurrences(date,date,uuid) to authenticated;

create table if not exists private.recurring_pause_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table private.recurring_pause_receipts enable row level security;
revoke all on private.recurring_pause_receipts from public, anon, authenticated, service_role;

-- UMA conta para a previa e o comando. p_op: 'pause' | 'resume'.
create or replace function private.pause_recurring(
  p_op text, p_recurring_id uuid, p_from date, p_until date, p_request_id uuid, p_apply boolean
) returns jsonb
language plpgsql security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := auth.uid();
  r public.recurring_transactions%rowtype;
  sealed private.recurring_pause_receipts%rowtype;
  intent jsonb;
  tz text;
  ids uuid[];
  datas date[];
  removidos bigint;
  previstos bigint;
  result jsonb;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação obrigatória';
  end if;
  if p_op not in ('pause', 'resume') then
    raise exception using errcode = '22023', message = 'Operação inválida';
  end if;
  if p_op = 'pause' and (p_from is null or p_until is null or p_until <= p_from) then
    raise exception using errcode = '22023', message = 'O fim da pausa precisa ser depois do início';
  end if;
  if p_apply and p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da tentativa obrigatório';
  end if;
  select * into r from public.recurring_transactions x where x.id = p_recurring_id;
  if r.id is null or not exists (select 1 from public.workspace_members m
                                 where m.workspace_id = r.workspace_id and m.user_id = uid) then
    raise exception using errcode = 'P0001', message = 'Recorrência não encontrada';
  end if;
  if p_apply then
    intent := jsonb_build_object('operation', p_op, 'recurring_id', p_recurring_id,
                                 'from', p_from, 'until', p_until);
    perform pg_advisory_xact_lock(hashtextextended('recurring-pause:' || r.workspace_id::text, 0));
    select * into sealed from private.recurring_pause_receipts
      where user_id = uid and request_id = p_request_id;
    if sealed.request_id is not null then
      if sealed.payload is distinct from intent then
        raise exception using errcode = '22023', message = 'Identificador reutilizado com dados diferentes';
      end if;
      return sealed.result;
    end if;
    select * into r from public.recurring_transactions x where x.id = p_recurring_id for update;
    perform 1 from public.transactions t where t.recurring_id = r.id and t.workspace_id = r.workspace_id order by t.id for update;
  end if;

  if p_op = 'resume' then
    if not p_apply then return '{}'::jsonb; end if;
    -- Retomar encerra a pausa HOJE: o que passou pausado não volta como "já aconteceu".
    update public.recurring_transactions x set
      paused_from = case when x.paused_from >= current_date then null else x.paused_from end,
      paused_until = case when x.paused_from is null or x.paused_from >= current_date then null
                          when x.paused_until <= current_date then x.paused_until
                          else current_date end,
      materialized_until = null
    where x.id = r.id;
    result := jsonb_build_object('resumed', true);
  else
    select coalesce(p.timezone, 'America/Sao_Paulo') into tz from public.profiles p where p.id = r.user_id;
    -- As gravadas que saem: em aberto, a vencer (atrasada fica), fora de fatura travada.
    select array_agg(t.id), coalesce(sum(t.amount_cents), 0) into ids, removidos
    from public.transactions t
    where t.recurring_id = r.id and t.workspace_id = r.workspace_id and t.status = 'pending'
      and not private.parcela_travada(t.status, t.invoice_id)
      and (case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end)
          >= greatest(p_from, current_date)
      and (case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end)
          < p_until;
    -- Datas que somem: as das linhas que saem + as da regra sem linha nenhuma (a que fica, paga ou
    -- travada, não sai da projeção). A regra entra pelo valor da série.
    with regra as (
      select d.due_date from private.recurring_dates_for(r.rrule,
        (coalesce(r.dtstart, r.next_run_at) at time zone tz)::date,
        greatest(p_from, current_date), p_until - 1) d
      where (r.end_date is null or d.due_date <= r.end_date)
        and not exists (select 1 from public.transactions t
                        where t.recurring_id = r.id and t.workspace_id = r.workspace_id
                          and t.occurred_at = d.due_date)
        and not exists (select 1 from private.recurring_moved_occurrences m
                        where m.recurring_id = r.id and m.original_date = d.due_date)
    ), linhas as (
      select case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end as due_date
      from public.transactions t where t.id = any(coalesce(ids, '{}'))
    )
    select array_agg(x.due_date order by x.due_date),
           (select count(*) from regra) * r.amount_cents
      into datas, previstos
    from (select due_date from regra union select due_date from linhas) x;
    result := jsonb_build_object(
      'dates', coalesce(to_jsonb(datas::text[]), '[]'::jsonb),
      'removed_count', coalesce(array_length(ids, 1), 0),
      'cents', removidos + coalesce(previstos, 0),
      'until', p_until);
    if not p_apply then return result; end if;
    -- O UPDATE vem antes do DELETE (`marca_serie_editada`): a linha apagada pela pausa não entra
    -- em "apagada não volta" — ela tem que voltar se a pausa for encurtada. `materialized_until`
    -- zera para o agendador regravar o que voltar (ruling R1).
    update public.recurring_transactions x
      set paused_from = p_from, paused_until = p_until, materialized_until = null
    where x.id = r.id;
    if ids is not null then
      delete from public.transactions t where t.id = any(ids) and t.workspace_id = r.workspace_id
        and t.status = 'pending' and not private.parcela_travada(t.status, t.invoice_id);
    end if;
  end if;
  insert into private.recurring_pause_receipts(user_id, request_id, workspace_id, payload, result)
    values (uid, p_request_id, r.workspace_id, intent, result);
  return result;
end $$;
revoke execute on function private.pause_recurring(text, uuid, date, date, uuid, boolean) from public, anon;
grant execute on function private.pause_recurring(text, uuid, date, date, uuid, boolean) to authenticated;

create or replace function public.pause_recurring(p_recurring_id uuid, p_from date, p_until date, p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.pause_recurring('pause', p_recurring_id, p_from, p_until, p_request_id, true)
$$;
create or replace function public.pause_recurring_preview(p_recurring_id uuid, p_from date, p_until date)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.pause_recurring('pause', p_recurring_id, p_from, p_until, null, false)
$$;
create or replace function public.resume_recurring(p_recurring_id uuid, p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.pause_recurring('resume', p_recurring_id, null, null, p_request_id, true)
$$;
revoke execute on function public.pause_recurring(uuid, date, date, uuid) from public, anon;
revoke execute on function public.pause_recurring_preview(uuid, date, date) from public, anon;
revoke execute on function public.resume_recurring(uuid, uuid) from public, anon;
grant execute on function public.pause_recurring(uuid, date, date, uuid) to authenticated;
grant execute on function public.pause_recurring_preview(uuid, date, date) to authenticated;
grant execute on function public.resume_recurring(uuid, uuid) to authenticated;
