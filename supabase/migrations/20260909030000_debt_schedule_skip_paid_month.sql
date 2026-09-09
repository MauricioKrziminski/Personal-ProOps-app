-- A parcela do mês não aparece duas vezes quando já foi paga.
--
-- Regressão da `20260909020000`, aplicada horas antes desta. Até ela, a primeira parcela do
-- cronograma era sempre `add_months(current_date, 1)` — nunca o mês corrente. Ao corrigir o caso
-- "vence dia 15 e hoje é dia 9" (que escondia da projeção a parcela que vence em seis dias), o
-- mês corrente passou a ser possível — e o cálculo olha só para `current_date` e o dia do
-- vencimento, nunca para o que já foi pago.
--
-- Com vencimento no dia 20, hoje 09/09 e a parcela de setembro registrada em 05/09: o trigger
-- `tg_transactions_debt_payment` já incrementou `installments_paid`, então o cronograma começa na
-- parcela SEGUINTE — e a data nela em 20/09. Setembro fica com a parcela paga (uma linha em
-- `transactions`) mais uma do cronograma: o mesmo contrato cobrado duas vezes na projeção de
-- caixa, nas contas a pagar e em qualquer visão de mês.
--
-- A cláusula nova é o único jeito de o cronograma saber disso: pagamento de financiamento só
-- existe como `transactions.debt_id`, e é o mesmo fato que já moveu `installments_paid`. Havendo
-- pagamento registrado dentro do mês corrente, a próxima parcela é a do mês que vem.
create or replace function private.debt_schedule_for(p_debt_id uuid)
returns table (
  installment_no int,
  due_date date,
  payment_cents bigint,
  interest_cents bigint,
  principal_cents bigint,
  balance_cents bigint
)
language sql stable
set search_path = public
as $$
  with recursive d as (
    select id, remaining_cents, interest_rate_monthly, due_day, calculation_mode,
           started_at, installments_paid,
           coalesce(installments, 0) - installments_paid as restantes,
           installment_cents
    from public.debts where id = p_debt_id
  ),
  dia as (
    select coalesce(d.due_day, extract(day from d.started_at)::int) as valor from d
  ),
  -- o contrato já foi cobrado neste mês? o pagamento é a única prova que existe
  pago_no_mes as (
    select exists (
      select 1 from public.transactions t
      where t.debt_id = p_debt_id
        and date_trunc('month', t.occurred_at) = date_trunc('month', current_date)
    ) as sim
  ),
  parametros as (
    select d.remaining_cents, d.interest_rate_monthly as taxa,
           d.installments_paid as pagas,
           (select valor from dia) as venc,
           case
             when (select sim from pago_no_mes)
               then private.day_in_month(private.add_months(current_date, 1), (select valor from dia))
             when private.day_in_month(current_date, (select valor from dia)) >= current_date
               then private.day_in_month(current_date, (select valor from dia))
             else private.day_in_month(private.add_months(current_date, 1), (select valor from dia))
           end as primeiro,
           nullif(d.restantes, 0) as n,
           coalesce(d.installment_cents,
                    private.price_installment(d.remaining_cents, d.interest_rate_monthly,
                                              nullif(d.restantes, 0))) as parcela
    from d
  ),
  amortizacao as (
    select 1 as installment_no,
           (select remaining_cents from parametros) as saldo_inicial,
           (select parcela from parametros) as parcela,
           (select taxa from parametros) as taxa,
           (select n from parametros) as n
    union all
    select a.installment_no + 1,
           a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint - a.parcela,
           a.parcela, a.taxa, a.n
    from amortizacao a
    where a.installment_no < a.n
      and a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint - a.parcela > 0
  )
  -- a numeração é a do CONTRATO: 40 parcelas restantes de 48 são a 9ª à 48ª
  select a.installment_no + coalesce((select pagas from parametros), 0),
         private.day_in_month(
           private.add_months((select primeiro from parametros), a.installment_no - 1),
           (select venc from parametros)
         ) as due_date,
         case when a.installment_no = a.n
              then a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint
              else a.parcela end as payment_cents,
         case when (select calculation_mode from d) = 'fixed_installments' then null::bigint
              else ceil(a.saldo_inicial::numeric * a.taxa)::bigint end as interest_cents,
         case when (select calculation_mode from d) = 'fixed_installments' then null::bigint
              when a.installment_no = a.n
              then a.saldo_inicial
              else a.parcela - ceil(a.saldo_inicial::numeric * a.taxa)::bigint end as principal_cents,
         greatest(
           a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint
           - case when a.installment_no = a.n
                  then a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint
                  else a.parcela end,
           0) as balance_cents
  from amortizacao a
  where (select calculation_mode from d) <> 'fixed_installments'
     or (a.saldo_inicial > 0 and a.n > 0)
  order by a.installment_no;
$$;
