-- A âncora do contrato não passa pelo ramo "pago no ciclo" (revisão final de 23/09/2026).
--
-- A `20260923160000` fez `primeiro = greatest(<cálculo de sempre>, <parcela pagas+1 do contrato>)`.
-- O cálculo de sempre tem um ramo para "já pagou neste ciclo" que manda a próxima para DEPOIS do
-- fim do ciclo. Com âncora isso pulava uma parcela: a 9ª venceu em 05/09 e foi paga em 12/09
-- (ciclo 11/09–10/10), o ramo do ciclo dava 05/11, a âncora dava 05/10 (a 10ª, ainda neste
-- ciclo) e o `greatest` ficava com 05/11 — a parcela de outubro caía no mês errado da projeção
-- e da Hoje, sem erro nenhum.
--
-- Com âncora, quem sabe qual é a próxima é o CONTRATO (pagas + 1); o piso é a próxima ocorrência
-- do dia a partir de hoje, que cobre o atrasado. Sem âncora (`first_due_date` null), nada muda.
--
-- A mesma pergunta errada mora em `private.debt_paid_in_month`, que "O mês inteiro"
-- (`month_lines_for`) e o ciclo/"livre" (`cash_events`) usam para esconder a linha do
-- cronograma de um ciclo que já teve pagamento. Com âncora o cronograma começa em `pagas + 1`
-- (o trigger conta cada pagamento), então nenhuma linha dele é parcela paga — e esconder pelo
-- ciclo apagava a 10ª quando a 9ª foi paga com atraso dentro do mesmo ciclo. Com âncora ela
-- responde `false`; sem âncora continua a mesma.
-- `supabase/tests/financiamento_maleavel.sql`, caso 8, prende o cenário nas três leituras.

create or replace function private.debt_schedule_for(p_debt_id uuid)
returns table (installment_no integer, due_date date, payment_cents bigint,
               interest_cents bigint, principal_cents bigint, balance_cents bigint)
language sql stable
set search_path to 'public'
set "TimeZone" to 'America/Sao_Paulo'
as $function$
  with recursive d as (
    select id, remaining_cents, interest_rate_monthly, due_day, calculation_mode,
           started_at, installments_paid, first_due_date,
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
             -- ⚠️ Com âncora, o calendário é o do CONTRATO: a parcela `pagas + 1`, nunca antes da
             -- próxima ocorrência do dia a partir de hoje (o atrasado continua como sempre). O
             -- ramo "pago no ciclo" NÃO entra aqui: ele empurrava para depois do fim do ciclo a
             -- parcela do contrato que ainda vence dentro dele, quando a anterior era paga com
             -- atraso neste ciclo (revisão final de 23/09/2026).
             when d.first_due_date is not null then greatest(
               case
                 when private.day_in_month(current_date, (select valor from dia)) >= current_date
                   then private.day_in_month(current_date, (select valor from dia))
                 else private.day_in_month(private.add_months(current_date, 1), (select valor from dia))
               end,
               private.day_in_month(private.add_months(d.first_due_date, d.installments_paid),
                                    (select valor from dia)))
             else
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
             end
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
$function$;

create or replace function private.debt_paid_in_month(p_debt_id uuid, p_month date)
returns boolean
language sql
stable
set search_path = public
set "TimeZone" to 'America/Sao_Paulo'
as $$
  -- O nome fala em "month" por compatibilidade com quem já chama; a régua é a do workspace.
  -- Com âncora o cronograma já começa na parcela seguinte à última paga: não há o que esconder.
  select coalesce((select d.first_due_date is null from public.debts d where d.id = p_debt_id), true)
     and private.debt_paid_in_cycle(p_debt_id, p_month);
$$;
