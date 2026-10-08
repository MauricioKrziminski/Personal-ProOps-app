-- O ciclo, o "o que vence" e o detalhe do ciclo enxergam o que dá para gastar
-- (20261010170000): todo ramo de `cash_events` passa pela regra da conta, e a transferência que
-- cruza a borda (aplicar/resgatar, a atrasada e a prevista da regra) vira saída/entrada.
-- Cópia do corpo vivo (20261005190000) com as guardas todas; só os filtros e os ramos 7–9 são novos.
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
    and private.conta_no_disponivel(o.type, o.spendable)
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
    and private.conta_no_disponivel(d.type, d.spendable)
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
  left join public.accounts pg on pg.id = a.payment_account_id
  where ci.workspace_id = any(ws_ids) and ci.status not in ('paid','rolled')
    and private.conta_no_disponivel(pg.type, pg.spendable)
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
    and private.conta_no_disponivel(a.type, a.spendable)
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
    and private.conta_no_disponivel(a.type, a.spendable)
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
    and private.conta_no_disponivel(a.type, a.spendable)
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
  where fim >= current_date
    and private.conta_no_disponivel(a.type, a.spendable)
  union all
  -- 7. TRANSFERÊNCIA QUE CRUZA A BORDA do que dá para gastar (20261010170100): aplicar (de uma
  -- conta de dentro para uma de fora) SAI, resgatar ENTRA. Entre duas contas do mesmo lado ela
  -- se anula e continua sem aparecer. Mesma régua de data, `realizado` e ciclo fechado do ramo 3.
  select case when t.status='cleared' then coalesce(t.paid_at,t.occurred_at)
              else coalesce(t.due_at,t.occurred_at) end,
         case when private.conta_no_disponivel(d.type, d.spendable) then t.amount_cents else 0 end::bigint,
         case when private.conta_no_disponivel(o.type, o.spendable) then t.amount_cents else 0 end::bigint,
         coalesce(nullif(t.description,''), 'Transferência'), 'guardar', t.id,
         case when private.conta_no_disponivel(o.type, o.spendable) then d.name else o.name end,
         (t.status = 'cleared' and coalesce(t.paid_at, t.occurred_at) <= current_date),
         false
  from public.transactions t
  join public.accounts o on o.id = t.account_id and o.type <> 'credit_card'
  join public.accounts d on d.id = t.counterparty_account_id and d.type <> 'credit_card'
  where t.workspace_id = any(ws_ids) and t.kind = 'transfer'
    and private.conta_no_disponivel(o.type, o.spendable) <> private.conta_no_disponivel(d.type, d.spendable)
    and (case when t.status='cleared' then coalesce(t.paid_at,t.occurred_at)
              else coalesce(t.due_at,t.occurred_at) end) between ini and fim
    and (t.status = 'cleared' or fim >= current_date)
  union all
  -- 8. A mesma transferência pendente e ATRASADA, clampada para hoje (o espelho do ramo 4).
  select current_date,
         case when private.conta_no_disponivel(d.type, d.spendable) then t.amount_cents else 0 end::bigint,
         case when private.conta_no_disponivel(o.type, o.spendable) then t.amount_cents else 0 end::bigint,
         coalesce(nullif(t.description,''), 'Transferência') || ' (atrasada)', 'guardar', t.id,
         case when private.conta_no_disponivel(o.type, o.spendable) then d.name else o.name end,
         false, true
  from public.transactions t
  join public.accounts o on o.id = t.account_id and o.type <> 'credit_card'
  join public.accounts d on d.id = t.counterparty_account_id and d.type <> 'credit_card'
  where t.workspace_id = any(ws_ids) and t.status = 'pending' and t.kind = 'transfer'
    and private.conta_no_disponivel(o.type, o.spendable) <> private.conta_no_disponivel(d.type, d.spendable)
    and coalesce(t.due_at,t.occurred_at) < ini and current_date between ini and fim
  union all
  -- 9. A transferência recorrente prevista da REGRA que cruza a borda (o aporte mensal): o
  -- espelho do ramo 6 para as séries de transferência (20261005160000).
  select p.due_date,
         case when private.conta_no_disponivel(d.type, d.spendable) then p.amount_cents else 0 end::bigint,
         case when private.conta_no_disponivel(o.type, o.spendable) then p.amount_cents else 0 end::bigint,
         p.description, 'guardar_previsto', p.recurring_id,
         case when private.conta_no_disponivel(o.type, o.spendable) then d.name else o.name end,
         false, false
  from private.recurring_projection_all_for(ws_ids, ini, fim) p
  join public.recurring_transactions r on r.id = p.recurring_id
  join public.accounts o on o.id = p.account_id and o.type <> 'credit_card'
  join public.accounts d on d.id = r.counterparty_account_id and d.type <> 'credit_card'
  where p.kind = 'transfer' and fim >= current_date
    and private.conta_no_disponivel(o.type, o.spendable) <> private.conta_no_disponivel(d.type, d.spendable);
$function$;
