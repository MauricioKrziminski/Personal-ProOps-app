-- A linha do ciclo diz se está ATRASADA, para a tela decidir o que abre.
--
-- ## Por quê
--
-- No ciclo de 11/09 a 10/10 apareciam compras de 25/08 e 31/08: a tela expandia TODA fatura nas
-- transações dela, e a fatura atrasada cai neste ciclo pelo VENCIMENTO enquanto as compras dela
-- aconteceram no ciclo anterior. A regra do dono do produto separa os dois casos:
--
--   * fatura **atrasada** — um card e nada mais. Ela é dívida a quitar, e as compras que a
--     formaram pertencem a um período já fechado. *"A fatura é uma só, eu não escolho quais
--     lançamentos eu fiquei de pagar da fatura."*
--   * fatura **do ciclo** (ainda a vencer) — abre normalmente, com TODAS as compras dela,
--     inclusive as de alguns dias antes do início do ciclo: elas são da fatura atual, que é
--     justamente o que ele está acumulando agora.
--
-- Sem uma coluna a tela só teria o sufixo "(atrasada)" no título para adivinhar, e ler estado de
-- dentro de um rótulo é a classe de gambiarra que quebra quando alguém traduz a frase. O `day`
-- também não serve: ele vem clampado em `greatest(due_date, current_date)`, então fatura que
-- vence HOJE e fatura vencida chegam com o mesmo dia.
--
-- ⚠️ **`create or replace` NÃO troca o tipo de retorno** ("cannot change return type of existing
-- function"): coluna nova em `returns table` exige `drop` antes — nas TRÊS, que é o que a
-- `20260913180000` já teve de fazer pelo mesmo motivo.
--
-- ⚠️ **E `drop` + `create` não preserva GRANT.** O revoke/grant de cada função é repetido aqui;
-- sem isso a RPC existe e o `authenticated` perde o `execute`, que é exatamente o modo de falha
-- do par `200000`/`220000` — a tela morre com `42501` e a migration aplica limpa.
--
-- ⚠️ A coluna entra por ÚLTIMO e nas três assinaturas: os dois wrappers fazem `select x.*` sobre
-- o `returns table`, então elas se alinham por POSIÇÃO.
--
-- O corpo é o da `20260913180000` sem uma vírgula mudada — só a coluna nova em cada ramo. Ele foi
-- DERIVADO do arquivo anterior, não redigitado: reescrever de memória já custou o
-- `not private.debt_paid_in_month(...)` do ramo do financiamento, que some sem erro nenhum e
-- volta a contar parcela paga.

drop function if exists public.cycle_lines(date, text);
drop function if exists public._cycle_lines(uuid, date, text);
drop function if exists private.cash_events(uuid[], date, date);

create function private.cash_events(ws_ids uuid[], ini date, fim date)
returns table (day date, in_cents bigint, out_cents bigint, title text,
               origin text, ref_id uuid, method_label text, realizado boolean,
               atrasada boolean)
language sql stable security invoker set search_path = public set timezone to 'America/Sao_Paulo'
as $$
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
  left join public.accounts a on a.id = p.account_id;
$$;

revoke execute on function private.cash_events(uuid[], date, date) from public, anon;
grant execute on function private.cash_events(uuid[], date, date) to authenticated, service_role;

-- As duas portas da tela do ciclo, com a coluna no MESMO lugar.
create function public.cycle_lines(p_month date, p_view text default null)
returns table (day date, in_cents bigint, out_cents bigint, title text,
               origin text, ref_id uuid, method_label text, realizado boolean,
               atrasada boolean)
language sql stable security invoker set search_path = public
as $$
  select x.* from private.cycle_bounds(
      private.cycle_close_day(array(select private.my_workspace_ids()), p_view), p_month) b
  cross join lateral private.cash_events(array(select private.my_workspace_ids()), b.ini, b.fim) x
  order by x.day, x.out_cents desc;
$$;

create function public._cycle_lines(uid uuid, p_month date, p_view text default null)
returns table (day date, in_cents bigint, out_cents bigint, title text,
               origin text, ref_id uuid, method_label text, realizado boolean,
               atrasada boolean)
language sql stable security definer set search_path = public
as $$
  select x.* from private.cycle_bounds(
      private.cycle_close_day(array(select public._workspace_ids(uid)), p_view), p_month) b
  cross join lateral private.cash_events(array(select public._workspace_ids(uid)), b.ini, b.fim) x
  order by x.day, x.out_cents desc;
$$;

revoke execute on function public._cycle_lines(uuid, date, text) from public, anon, authenticated;
