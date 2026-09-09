-- A data do cronograma para de andar sozinha — e para de pular um mês.
--
-- Duas coisas erradas na MESMA expressão, as duas visíveis como "quando vence a próxima":
--
-- 1. **Sem `due_day`, o dia saía de `current_date`.** A parcela do financiamento do carro
--    vencia "dia 8" ontem e "dia 9" hoje, e com ela andavam a projeção de caixa, as contas
--    a pagar e as datas estimadas do histórico. Cronograma que muda de resposta porque o
--    relógio virou não é cronograma. A âncora agora é `started_at` (`not null`, default
--    `current_date`): a data em que o contrato começou, que não se move. Quem informou o
--    dia de vencimento continua mandando nele — o `coalesce` não mudou de ordem.
--
-- 2. **A primeira parcela era SEMPRE no mês que vem** (`add_months(current_date, 1)`).
--    Com vencimento no dia 15 e hoje dia 9, a parcela que vence daqui a seis dias sumia da
--    projeção e o app anunciava a de outubro. Agora a primeira é a próxima ocorrência do
--    dia de vencimento **a partir de hoje, inclusive** — vence hoje ainda é uma conta a
--    pagar, não uma conta paga.
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
  parametros as (
    select d.remaining_cents, d.interest_rate_monthly as taxa,
           d.installments_paid as pagas,
           (select valor from dia) as venc,
           -- a próxima ocorrência do dia de vencimento, hoje incluso
           case when private.day_in_month(current_date, (select valor from dia)) >= current_date
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
