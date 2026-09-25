-- Ciclo FECHADO conta só o que aconteceu (25/09/2026).
--
-- `supabase/tests/linha_do_tempo.sql` falhava no staging: no ciclo 11/08–10/09 os eventos somavam
-- R$ 46.890,70 e o caixa real era R$ 48.905,00. A diferença era o aluguel (R$ 1.800,00) e a
-- energia (R$ 214,30) PENDENTES, datados dentro do ciclo: `cash_events` os contava como saída do
-- ciclo fechado — dinheiro que não saiu — e o ramo 4 já os traz para o ciclo atual como
-- "(atrasado)". Na tela, "comecei + entrou − saiu" não chegava ao "sobrou na conta".
--
-- O desenho que a tela já declarava (`cycle.tsx`, `Fechamento`): a dívida é linha à parte,
-- "Faltou pagar", fora da soma. Então:
--   1. em janela que já fechou (`fim < hoje`), `cash_events` ignora lançamento não quitado
--      (ramos 1 e 3) e a recorrente projetada da regra (ramo 6); o ciclo aberto e os previstos
--      não mudam;
--   2. o "faltou pagar" soma também a conta pendente fora de cartão, vencida até o fim do ciclo,
--      como já somava a fatura em aberto.
-- `cycle_lines` e `spendable_events_for` leem `cash_events`: a lista de um ciclo fechado deixa
-- de mostrar como paga a conta que não foi paga; o ciclo atual (o "livre") é o mesmo de antes.
-- Teste: `supabase/tests/ciclo_fechado.sql` (independe do dado do banco) e `linha_do_tempo.sql`.
-- Assinaturas iguais: `create or replace` mantém dono e grants, e o cabeçalho (fuso,
-- search_path) vai repetido — o que não for repetido é apagado.

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
  select s.due_date, 0::bigint, s.payment_cents, 'Parcela ' || d.name, 'debt_schedule', d.id,
         coalesce(a.name,'Financiamento'), false, false
  from public.debts d cross join lateral private.debt_schedule_for(d.id) s
  left join public.accounts a on a.id = d.account_id
  where d.workspace_id = any(ws_ids) and not d.archived and d.remaining_cents > 0
    and s.due_date between ini and fim and not private.debt_paid_in_month(d.id, s.due_date)
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

CREATE OR REPLACE FUNCTION private.cycle_series_for(ws_ids uuid[], de date, ate date, p_view text DEFAULT NULL::text)
 RETURNS TABLE(mes date, ini date, fim date, estado text, comecei_com bigint, entrou bigint, saiu bigint, resultado bigint, caixa_no_fim bigint, faltou_pagar bigint, confere boolean, entrou_realizado bigint, saiu_realizado bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with recursive limites as (
    select private.cycle_close_day(ws_ids, p_view) dia,
           least(de, private.cycle_month_of(private.cycle_close_day(ws_ids, p_view), current_date)) inicio
  ),
  meses as (select generate_series((select inicio from limites), ate, interval '1 month')::date m),
  janela as (
    select m.m, c.ini, c.fim, row_number() over (order by c.ini) rn
    from meses m cross join lateral private.cycle_bounds((select dia from limites), m.m) c
  ),
  fluxo as (
    select j.m, j.ini, j.fim, j.rn,
           coalesce(sum(x.in_cents),0)::bigint entrou, coalesce(sum(x.out_cents),0)::bigint saiu,
           -- O MESMO `sum`, com o filtro de `cash_events`. Nenhuma segunda definição de "já
           -- aconteceu": `realizado` é `cleared` E `paid_at <= hoje`, escrito lá.
           coalesce(sum(x.in_cents)  filter (where x.realizado),0)::bigint entrou_realizado,
           coalesce(sum(x.out_cents) filter (where x.realizado),0)::bigint saiu_realizado,
           private.cash_total(ws_ids, j.ini - 1) caixa_antes,
           private.cash_total(ws_ids, j.fim) caixa_depois,
           coalesce((select sum(private.invoice_open_cents(ci.id)) from public.card_invoices ci
                     -- ⚠️ ADIADA conta como "faltou pagar". `rolled` significa que o dinheiro
                     -- NÃO saiu: o principal foi empurrado para a fatura seguinte, com juros.
                     -- Excluindo ela, um ciclo que terminou sem conseguir pagar a fatura passava
                     -- a anunciar "Sobrou em setembro R$ 0,72" no instante do adiamento — e foi
                     -- exatamente essa a queixa (13/09/2026). Só `paid` é pago.
                     where ci.workspace_id = any(ws_ids) and ci.status <> 'paid'
                       and ci.due_date <= j.fim), 0)::bigint
           -- ⚠️ E a conta PENDENTE fora de cartão (25/09/2026): o aluguel que venceu no ciclo e
           -- não foi pago também "faltou pagar". Ele saiu de `cash_events` no ciclo fechado —
           -- contado lá, o ciclo anunciava uma saída que não houve e a conta da tela
           -- (comecei + entrou − saiu) não chegava ao "sobrou na conta".
           + coalesce((select sum(t.amount_cents) from public.transactions t
                       where t.workspace_id = any(ws_ids) and t.status = 'pending'
                         and t.kind = 'expense' and t.invoice_id is null
                         and t.rollover_of_invoice_id is null
                         and coalesce(t.due_at, t.occurred_at) <= j.fim), 0)::bigint em_aberto
    from janela j left join lateral private.cash_events(ws_ids, j.ini, j.fim) x on true
    group by j.m, j.ini, j.fim, j.rn
  ),
  corrente as (
    select f.*, f.caixa_antes comecei, (f.caixa_antes + f.entrou - f.saiu)::bigint resultado
    from fluxo f where f.rn = 1
    union all
    select f.*,
           case when f.ini <= current_date then f.caixa_antes else c.resultado end,
           (case when f.ini <= current_date then f.caixa_antes else c.resultado end
            + f.entrou - f.saiu)::bigint
    from fluxo f join corrente c on f.rn = c.rn + 1
  )
  select c.m, c.ini, c.fim,
         case when c.fim < current_date then 'fechado'
              when c.ini > current_date then 'previsto' else 'aberto' end,
         c.comecei, c.entrou, c.saiu, c.resultado,
         case when c.fim < current_date then c.caixa_depois end,
         case when c.fim < current_date then c.em_aberto end,
         -- A invariante: num ciclo FECHADO, a soma dos eventos tem que reproduzir o caixa real.
         -- Se der falso, um movimento de dinheiro está sendo contado duas vezes ou nenhuma.
         case when c.fim < current_date then c.caixa_depois = c.resultado end,
         c.entrou_realizado, c.saiu_realizado
  from corrente c where c.m >= de order by c.ini;
$function$;
