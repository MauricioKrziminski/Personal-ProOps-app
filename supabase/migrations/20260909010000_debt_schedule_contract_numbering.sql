-- A parcela tem o número do CONTRATO, não da posição na lista do que sobrou.
--
-- `debt_schedule_for` devolve só as parcelas que faltam e as numerava de 1 em diante:
-- num financiamento de 48x com 8 pagas, a tabela mostrava "1 a 40" e a próxima parcela
-- — que é a 9ª — aparecia como "parcela 1". Além de errado, era o que fazia o
-- financiamento parecer ter nascido com 40 parcelas em vez das 48 contratadas.
--
-- O deslocamento entra só no SELECT final: a recursão continua contando de 1 porque é
-- ela que decide quando parar (`installment_no < n`).
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
           installments_paid,
           coalesce(installments, 0) - installments_paid as restantes,
           installment_cents
    from public.debts where id = p_debt_id
  ),
  parametros as (
    select d.remaining_cents, d.interest_rate_monthly as taxa, d.due_day,
           d.installments_paid as pagas,
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
  select a.installment_no + coalesce((select pagas from parametros), 0),
         private.day_in_month(
           private.add_months(current_date, a.installment_no),
           coalesce((select due_day from parametros), extract(day from current_date)::int)
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

