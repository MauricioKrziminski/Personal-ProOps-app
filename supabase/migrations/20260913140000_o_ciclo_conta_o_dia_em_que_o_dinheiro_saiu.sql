-- Três defeitos de dinheiro na linha do tempo, os três mudos. Achados em revisão, confirmados
-- contra os dados reais no staging antes de escrever uma linha de correção.
--
-- ## 1. Fatura paga datava pelo VENCIMENTO, não pelo dia em que o dinheiro saiu
--
-- A `20260913130000` corrigiu isso para transação (`paid_at` em vez de `due_at`) e esqueceu a
-- fatura. Com `cycle_close_day = 10` e as duas faturas vencendo dia 10, **todo pagamento em
-- atraso cruza a borda do ciclo** — e existem três assim nos dados reais (vencidas em 10/07 e
-- 10/08, pagas em 08/09).
--
-- Fatura vence 10/09 e é paga 15/09: o ciclo de setembro debita o total em 10/09 (certo, vira
-- `faltou_pagar`); o de outubro **não debita nada** — `comecei_com` ainda tem o dinheiro, o ramo
-- da fatura não pega (vencimento fora da janela), o do atraso não pega (já está `paid`), e o da
-- transação não pega (o pagamento é `transfer`). O dinheiro sai da conta e não aparece em ciclo
-- nenhum. Pagamento ADIANTADO é o espelho: o caixa já desconta num ciclo e a fatura debita de
-- novo no outro.
--
-- Isso ia morder em dias: os R$ 371,64 em aberto vencem no ciclo de setembro e serão pagos no de
-- outubro — no instante do pagamento o número de outubro melhoraria sozinho R$ 371,64.
--
-- ## 2. Série que começa no futuro partia do caixa de HOJE
--
-- O termo base do recursivo usava `cash_total(ini - 1)` sem o `case` que o termo recursivo tem, e
-- `cash_total` numa data futura devolve o caixa de hoje (nada `cleared` além de hoje). Como a
-- tela pede a série a partir do mês NAVEGADO, um toque para frente já caía nisso. Medido:
-- janeiro/2027 abria com `comecei 0,72` em vez de `966,96` — **R$ 966,24 de erro na interação
-- padrão**. A série agora sempre parte do ciclo corrente e só ENTREGA a partir de `de`.
--
-- ## 3. Despesa pendente vencida antes da janela sumia
--
-- A `130000` clampou a FATURA vencida para hoje e não a transação. Conta vencida em 05/09 e
-- ainda pendente ficava no ciclo de setembro (fechado) e **desaparecia do ciclo aberto e de todo
-- futuro**. O dinheiro ainda vai sair.
--
-- ⚠️ A janela de 3 dias para RECEITA é parte da correção, não um extra: sem ela o clamp
-- ressuscitaria toda receita atrasada em vez de despesa, que é exatamente o anti-padrão que a
-- `20260909200000` removeu.
--
-- ## E `security definer` saiu das duas
--
-- Todo irmão `private.*_for` é invoker (`month_lines_for`, `cash_total`, `recurring_projection_for`,
-- `debt_schedule_for`). Como definer, o escopo passava a depender SÓ do `ws_ids` que chega por
-- argumento e a RLS deixava de ser a segunda tranca. Os `grant ... to authenticated` continuam
-- necessários pelo mesmo motivo de sempre.

create or replace function private.cash_events(ws_ids uuid[], ini date, fim date)
returns table (day date, in_cents bigint, out_cents bigint, title text,
               origin text, ref_id uuid, method_label text)
language sql stable security invoker set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  -- fatura: no dia em que o dinheiro SAIU se ela já foi paga, no vencimento se ainda não.
  select case when ci.status = 'paid' then coalesce(ci.paid_at, ci.due_date) else ci.due_date end,
         0::bigint, coalesce(sum(t.amount_cents), 0)::bigint,
         'Fatura ' || coalesce(a.name, 'cartão'), 'invoice', ci.id, coalesce(a.name, 'Cartão')
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
  where ci.workspace_id = any(ws_ids)
    and ci.status <> 'rolled'          -- adiada: o principal foi para a fatura seguinte
    and (case when ci.status = 'paid' then coalesce(ci.paid_at, ci.due_date) else ci.due_date end)
        between ini and fim
  group by ci.id, ci.due_date, ci.status, ci.paid_at, a.name

  union all

  -- fatura que venceu ANTES desta janela e continua aberta: ela ainda vai sair, e sai hoje.
  -- `greatest(due, hoje)` se auto-seleciona — em ciclo passado cai fora da janela, em ciclo
  -- futuro hoje é anterior ao início. Só o ABERTO entra: o que já foi pago está no caixa.
  select greatest(ci.due_date, current_date), 0::bigint, private.invoice_open_cents(ci.id),
         'Fatura ' || coalesce(a.name, 'cartão') || ' (atrasada)', 'invoice_overdue', ci.id,
         coalesce(a.name, 'Cartão')
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  where ci.workspace_id = any(ws_ids) and ci.status not in ('paid', 'rolled')
    and ci.due_date < ini
    and greatest(ci.due_date, current_date) between ini and fim
    and private.invoice_open_cents(ci.id) > 0

  union all

  -- dinheiro de conta, fora do cartão. Quem já aconteceu data pelo dia em que saiu.
  select case when t.status = 'cleared' then coalesce(t.paid_at, t.occurred_at)
              else coalesce(t.due_at, t.occurred_at) end,
         case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
         case when t.kind = 'expense' then t.amount_cents else 0 end::bigint,
         coalesce(nullif(t.description, ''), nullif(t.merchant, ''), t.category, 'Lançamento'),
         'transaction', t.id, coalesce(a.name, 'Sem conta')
  from public.transactions t
  left join public.accounts a on a.id = t.account_id
  where t.workspace_id = any(ws_ids)
    and t.kind <> 'transfer' and t.invoice_id is null and t.rollover_of_invoice_id is null
    and (case when t.status = 'cleared' then coalesce(t.paid_at, t.occurred_at)
              else coalesce(t.due_at, t.occurred_at) end) between ini and fim

  union all

  -- pendente que venceu antes desta janela: ainda vai sair, e sai hoje. Mesma regra da fatura
  -- atrasada logo acima — a assimetria entre as duas era o defeito 3.
  select current_date,
         case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
         case when t.kind = 'expense' then t.amount_cents else 0 end::bigint,
         coalesce(nullif(t.description, ''), nullif(t.merchant, ''), t.category, 'Lançamento')
           || ' (atrasado)',
         'transaction_overdue', t.id, coalesce(a.name, 'Sem conta')
  from public.transactions t
  left join public.accounts a on a.id = t.account_id
  where t.workspace_id = any(ws_ids) and t.status = 'pending'
    and t.kind <> 'transfer' and t.invoice_id is null and t.rollover_of_invoice_id is null
    and coalesce(t.due_at, t.occurred_at) < ini
    and current_date between ini and fim
    -- receita atrasada sai da conta depois de 3 dias (`20260909200000`); sem esta linha o clamp
    -- reassumiria todo dia que ela vai cair, que é o anti-padrão que aquela migration removeu.
    and (t.kind <> 'income' or coalesce(t.due_at, t.occurred_at) >= current_date - 3)

  union all

  -- parcela de financiamento: sai do CRONOGRAMA, não de `transactions`
  select s.due_date, 0::bigint, s.payment_cents, 'Parcela ' || d.name, 'debt_schedule', d.id,
         coalesce(a.name, 'Financiamento')
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  left join public.accounts a on a.id = d.account_id
  where d.workspace_id = any(ws_ids) and not d.archived and d.remaining_cents > 0
    and s.due_date between ini and fim and not private.debt_paid_in_month(d.id, s.due_date)

  union all

  -- recorrente além do horizonte materializado
  select p.due_date,
         case when p.kind = 'income'  then p.amount_cents else 0 end::bigint,
         case when p.kind = 'expense' then p.amount_cents else 0 end::bigint,
         p.description, 'recurring_projection', p.recurring_id, coalesce(a.name, 'Sem conta')
  from private.recurring_projection_for(ws_ids, ini, fim) p
  left join public.accounts a on a.id = p.account_id;
$$;

create or replace function private.cycle_series_for(ws_ids uuid[], de date, ate date, p_view text default null)
returns table (mes date, ini date, fim date, estado text, comecei_com bigint,
               entrou bigint, saiu bigint, resultado bigint,
               caixa_no_fim bigint, faltou_pagar bigint)
language sql stable security invoker set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  -- ⚠️ A série SEMPRE parte do ciclo corrente, mesmo quando a tela pede um mês futuro — senão o
  -- encadeamento começa num caixa que ignora tudo que vence entre hoje e `de` (defeito 2).
  -- O `where c.m >= de` no fim é quem devolve só o que foi pedido.
  with recursive limites as (
    select private.cycle_close_day(ws_ids, p_view) as dia,
           least(de, private.cycle_month_of(private.cycle_close_day(ws_ids, p_view), current_date)) as inicio
  ),
  meses as (
    select generate_series((select inicio from limites), ate, interval '1 month')::date m
  ),
  janela as (
    select m.m, c.ini, c.fim, row_number() over (order by c.ini) rn
    from meses m cross join lateral private.cycle_bounds((select dia from limites), m.m) c
  ),
  -- `cash_total` uma vez por linha, não quatro: ela é subconsulta correlacionada por conta, e a
  -- série tem doze linhas.
  fluxo as (
    select j.m, j.ini, j.fim, j.rn,
           coalesce(sum(x.in_cents), 0)::bigint entrou, coalesce(sum(x.out_cents), 0)::bigint saiu,
           private.cash_total(ws_ids, j.ini - 1) caixa_antes,
           private.cash_total(ws_ids, j.fim) caixa_depois
    from janela j left join lateral private.cash_events(ws_ids, j.ini, j.fim) x on true
    group by j.m, j.ini, j.fim, j.rn
  ),
  corrente as (
    select f.*, f.caixa_antes as comecei, (f.caixa_antes + f.entrou - f.saiu)::bigint as resultado
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
         case when c.fim < current_date then (c.caixa_depois - c.resultado)::bigint end
  from corrente c where c.m >= de order by c.ini;
$$;

revoke execute on function private.cash_events(uuid[], date, date) from public, anon;
revoke execute on function private.cycle_series_for(uuid[], date, date, text) from public, anon;
grant execute on function private.cash_events(uuid[], date, date) to authenticated, service_role;
grant execute on function private.cycle_series_for(uuid[], date, date, text) to authenticated, service_role;

-- O ramo do dinheiro de conta filtra por uma EXPRESSÃO, então `transactions_ws_occurred_idx` não
-- serve, e `cash_events` roda uma vez por mês da série (doze varreduras por montagem de tela).
create index if not exists transactions_ws_caixa_idx on public.transactions
  (workspace_id, (case when status = 'cleared' then coalesce(paid_at, occurred_at)
                       else coalesce(due_at, occurred_at) end));
