-- Projeção de fluxo de caixa: "quanto sobra dia 28" e "posso comprar isso em 10x?".
-- É o gap nº2 do mercado — todo concorrente mostra só o retrovisor.
--
-- Como funciona: o recorrente deixa de virar lançamento SÓ no dia e passa a ser
-- materializado 90 dias à frente como `transactions` com `status='pending'`.
-- Com isso a projeção vira um `sum()` em SQL — não precisa expandir RRULE em
-- runtime — e o usuário enxerga as contas que ainda vão cair.
--
-- Modelo de caixa (evita contar o mesmo gasto duas vezes):
--   saldo inicial = contas que guardam dinheiro (não-cartão), só `cleared`
--   saída futura  = (a) TODA fatura não paga, na data de VENCIMENTO dela
--                   (b) pendentes sem fatura, em coalesce(due_at, occurred_at)
-- Compra no cartão sai do caixa quando a fatura vence, não quando foi feita.

-- ── recorrentes: transferência, fim da série e confirmação automática ───────
alter table public.recurring_transactions
  add column if not exists end_date date,
  add column if not exists auto_confirm boolean not null default true,
  add column if not exists materialized_until timestamptz;

comment on column public.recurring_transactions.auto_confirm is
  'true = ao chegar a data vira cleared sozinho (comportamento antigo). false = fica pending até o usuário dizer que pagou.';
comment on column public.recurring_transactions.materialized_until is
  'última ocorrência já gravada em transactions. Controle do cron; next_run_at continua sendo a próxima ocorrência FUTURA (é o que o app mostra).';

alter table public.recurring_transactions drop constraint if exists recurring_transactions_kind_check;
alter table public.recurring_transactions add constraint recurring_transactions_kind_check
  check (kind in ('expense','income','transfer'));

-- ── vínculo parcela/ocorrência -> série ────────────────────────────────────
alter table public.transactions
  add column if not exists recurring_id uuid
    references public.recurring_transactions(id) on delete set null;

-- idempotência da materialização: rodar o cron duas vezes não duplica nada
create unique index if not exists transactions_recurring_occurrence_idx
  on public.transactions (recurring_id, occurred_at)
  where recurring_id is not null;

-- ── manutenção diária (chamada pelo finance-scheduler) ─────────────────────
/**
 * Promove para `cleared` o que já aconteceu de verdade:
 * parcela de compra parcelada (a compra existe desde o dia 1) e ocorrência de
 * série com auto_confirm. Conta a pagar avulsa NÃO entra: quem confirma é o
 * usuário ("paguei a luz").
 */
create or replace function public._promote_due_transactions()
returns int
language sql security definer
set search_path = public
as $$
  with promovidas as (
    update public.transactions t
    set status = 'cleared'
    from (
      select t2.id from public.transactions t2
      left join public.recurring_transactions r on r.id = t2.recurring_id
      where t2.status = 'pending'
        and t2.occurred_at <= current_date
        and (t2.installment_plan_id is not null or coalesce(r.auto_confirm, false))
    ) alvo
    where t.id = alvo.id
    returning t.id
  )
  select count(*)::int from promovidas;
$$;
revoke execute on function public._promote_due_transactions() from public, anon, authenticated;

/** Fecha as faturas cuja data de fechamento já passou (não mexe nas pagas). */
create or replace function public._close_due_invoices()
returns int
language sql security definer
set search_path = public
as $$
  with fechadas as (
    update public.card_invoices
    set status = 'closed'
    where status = 'open' and closing_date < current_date
    returning id
  )
  select count(*)::int from fechadas;
$$;
revoke execute on function public._close_due_invoices() from public, anon, authenticated;

-- ── projeção de fluxo de caixa ─────────────────────────────────────────────
create or replace function public._cash_flow_forecast(uid uuid, days int default 90)
returns table(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
language sql stable security definer
set search_path = public
as $$
  with horizonte as (
    select least(greatest(coalesce(days, 90), 1), 365) as dias
  ),
  saldo_inicial as (
    select coalesce(sum(
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
      ), 0)
    ), 0)::bigint as cents
    from public.accounts a
    where a.workspace_id in (select public._workspace_ids(uid))
      and not a.archived and a.type <> 'credit_card'
  ),
  eventos as (
    -- (a) fatura não paga sai do caixa no vencimento
    select greatest(ci.due_date, current_date) as day,
           0::bigint as in_cents,
           coalesce(sum(t.amount_cents), 0)::bigint as out_cents
    from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.workspace_id in (select public._workspace_ids(uid))
      and ci.status <> 'paid'
    group by ci.id, ci.due_date
    union all
    -- (b) pendentes fora de fatura (contas a pagar, recorrentes, receitas)
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
    from dias d
    left join eventos e on e.day = d.day
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
  with horizonte as (
    select least(greatest(coalesce(days, 90), 1), 365) as dias
  ),
  saldo_inicial as (
    select coalesce(sum(
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
      ), 0)
    ), 0)::bigint as cents
    from public.accounts a
    where a.workspace_id in (select private.my_workspace_ids())
      and not a.archived and a.type <> 'credit_card'
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
    from dias d
    left join eventos e on e.day = d.day
    group by d.day
  )
  select a.day, a.in_cents, a.out_cents,
         ((select cents from saldo_inicial)
          + sum(a.in_cents - a.out_cents) over (order by a.day))::bigint
  from agregado a
  order by a.day;
$$;

-- ── contas a pagar / receber ───────────────────────────────────────────────
create or replace function public._upcoming_bills(uid uuid, days int default 30)
returns table(
  kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean
)
language sql stable security definer
set search_path = public
as $$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         coalesce(sum(t.amount_cents), 0)::bigint, ci.due_date,
         ci.due_date < current_date
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
  where ci.workspace_id in (select public._workspace_ids(uid))
    and ci.status <> 'paid'
    and ci.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  group by ci.id, a.name, ci.due_date
  union all
  select 'transaction', t.id,
         coalesce(t.description, t.category, 'Lançamento'),
         t.amount_cents, coalesce(t.due_at, t.occurred_at),
         coalesce(t.due_at, t.occurred_at) < current_date
  from public.transactions t
  where t.workspace_id in (select public._workspace_ids(uid))
    and t.status = 'pending' and t.invoice_id is null and t.kind = 'expense'
    and coalesce(t.due_at, t.occurred_at) <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  order by 5;
$$;
revoke execute on function public._upcoming_bills(uuid, int) from public, anon, authenticated;

create or replace function public.upcoming_bills(days int default 30)
returns table(
  kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean
)
language sql stable
set search_path = public
as $$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         coalesce(sum(t.amount_cents), 0)::bigint, ci.due_date,
         ci.due_date < current_date
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
  where ci.workspace_id in (select private.my_workspace_ids())
    and ci.status <> 'paid'
    and ci.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  group by ci.id, a.name, ci.due_date
  union all
  select 'transaction', t.id,
         coalesce(t.description, t.category, 'Lançamento'),
         t.amount_cents, coalesce(t.due_at, t.occurred_at),
         coalesce(t.due_at, t.occurred_at) < current_date
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
    and t.status = 'pending' and t.invoice_id is null and t.kind = 'expense'
    and coalesce(t.due_at, t.occurred_at) <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  order by 5;
$$;

-- ── "posso comprar isso?" ──────────────────────────────────────────────────
/**
 * Simula a compra em cima da projeção: N parcelas mensais a partir de hoje.
 * Devolve o pior saldo do período e o dia em que ele acontece — é isso que a
 * resposta do WhatsApp e a tela do simulador mostram.
 * Compõe com a projeção (não duplica a query): a interna chama a interna e o
 * wrapper chama o wrapper, cada um no seu regime de permissão.
 */
create or replace function public._affordability(uid uuid, amount_cents bigint, installments int default 1)
returns table(
  can_afford boolean, worst_day date, worst_balance_cents bigint, installment_cents bigint
)
language sql stable security definer
set search_path = public
as $$
  with n as (select least(greatest(coalesce(installments, 1), 1), 72) as parcelas),
  parcela as (
    select (amount_cents / (select parcelas from n))::bigint as cents
  ),
  simulado as (
    select f.day, f.balance_cents
           - (select cents from parcela)
             * (select count(*) from generate_series(0, (select parcelas from n) - 1) as i
                where private.add_months(current_date, i) <= f.day)::bigint
           as balance_cents
    from public._cash_flow_forecast(uid, 370) f
    where f.day <= private.add_months(current_date, (select parcelas from n))
  ),
  pior as (
    select day, balance_cents from simulado order by balance_cents, day limit 1
  )
  select (select balance_cents from pior) >= 0,
         (select day from pior),
         (select balance_cents from pior),
         (select cents from parcela);
$$;
revoke execute on function public._affordability(uuid, bigint, int) from public, anon, authenticated;

create or replace function public.affordability(amount_cents bigint, installments int default 1)
returns table(
  can_afford boolean, worst_day date, worst_balance_cents bigint, installment_cents bigint
)
language sql stable
set search_path = public
as $$
  with n as (select least(greatest(coalesce(installments, 1), 1), 72) as parcelas),
  parcela as (
    select (amount_cents / (select parcelas from n))::bigint as cents
  ),
  simulado as (
    select f.day, f.balance_cents
           - (select cents from parcela)
             * (select count(*) from generate_series(0, (select parcelas from n) - 1) as i
                where private.add_months(current_date, i) <= f.day)::bigint
           as balance_cents
    from public.cash_flow_forecast(370) f
    where f.day <= private.add_months(current_date, (select parcelas from n))
  ),
  pior as (
    select day, balance_cents from simulado order by balance_cents, day limit 1
  )
  select (select balance_cents from pior) >= 0,
         (select day from pior),
         (select balance_cents from pior),
         (select cents from parcela);
$$;

-- `private.add_months` é usada pelos wrappers acima, que rodam como authenticated
grant execute on function private.add_months(date, int) to authenticated, service_role;
grant execute on function private.day_in_month(date, int) to authenticated, service_role;
