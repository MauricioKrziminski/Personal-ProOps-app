-- A prevista do período é escolhida ANTES de descartar a data apagada.
--
-- Visto no emulador em 28/09/2026: com a série trocada de "dia 15" para "último dia", apagar a
-- prevista de 30/11 fazia voltar a de 15/11 — a `20260928210050` escolhia "uma por período"
-- DEPOIS de tirar a data apagada, e a regra velha ocupava o lugar. Agora a escolha (a versão mais
-- nova da regra no período) vem primeiro, e só então as exclusões: a data apagada ou movida, o
-- trecho que o agendador já gerou e o período que já tem a cobrança da série.

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
