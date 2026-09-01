-- `monthly_cashflow`: janela que realmente é "para trás" e escopo de WORKSPACE.
--
-- A função existia desde a 0005 com hook pronto e **nenhuma tela lendo** (a auditoria de
-- 31/08/2026 registrou o "zero consumidores"). Ao ligá-la na home, três defeitos apareceram de
-- uma vez — os três invisíveis enquanto ninguém desenhava o resultado:
--
-- 1. **Não havia limite SUPERIOR.** O filtro era só `occurred_at >= início da janela`, então toda
--    parcela FUTURA entrava: `monthly_cashflow(6)` devolvia 14 meses, indo até 2027, porque uma
--    compra em 8x cria uma linha por mês à frente. É o mesmo defeito que a `invoices.tsx` teve
--    com "últimas 12 faturas" desenhando 2027 — parcelamento sempre povoa o futuro, e todo
--    gráfico de PASSADO precisa dizer isso na query.
-- 2. **O escopo era `user_id`, não `workspace_id`.** `user_id` é o AUTOR do lançamento
--    (`supabase.md`), nunca o filtro de visibilidade — desde a 0010 o dado pertence ao workspace.
--    Num workspace compartilhado esta função mostrava só o que VOCÊ lançou, enquanto
--    `transactions_summary`, na mesma tela, somava o workspace inteiro. Duas leituras do mesmo
--    mês que não batem.
-- 3. **`months_back` sem trava**, diferente das outras janelas do schema (1..60).
--
-- Mesmo tipo de retorno nas duas funções, então `create or replace` basta — sem drop.

create or replace function public._monthly_cashflow(uid uuid, months_back int default 6)
returns table(month date, income_cents bigint, expense_cents bigint)
language sql stable security definer
set search_path = public
as $$
  select date_trunc('month', t.occurred_at)::date as month,
         sum(case when t.kind = 'income' then t.amount_cents else 0 end)::bigint as income_cents,
         sum(case when t.kind = 'expense' then t.amount_cents else 0 end)::bigint as expense_cents
  from public.transactions t
  where t.workspace_id in (select public._workspace_ids(uid))
    and t.kind <> 'transfer'
    and t.occurred_at >= (date_trunc('month', current_date)
                          - make_interval(months => least(greatest(coalesce(months_back, 6), 1), 60)))::date
    -- Fecha a janela no fim do mês CORRENTE: parcela de 2027 não é "os últimos N meses".
    and t.occurred_at < (date_trunc('month', current_date) + interval '1 month')::date
  group by 1
  order by 1;
$$;
revoke execute on function public._monthly_cashflow(uuid, int) from public, anon, authenticated;

create or replace function public.monthly_cashflow(months_back int default 6)
returns table(month date, income_cents bigint, expense_cents bigint)
language sql stable
set search_path = public
as $$
  select date_trunc('month', t.occurred_at)::date as month,
         sum(case when t.kind = 'income' then t.amount_cents else 0 end)::bigint as income_cents,
         sum(case when t.kind = 'expense' then t.amount_cents else 0 end)::bigint as expense_cents
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
    and t.kind <> 'transfer'
    and t.occurred_at >= (date_trunc('month', current_date)
                          - make_interval(months => least(greatest(coalesce(months_back, 6), 1), 60)))::date
    and t.occurred_at < (date_trunc('month', current_date) + interval '1 month')::date
  group by 1
  order by 1;
$$;
