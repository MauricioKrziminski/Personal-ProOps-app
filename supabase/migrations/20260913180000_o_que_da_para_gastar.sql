-- "Quanto dá para gastar" — e o evento que JÁ aconteceu passa a dizer que já aconteceu.
--
-- ⚠️ **`cash_total` e `cash_events` se SOBREPÕEM em hoje, e isso é uma contagem dupla.**
-- `cash_total(d)` conta `cleared` por `paid_at <= d`; `cash_events` emite a MESMA linha no dia do
-- `paid_at`. Qualquer janela ancorada em `cash_total(hoje)` que some eventos de `[hoje, fim]`
-- conta duas vezes tudo que foi pago HOJE — que é literalmente o fluxo da tela Hoje: dar baixa
-- numa conta faria o número PIORAR pelo valor que a pessoa acabou de pagar.
-- `cycle_series_for` nunca bateu nisso porque ancora em `cash_total(ini − 1)`, fora da janela.
--
-- Estreitar para `[hoje+1, fim]` mataria a contagem dupla e derrubaria junto fatura vencida
-- (`greatest(due_date, current_date)`), lançamento atrasado e o que vence HOJE — o dinheiro
-- inteiro da seção "Atrasado". A coluna `realizado` diz qual é qual, e serve também à tela do
-- ciclo, que hoje não distingue "já saiu" de "vai sair".
--
-- ⚠️ `drop` + `create`, não `create or replace`: mudar o tipo de retorno de uma função é erro,
-- não substituição. E `cycle_lines`/`_cycle_lines` fazem `select x.*` sobre um `returns table`
-- explícito — as duas ganham a coluna no MESMO lugar, ou o PostgREST devolve coluna trocada sem
-- erro nenhum.
--
-- ⚠️ Fuso e `security invoker` no CABEÇALHO, repetidos: `create` novo não herda nada, e cláusula
-- pendurada por `alter` morre no replace seguinte (a lição da `20260911160000`).

drop function if exists public.cycle_lines(date, text);
drop function if exists public._cycle_lines(uuid, date, text);
drop function if exists private.cash_events(uuid[], date, date);

create function private.cash_events(ws_ids uuid[], ini date, fim date)
returns table (day date, in_cents bigint, out_cents bigint, title text,
               origin text, ref_id uuid, method_label text, realizado boolean)
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
         (t.status = 'cleared' and coalesce(t.paid_at, t.occurred_at) <= current_date)
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
         'invoice', ci.id, coalesce(a.name,'Cartão'), false
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
         (t.status = 'cleared' and coalesce(t.paid_at, t.occurred_at) <= current_date)
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
         'transaction_overdue', t.id, coalesce(a.name,'Sem conta'), false
  from public.transactions t left join public.accounts a on a.id = t.account_id
  where t.workspace_id = any(ws_ids) and t.status='pending'
    and t.kind <> 'transfer' and t.invoice_id is null and t.rollover_of_invoice_id is null
    and coalesce(t.due_at,t.occurred_at) < ini and current_date between ini and fim
    and (t.kind <> 'income' or coalesce(t.due_at,t.occurred_at) >= current_date - 3)
  union all
  -- 5. Cronograma de dívida: sai do CONTRATO, não de `transactions`. Nunca realizado.
  select s.due_date, 0::bigint, s.payment_cents, 'Parcela ' || d.name, 'debt_schedule', d.id,
         coalesce(a.name,'Financiamento'), false
  from public.debts d cross join lateral private.debt_schedule_for(d.id) s
  left join public.accounts a on a.id = d.account_id
  where d.workspace_id = any(ws_ids) and not d.archived and d.remaining_cents > 0
    and s.due_date between ini and fim and not private.debt_paid_in_month(d.id, s.due_date)
  union all
  -- 6. Recorrente projetada da REGRA: linha que ainda não existe. Nunca realizada.
  select p.due_date,
         case when p.kind='income' then p.amount_cents else 0 end::bigint,
         case when p.kind='expense' then p.amount_cents else 0 end::bigint,
         p.description, 'recurring_projection', p.recurring_id, coalesce(a.name,'Sem conta'), false
  from private.recurring_projection_for(ws_ids, ini, fim) p
  left join public.accounts a on a.id = p.account_id;
$$;

revoke execute on function private.cash_events(uuid[], date, date) from public, anon;
grant execute on function private.cash_events(uuid[], date, date) to authenticated, service_role;

-- As duas portas da tela do ciclo, com a coluna no MESMO lugar.
create function public.cycle_lines(p_month date, p_view text default null)
returns table (day date, in_cents bigint, out_cents bigint, title text,
               origin text, ref_id uuid, method_label text, realizado boolean)
language sql stable security invoker set search_path = public
as $$
  select x.* from private.cycle_bounds(
      private.cycle_close_day(array(select private.my_workspace_ids()), p_view), p_month) b
  cross join lateral private.cash_events(array(select private.my_workspace_ids()), b.ini, b.fim) x
  order by x.day, x.out_cents desc;
$$;

create function public._cycle_lines(uid uuid, p_month date, p_view text default null)
returns table (day date, in_cents bigint, out_cents bigint, title text,
               origin text, ref_id uuid, method_label text, realizado boolean)
language sql stable security definer set search_path = public
as $$
  select x.* from private.cycle_bounds(
      private.cycle_close_day(array(select public._workspace_ids(uid)), p_view), p_month) b
  cross join lateral private.cash_events(array(select public._workspace_ids(uid)), b.ini, b.fim) x
  order by x.day, x.out_cents desc;
$$;
revoke execute on function public._cycle_lines(uuid, date, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- O que dá para gastar — casca fina sobre `cash_events`, zero aritmética nova.
--
-- ⚠️ **Não devolve `ate` nem `dias`.** Quem responde onde o ciclo termina é `cycle_now`, que a
-- tela já chama. Uma segunda definição da borda é o modo de falha MUDO que a `20260911170000`
-- documenta: o painel pediria N dias enquanto o banco agrupa outra borda, e os dois números da
-- tela discordariam sem erro nenhum.
--
-- ⚠️ **`livre` não é `caixa − compromissos do ciclo`.** É o caixa menos o que vence ANTES da
-- próxima entrada: é a pergunta "posso gastar isto agora?", e ela termina no dia em que entra
-- dinheiro novo. Somar o ciclo inteiro daria um número que só faz sentido em 10/10.
-- ════════════════════════════════════════════════════════════════════════════════════════════
create or replace function private.spendable_for(ws_ids uuid[], p_view text default null)
returns table (caixa bigint, comprometido_ate_entrada bigint, comprometido_no_ciclo bigint,
               a_receber_no_ciclo bigint, proxima_entrada date)
language sql stable security invoker set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  with b as (
    select c.fim
    from private.cycle_bounds(
           private.cycle_close_day(ws_ids, p_view),
           private.cycle_month_of(private.cycle_close_day(ws_ids, p_view), current_date)) c
  ),
  ev as (
    -- `not realizado`: o que já saiu da conta está DENTRO de `caixa`, não à frente dele.
    select e.day, e.in_cents, e.out_cents
    from b, private.cash_events(ws_ids, current_date, b.fim) e
    where not e.realizado
  ),
  entrada as (select min(day) d from ev where in_cents > 0)
  select private.cash_total(ws_ids, current_date),
         -- ⚠️ `<=`, não `<`. Fatura vencida (ramo 2, `greatest(due_date, current_date)`) e
         -- lançamento atrasado (ramo 4, `select current_date`) são emitidos EM hoje. Com `<`, uma
         -- receita prevista para hoje faria `entrada = current_date`, nada casaria, e o
         -- comprometido voltaria ZERO com fatura vencida na tela — no dia do salário, que é
         -- exatamente quando as contas se acumulam. `<=` erra para o lado conservador: a despesa
         -- do dia da entrada conta, e a entrada em si não entra no `caixa`.
         coalesce((select sum(out_cents) from ev
                   where day <= coalesce((select d from entrada), 'infinity'::date)), 0)::bigint,
         coalesce((select sum(out_cents) from ev), 0)::bigint,
         coalesce((select sum(in_cents) from ev), 0)::bigint,
         (select d from entrada);
$$;
revoke execute on function private.spendable_for(uuid[], text) from public, anon;
grant execute on function private.spendable_for(uuid[], text) to authenticated, service_role;

-- Par interna/wrapper de `supabase.md`. O wrapper CHAMA a interna, e pode: o `execute` dela é
-- concedido ao `authenticated` logo acima. O que a regra proíbe é o wrapper chamar a `public._*`
-- (definer, revogada de `authenticated`) — duplicar a query aqui seria a segunda cópia da conta.
-- Mesmo arranjo de `cycle_series` → `cycle_series_for`.
create or replace function public.spendable(p_view text default null)
returns table (caixa bigint, comprometido_ate_entrada bigint, comprometido_no_ciclo bigint,
               a_receber_no_ciclo bigint, proxima_entrada date)
language sql stable security invoker set search_path = public
as $$ select * from private.spendable_for(array(select private.my_workspace_ids()), p_view); $$;

create or replace function public._spendable(uid uuid, p_view text default null)
returns table (caixa bigint, comprometido_ate_entrada bigint, comprometido_no_ciclo bigint,
               a_receber_no_ciclo bigint, proxima_entrada date)
language sql stable security definer set search_path = public
as $$ select * from private.spendable_for(array(select public._workspace_ids(uid)), p_view); $$;
revoke execute on function public._spendable(uuid, text) from public, anon, authenticated;
