-- A prestação de um financiamento sai do caixa todo mês, e a projeção não sabia.
--
-- Um contrato de 48× R$ 1.470 entrava no PATRIMÔNIO (a 0026 já soma
-- `remaining_cents` no passivo) e não entrava em NENHUMA saída futura: "vou
-- ficar no vermelho?" e "posso comprar isso em 10x?" respondiam ignorando
-- R$ 1.470/mês pelos próximos 40 meses. Era o número mais errado do app, e é
-- justamente o que o usuário pergunta antes de gastar.
--
-- A fonte é `private.debt_schedule_for`, que JÁ sabe o calendário de cada
-- contrato (Price no detalhado, parcela fixa no simples). Recalcular aqui criaria
-- a segunda cópia da regra de amortização — o que `finance.md` proíbe, e as duas
-- cópias divergiriam no primeiro contrato com dia de vencimento incomum.
--
-- Não conta duas vezes: a parcela vira `transactions` só quando é PAGA
-- (`pay_debt_installment`), e o cronograma só devolve as que ainda faltam.
--
-- ⚠️ `debt_schedule_for` é CTE recursiva POR DÍVIDA; o `lateral` roda uma vez por
-- contrato ativo. Com dezenas é irrelevante. Se um dia forem milhares, o caminho
-- é materializar parcelas previstas numa tabela, não cachear aqui dentro.

CREATE OR REPLACE FUNCTION public._cash_flow_forecast(uid uuid, days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    union all
    -- (c) prestação de dívida/financiamento em aberto: sai do caixa no vencimento
    select greatest(s.due_date, current_date), 0::bigint, s.payment_cents
    from public.debts d
    cross join lateral private.debt_schedule_for(d.id) s
    where d.workspace_id in (select public._workspace_ids(uid))
      and not d.archived and d.remaining_cents > 0
      and s.due_date <= current_date + (select dias from horizonte)
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
$function$

;

CREATE OR REPLACE FUNCTION public.cash_flow_forecast(days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
    union all
    -- (c) prestação de dívida/financiamento em aberto: sai do caixa no vencimento
    select greatest(s.due_date, current_date), 0::bigint, s.payment_cents
    from public.debts d
    cross join lateral private.debt_schedule_for(d.id) s
    where d.workspace_id in (select private.my_workspace_ids())
      and not d.archived and d.remaining_cents > 0
      and s.due_date <= current_date + (select dias from horizonte)
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
$function$

;


revoke execute on function public._cash_flow_forecast(uuid, int) from public, anon, authenticated;
