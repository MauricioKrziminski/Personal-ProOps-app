-- Financiamento com âncora: a parcela vencida e não paga fica na data do contrato (atrasada) em vez
-- de deslizar para o próximo mês e atrasar todas as seguintes. Definições copiadas das últimas
-- (20260927230010 e 20260928230000), só a regra trocada. Sem âncora nada muda.

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
             -- ⚠️ Com âncora, o calendário é o do CONTRATO, sem piso de hoje (05/10/2026): a parcela
             -- `pagas + 1` fica na data dela mesmo vencida — é parcela ATRASADA, não uma que
             -- desliza para o mês seguinte e arrasta as demais. Quem projeta caixa clampa para
             -- hoje (`eventos_de_caixa`); quem lista mostra a data e marca o atraso. O ramo
             -- "pago no ciclo" NÃO entra aqui (revisão final de 23/09/2026).
             when d.first_due_date is not null then
               private.day_in_month(private.add_months(d.first_due_date, d.installments_paid),
                                    (select valor from dia))
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
         coalesce(e.due_date, private.day_in_month(
           private.add_months((select primeiro from parametros), a.installment_no - 1),
           (select venc from parametros)
         )) as due_date,
         coalesce(e.amount_cents, case when a.installment_no = a.n
              then a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint
              else a.parcela end) as payment_cents,
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
  left join public.debt_installment_edits e on e.debt_id=p_debt_id
    and e.installment_no=a.installment_no + coalesce((select pagas from parametros),0)
  where (select calculation_mode from d) <> 'fixed_installments'
     or (a.saldo_inicial > 0 and a.n > 0)
  order by a.installment_no;
$function$;


CREATE OR REPLACE FUNCTION private.cash_events(ws_ids uuid[], ini date, fim date)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, title text, origin text, ref_id uuid, method_label text, realizado boolean, atrasada boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  -- 1. PAGAMENTO REALIZADO de fatura: o transfer para uma conta de cartão.
  select case when t.status = 'cleared' then coalesce(t.paid_at, t.occurred_at) else t.occurred_at end,
         0::bigint, t.amount_cents,
         coalesce(nullif(t.description,''), 'Pagamento de fatura'), 'invoice_payment', t.id,
         coalesce(d.name, 'Cartão'),
         -- ⚠️ `<= current_date` JUNTO com `cleared`: uma linha quitada com `paid_at` FUTURO não
         -- está em `cash_total(hoje)` (que filtra `paid_at <= as_of`), então ela ainda é
         -- compromisso. Sem esta metade, o dinheiro sumiria dos dois lados.
         (t.status = 'cleared' and coalesce(t.paid_at, t.occurred_at) <= current_date),
         false
  from public.transactions t
  join public.accounts d on d.id = t.counterparty_account_id and d.type = 'credit_card'
  left join public.accounts o on o.id = t.account_id
  where t.workspace_id = any(ws_ids) and t.kind = 'transfer'
    and coalesce(o.type, 'x') <> 'credit_card'
    and (case when t.status='cleared' then coalesce(t.paid_at,t.occurred_at) else t.occurred_at end)
        between ini and fim
    -- Janela que já FECHOU só conta o que aconteceu (25/09/2026): pendente ali não saiu do caixa.
    and (t.status = 'cleared' or fim >= current_date)
  union all
  -- 1b. PIX NO CRÉDITO para conta própria (28/09/2026): o transfer que SAI do cartão para uma
  -- conta. O dinheiro ENTRA na conta no dia; a saída é a fatura, no vencimento (ramo 2, que
  -- soma o transfer pelo `conta_na_fatura`). Sem este ramo o ciclo mostraria só a cobrança, e
  -- "comecei + entrou − saiu" deixaria de chegar ao "sobrou na conta" (o `cash_total` já conta
  -- a entrada).
  select case when t.status = 'cleared' then coalesce(t.paid_at, t.occurred_at) else t.occurred_at end,
         t.amount_cents, 0::bigint,
         coalesce(nullif(t.description,''), 'Pix no crédito'), 'transaction', t.id,
         coalesce(d.name, 'Conta'),
         (t.status = 'cleared' and coalesce(t.paid_at, t.occurred_at) <= current_date),
         false
  from public.transactions t
  join public.accounts o on o.id = t.account_id and o.type = 'credit_card'
  join public.accounts d on d.id = t.counterparty_account_id and d.type <> 'credit_card'
  where t.workspace_id = any(ws_ids) and t.kind = 'transfer'
    and (case when t.status='cleared' then coalesce(t.paid_at,t.occurred_at) else t.occurred_at end)
        between ini and fim
    and (t.status = 'cleared' or fim >= current_date)
  union all
  -- 2. O que AINDA falta pagar de uma fatura: nunca passou pelo caixa.
  select greatest(ci.due_date, current_date), 0::bigint, private.invoice_open_cents(ci.id),
         'Fatura ' || coalesce(a.name,'cartão') ||
           case when ci.due_date < current_date then ' (atrasada)' else '' end,
         'invoice', ci.id, coalesce(a.name,'Cartão'), false,
         ci.due_date < current_date
  from public.card_invoices ci join public.accounts a on a.id = ci.account_id
  where ci.workspace_id = any(ws_ids) and ci.status not in ('paid','rolled')
    and greatest(ci.due_date, current_date) between ini and fim
    and private.invoice_open_cents(ci.id) > 0
  union all
  -- 3. Lançamento fora de cartão.
  select case when t.status='cleared' then coalesce(t.paid_at,t.occurred_at)
              else coalesce(t.due_at,t.occurred_at) end,
         case when t.kind='income' then t.amount_cents else 0 end::bigint,
         case when t.kind='expense' then t.amount_cents else 0 end::bigint,
         coalesce(nullif(t.description,''), nullif(t.merchant,''), t.category, 'Lançamento'),
         'transaction', t.id, coalesce(a.name,'Sem conta'),
         (t.status = 'cleared' and coalesce(t.paid_at, t.occurred_at) <= current_date),
         false
  from public.transactions t left join public.accounts a on a.id = t.account_id
  where t.workspace_id = any(ws_ids) and t.kind <> 'transfer'
    and t.invoice_id is null and t.rollover_of_invoice_id is null
    and (case when t.status='cleared' then coalesce(t.paid_at,t.occurred_at)
              else coalesce(t.due_at,t.occurred_at) end) between ini and fim
    -- O mesmo: a conta que ficou sem pagar num ciclo fechado aparece no ciclo ATUAL como
    -- "(atrasado)" (ramo 4) e no "faltou pagar" do ciclo fechado — nunca como saída dele.
    and (t.status = 'cleared' or fim >= current_date)
  union all
  -- 4. Atrasado, clampado para hoje. `pending` por definição: não saiu do caixa.
  select current_date,
         case when t.kind='income' then t.amount_cents else 0 end::bigint,
         case when t.kind='expense' then t.amount_cents else 0 end::bigint,
         coalesce(nullif(t.description,''), nullif(t.merchant,''), t.category, 'Lançamento') || ' (atrasado)',
         'transaction_overdue', t.id, coalesce(a.name,'Sem conta'), false,
         true
  from public.transactions t left join public.accounts a on a.id = t.account_id
  where t.workspace_id = any(ws_ids) and t.status='pending'
    and t.kind <> 'transfer' and t.invoice_id is null and t.rollover_of_invoice_id is null
    and coalesce(t.due_at,t.occurred_at) < ini and current_date between ini and fim
    and (t.kind <> 'income' or coalesce(t.due_at,t.occurred_at) >= current_date - 3)
  union all
  -- 5. Cronograma de dívida: sai do CONTRATO, não de `transactions`. Nunca realizado.
  -- Parcela do contrato já vencida e não paga (05/10/2026) entra clampada para hoje, como a fatura
  -- atrasada: só na janela que contém hoje, nunca como saída de um ciclo fechado.
  select greatest(s.due_date, current_date), 0::bigint, s.payment_cents,
         coalesce(d.payment_description, 'Parcela ' || d.name) ||
           case when s.due_date < current_date then ' (atrasada)' else '' end,
         'debt_schedule', d.id,
         coalesce(a.name,'Financiamento'), false, s.due_date < current_date
  from public.debts d cross join lateral private.debt_schedule_for(d.id) s
  left join public.accounts a on a.id = d.account_id
  where d.workspace_id = any(ws_ids) and not d.archived and d.remaining_cents > 0
    and greatest(s.due_date, current_date) between ini and fim
    and not private.debt_paid_in_month(d.id, s.due_date)
  union all
  -- 6. Recorrente projetada da REGRA: linha que ainda não existe. Nunca realizada.
  select p.due_date,
         case when p.kind='income' then p.amount_cents else 0 end::bigint,
         case when p.kind='expense' then p.amount_cents else 0 end::bigint,
         p.description, 'recurring_projection', p.recurring_id, coalesce(a.name,'Sem conta'), false,
         false
  from private.recurring_projection_for(ws_ids, ini, fim) p
  left join public.accounts a on a.id = p.account_id
  -- A REGRA projetada também não inventa movimento num período que já passou: série que o cron
  -- ainda não materializou (no staging ele não roda) punha ocorrência fantasma no ciclo fechado.
  where fim >= current_date;
$function$;

