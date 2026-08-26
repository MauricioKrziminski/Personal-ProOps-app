-- BUG: o caixa (patrimônio e saldo inicial da projeção) somava só as transações
-- ligadas a uma conta. Lançamento vindo do WhatsApp normalmente NÃO tem conta
-- (`resolveAccount` devolve null quando o usuário não cita), então quem só usa o
-- WhatsApp via caixa = soma dos saldos iniciais. `_account_balances` já tratava
-- isso com a linha sintética "Sem conta"; aqui faltava.
--
-- Transferência nunca entra no bloco "sem conta": por check no banco ela sempre
-- tem as duas contas.

create or replace function private.cash_total(ws_ids uuid[])
returns bigint
language sql stable
set search_path = public
as $$
  select (
    coalesce((
      select sum(
        a.initial_balance_cents + coalesce((
          select sum(case
            when t.kind = 'income'   and t.account_id = a.id then t.amount_cents
            when t.kind = 'expense'  and t.account_id = a.id then -t.amount_cents
            when t.kind = 'transfer' and t.account_id = a.id then -t.amount_cents
            when t.kind = 'transfer' and t.counterparty_account_id = a.id then t.amount_cents
            else 0 end)
          from public.transactions t
          where t.status = 'cleared'
            and (t.account_id = a.id or t.counterparty_account_id = a.id)
        ), 0))
      from public.accounts a
      where a.workspace_id = any(ws_ids) and not a.archived and a.type <> 'credit_card'
    ), 0)
    + coalesce((
      select sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end)
      from public.transactions t
      where t.workspace_id = any(ws_ids)
        and t.status = 'cleared'
        and t.account_id is null
        and t.kind <> 'transfer'
    ), 0)
  )::bigint;
$$;
grant execute on function private.cash_total(uuid[]) to authenticated, service_role;

create or replace function private.net_worth_now(ws_id uuid)
returns table(
  cash_cents bigint, investments_cents bigint, other_assets_cents bigint,
  liabilities_cents bigint, net_cents bigint
)
language sql stable
set search_path = public
as $$
  with dinheiro as (select private.cash_total(array[ws_id]) as cents),
  investimentos as (
    select coalesce(sum(current_value_cents), 0)::bigint as cents
    from public.assets
    where workspace_id = ws_id and not archived and not is_liability
      and class in ('investment','crypto','equity')
  ),
  outros as (
    select coalesce(sum(current_value_cents), 0)::bigint as cents
    from public.assets
    where workspace_id = ws_id and not archived and not is_liability
      and class not in ('investment','crypto','equity')
  ),
  passivos as (
    select (
      coalesce((select sum(current_value_cents) from public.assets
                where workspace_id = ws_id and not archived and is_liability), 0)
      + coalesce((select sum(remaining_cents) from public.debts
                  where workspace_id = ws_id and not archived), 0)
      + coalesce((select sum(t.amount_cents) from public.card_invoices ci
                  join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
                  where ci.workspace_id = ws_id and ci.status <> 'paid'), 0)
    )::bigint as cents
  )
  select d.cents, i.cents, o.cents, p.cents,
         (d.cents + i.cents + o.cents - p.cents)::bigint
  from dinheiro d, investimentos i, outros o, passivos p;
$$;

create or replace function public._cash_flow_forecast(uid uuid, days int default 90)
returns table(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
language sql stable security definer
set search_path = public
as $$
  with horizonte as (select least(greatest(coalesce(days, 90), 1), 365) as dias),
  saldo_inicial as (
    select private.cash_total(array(select public._workspace_ids(uid))) as cents
  ),
  eventos as (
    select greatest(ci.due_date, current_date) as day,
           0::bigint as in_cents,
           coalesce(sum(t.amount_cents), 0)::bigint as out_cents
    from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.workspace_id in (select public._workspace_ids(uid))
      and ci.status <> 'paid'
    group by ci.id, ci.due_date
    union all
    select greatest(coalesce(t.due_at, t.occurred_at), current_date),
           case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
           case when t.kind = 'expense' then t.amount_cents else 0 end::bigint
    from public.transactions t
    where t.workspace_id in (select public._workspace_ids(uid))
      and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
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
$$;
revoke execute on function public._cash_flow_forecast(uuid, int) from public, anon, authenticated;

create or replace function public.cash_flow_forecast(days int default 90)
returns table(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
language sql stable
set search_path = public
as $$
  with horizonte as (select least(greatest(coalesce(days, 90), 1), 365) as dias),
  saldo_inicial as (
    select private.cash_total(array(select private.my_workspace_ids())) as cents
  ),
  eventos as (
    select greatest(ci.due_date, current_date) as day,
           0::bigint as in_cents,
           coalesce(sum(t.amount_cents), 0)::bigint as out_cents
    from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.workspace_id in (select private.my_workspace_ids())
      and ci.status <> 'paid'
    group by ci.id, ci.due_date
    union all
    select greatest(coalesce(t.due_at, t.occurred_at), current_date),
           case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
           case when t.kind = 'expense' then t.amount_cents else 0 end::bigint
    from public.transactions t
    where t.workspace_id in (select private.my_workspace_ids())
      and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
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
$$;
