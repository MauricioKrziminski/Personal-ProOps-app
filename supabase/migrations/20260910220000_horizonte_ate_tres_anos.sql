-- Horizonte da projeção: até 3 anos, e o teto num lugar só (10/09/2026)
--
-- O teto de 365 dias estava CRAVADO dentro de `cash_flow_forecast` e `_cash_flow_forecast`,
-- e a tela oferecia no máximo "6 meses". As duas coisas juntas produziam uma incoerência:
--
--   • "O mês inteiro" navega para QUALQUER mês de QUALQUER ano, e desde `20260910140000` a
--     recorrente é expandida da regra lá — então outubro de 2028 mostra salário e conta fixa.
--   • A Projeção parava em 6 meses, e o seletor de mês do rascunho só oferecia os meses
--     DENTRO da janela. Supor uma receita em 2028 era impossível, embora o dado existisse.
--
-- Agora o teto é `private.clamp_forecast_days`, num lugar só, e vale 1095 dias (3 anos).
-- Mudar de novo é uma linha, não quatro corpos de função reescritos.
--
-- ⚠️ **Efeito colateral BOM em `affordability`.** Ela chama a projeção com 370 dias e filtra até
-- `add_months(hoje, parcelas)` — com parcelas até 72. Com o teto em 365, qualquer parcelamento
-- acima de 12 meses era truncado em silêncio e o "pior dia" saía otimista. O app só oferece até
-- 12x, então nada muda na tela; o agente, que pode pedir mais, passa a receber a resposta certa.
--
-- ⚠️ O custo é uma linha por DIA: 3 anos = ~1.095 linhas de quatro inteiros. Se um dia isso
-- pesar, o caminho é uma RPC que já devolva por MÊS para a visão mensal — não abaixar o teto.

create or replace function private.clamp_forecast_days(days integer)
returns integer
language sql
immutable
as $$
  -- piso 1 (uma projeção de zero dia não existe), teto 1095 (3 anos), default 90
  select least(greatest(coalesce(days, 90), 1), 1095);
$$;

revoke execute on function private.clamp_forecast_days(integer) from public, anon;
grant execute on function private.clamp_forecast_days(integer) to authenticated, service_role;


create or replace function public._cash_flow_forecast(uid uuid, days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with horizonte as (select private.clamp_forecast_days(days) as dias),
  saldo_inicial as (select private.cash_total(array(select public._workspace_ids(uid))) as cents),
  eventos as (
    select greatest(ci.due_date, current_date) as day,
           0::bigint as in_cents,
           private.invoice_open_cents(ci.id) as out_cents
    from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.workspace_id in (select public._workspace_ids(uid)) and ci.status <> 'paid'
    group by ci.id, ci.due_date
    union all
    select greatest(coalesce(t.due_at, t.occurred_at), current_date),
           case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
           case when t.kind = 'expense' then t.amount_cents else 0 end::bigint
    from public.transactions t
    where t.workspace_id in (select public._workspace_ids(uid))
      and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
      and (t.kind <> 'income' or coalesce(t.due_at, t.occurred_at) >= current_date - 3)
    union all
    select greatest(s.due_date, current_date), 0::bigint, s.payment_cents
    from public.debts d
    cross join lateral private.debt_schedule_for(d.id) s
    where d.workspace_id in (select public._workspace_ids(uid))
      and not d.archived and d.remaining_cents > 0
      and s.due_date <= current_date + (select dias from horizonte)
    union all
    -- NOVO: recorrente além do horizonte materializado
    select p.due_date,
           case when p.kind = 'income'  then p.amount_cents else 0 end::bigint,
           case when p.kind = 'expense' then p.amount_cents else 0 end::bigint
    from private.recurring_projection_for(
           array(select public._workspace_ids(uid)), current_date,
           current_date + (select dias from horizonte)) p
  ),
  dias as (
    select generate_series(current_date, current_date + (select dias from horizonte),
                           interval '1 day')::date as day
  ),
  agregado as (
    select d.day,
           coalesce(sum(e.in_cents), 0)::bigint as in_cents,
           coalesce(sum(e.out_cents), 0)::bigint as out_cents
    from dias d left join eventos e on e.day = d.day
    group by d.day
  )
  select a.day, a.in_cents, a.out_cents,
         ((select cents from saldo_inicial)
          + sum(a.in_cents - a.out_cents) over (order by a.day))::bigint
  from agregado a
  order by a.day;
$function$;

create or replace function public.cash_flow_forecast(days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with horizonte as (select private.clamp_forecast_days(days) as dias),
  saldo_inicial as (select private.cash_total(array(select private.my_workspace_ids())) as cents),
  eventos as (
    select greatest(ci.due_date, current_date) as day,
           0::bigint as in_cents,
           private.invoice_open_cents(ci.id) as out_cents
    from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.workspace_id in (select private.my_workspace_ids()) and ci.status <> 'paid'
    group by ci.id, ci.due_date
    union all
    select greatest(coalesce(t.due_at, t.occurred_at), current_date),
           case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
           case when t.kind = 'expense' then t.amount_cents else 0 end::bigint
    from public.transactions t
    where t.workspace_id in (select private.my_workspace_ids())
      and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
      and (t.kind <> 'income' or coalesce(t.due_at, t.occurred_at) >= current_date - 3)
    union all
    select greatest(s.due_date, current_date), 0::bigint, s.payment_cents
    from public.debts d
    cross join lateral private.debt_schedule_for(d.id) s
    where d.workspace_id in (select private.my_workspace_ids())
      and not d.archived and d.remaining_cents > 0
      and s.due_date <= current_date + (select dias from horizonte)
    union all
    select p.due_date,
           case when p.kind = 'income'  then p.amount_cents else 0 end::bigint,
           case when p.kind = 'expense' then p.amount_cents else 0 end::bigint
    from private.recurring_projection_for(
           array(select private.my_workspace_ids()), current_date,
           current_date + (select dias from horizonte)) p
  ),
  dias as (
    select generate_series(current_date, current_date + (select dias from horizonte),
                           interval '1 day')::date as day
  ),
  agregado as (
    select d.day,
           coalesce(sum(e.in_cents), 0)::bigint as in_cents,
           coalesce(sum(e.out_cents), 0)::bigint as out_cents
    from dias d left join eventos e on e.day = d.day
    group by d.day
  )
  select a.day, a.in_cents, a.out_cents,
         ((select cents from saldo_inicial)
          + sum(a.in_cents - a.out_cents) over (order by a.day))::bigint
  from agregado a
  order by a.day;
$function$;
