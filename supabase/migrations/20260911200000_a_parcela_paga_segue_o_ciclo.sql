-- "Já paguei esta parcela?" passa a ser perguntado na régua do CICLO, não no mês civil.
--
-- ⚠️ **Sem isso a parcela do financiamento conta DUAS VEZES — e só para quem configurou ciclo.**
--
-- Eram duas cópias do mesmo teste, as duas civis: `private.debt_paid_in_month` (que
-- `month_lines_for` usa para suprimir a linha projetada) e o CTE `pago_no_mes` dentro de
-- `private.debt_schedule_for` (que decide onde o cronograma começa). As leituras do mês migraram
-- para o ciclo na `20260911021000`/`20260911170000`; estas duas ficaram para trás — exatamente o
-- que já tinha acontecido com `budgets_status_for`.
--
-- O cenário, com `cycle_close_day = 10`, dívida de R$ 1.485,00 e `due_day = 5`. O ciclo rotulado
-- "outubro" vai de 11/09 a 10/10, e o usuário paga a parcela em 28/09:
--
--   1. `pay_debt_installment` grava a transação em 28/09 → dentro do ciclo → conta como despesa.
--   2. `debt_schedule_for` vê pagamento no mês civil de SETEMBRO, então joga a próxima linha
--      agendada para 05/10 — que ainda está DENTRO do mesmo ciclo.
--   3. `month_lines_for` pergunta `debt_paid_in_month(id, '2026-10-05')` → mês civil de OUTUBRO →
--      não acha o pagamento de 28/09 → não suprime a linha projetada.
--
-- Resultado: R$ 1.485,00 somados duas vezes em "Entradas e saídas", em `month_summary`
-- (`parcelas_cents` e `result_cents`) e em `monthly_cashflow` — o mesmo gráfico onde esta MESMA
-- parcela já produziu o erro de R$ 1.485,00 que a `20260911010000` corrigiu.
--
-- E vaza além do mês: entre 01/10 e 05/10 o cronograma continua emitindo a linha de 05/10, e
-- `_upcoming_bills` (a Hoje) e `_cash_flow_forecast` (a Projeção) consomem `debt_schedule_for`
-- SEM passar por `debt_paid_in_month`. Ali aparece uma saída fantasma de R$ 1.485,00.
--
-- ⚠️ **Por isso a correção desce um nível.** Consertar só `month_lines_for` deixaria a Hoje e a
-- Projeção erradas; quem tem que saber do ciclo é o cronograma, e aí o mês herda de graça.
--
-- ⚠️ **Em modo civil NADA muda, e isso é garantido pela aritmética, não por cuidado:**
-- `private.cycle_bounds(null, m)` É `date_trunc('month', m)` — as duas metades do `case` dela
-- colapsam no mês civil quando `close_day` é null. `supabase/tests/parcela_paga_no_ciclo.sql`
-- prende as duas réguas.

-- --------------------------------------------------------------------------
-- uma função só responde "já paguei este contrato no período que vale para este dia?"
-- --------------------------------------------------------------------------
create or replace function private.debt_paid_in_cycle(p_debt_id uuid, p_day date)
returns boolean
language sql
stable
set search_path = public
set "TimeZone" to 'America/Sao_Paulo'
as $$
  with regua as (
    select private.cycle_close_day(array[d.workspace_id]) as dia
    from public.debts d where d.id = p_debt_id
  ),
  janela as (
    select b.ini, b.fim
    from regua r,
         lateral private.cycle_bounds(r.dia, private.cycle_month_of(r.dia, p_day)) b
  )
  select exists (
    select 1
    from public.transactions t, janela j
    where t.debt_id = p_debt_id
      and t.occurred_at >= j.ini
      and t.occurred_at <= j.fim
  );
$$;

revoke execute on function private.debt_paid_in_cycle(uuid, date) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- a versão antiga vira casca: `month_lines_for` continua chamando pelo nome que já usa
-- --------------------------------------------------------------------------
create or replace function private.debt_paid_in_month(p_debt_id uuid, p_month date)
returns boolean
language sql
stable
set search_path = public
set "TimeZone" to 'America/Sao_Paulo'
as $$
  -- O nome fala em "month" por compatibilidade com quem já chama; a régua é a do workspace.
  select private.debt_paid_in_cycle(p_debt_id, p_month);
$$;

-- --------------------------------------------------------------------------
-- o cronograma começa DEPOIS do ciclo que já foi pago
-- --------------------------------------------------------------------------
create or replace function private.debt_schedule_for(p_debt_id uuid)
returns table(installment_no integer, due_date date, payment_cents bigint,
              interest_cents bigint, principal_cents bigint, balance_cents bigint)
language sql
stable
set search_path = public
set "TimeZone" to 'America/Sao_Paulo'
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
  -- o contrato já foi cobrado NESTE CICLO? o pagamento é a única prova que existe
  pago as (
    select private.debt_paid_in_cycle(p_debt_id, current_date) as sim
  ),
  -- o fim do ciclo corrente, para saber o que é "depois dele"
  ciclo as (
    select b.fim
    from d,
         lateral (select private.cycle_close_day(array[d_ws.workspace_id]) as cd
                  from public.debts d_ws where d_ws.id = p_debt_id) r,
         lateral private.cycle_bounds(r.cd, private.cycle_month_of(r.cd, current_date)) b
  ),
  parametros as (
    select d.remaining_cents, d.interest_rate_monthly as taxa,
           d.installments_paid as pagas,
           (select valor from dia) as venc,
           case
             -- ⚠️ Pago no ciclo: a próxima é a primeira ocorrência do dia de vencimento
             -- ESTRITAMENTE depois do fim do ciclo. Somar um mês ao HOJE não bastava — com
             -- fechamento no dia 10 e vencimento no dia 5, "mês que vem" cai em 05/10, que
             -- ainda está dentro do ciclo 11/09–10/10 que acabou de ser pago.
             when (select sim from pago)
               then case
                      when private.day_in_month((select fim from ciclo) + 1, (select valor from dia))
                           > (select fim from ciclo)
                        then private.day_in_month((select fim from ciclo) + 1, (select valor from dia))
                      else private.day_in_month(
                             private.add_months((select fim from ciclo) + 1, 1),
                             (select valor from dia))
                    end
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
