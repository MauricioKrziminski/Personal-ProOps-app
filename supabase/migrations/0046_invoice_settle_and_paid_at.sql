-- Ver o passado do cartão, e poder corrigi-lo sem mentir sobre o caixa.
--
-- Três problemas que apareceram juntos quando a retroação de parcelas (agente,
-- etapa 2.8) começou a criar lançamentos em meses passados:
--
--   1. `_card_summary` devolve a fatura aberta MAIS ANTIGA, então o app abria
--      numa fatura vencida há três meses e a do ciclo corrente ficava invisível.
--   2. Quitar uma fatura antiga só existia como `pay_invoice`, que cria uma
--      TRANSFERÊNCIA — ou seja, tirava do saldo de hoje um dinheiro que na vida
--      real saiu meses atrás, antes de o usuário começar a usar o app.
--   3. Dar baixa reescrevia `occurred_at`, então boleto de agosto pago em
--      setembro migrava de mês em todo relatório.

-- ── 1. quando a despesa ACONTECEU ≠ quando o dinheiro SAIU ─────────────────
--
-- `occurred_at` volta a ser só a primeira coisa. Sem esta separação, "dar baixa"
-- é uma operação que reescreve o passado: o gasto muda de mês sozinho e o
-- relatório do mês anterior encolhe depois de fechado.
alter table public.transactions
  add column if not exists paid_at date;

comment on column public.transactions.paid_at is
  'Quando o dinheiro saiu. `occurred_at` continua sendo quando a despesa aconteceu — perguntas diferentes (competência vs caixa). ATENCAO: so settle_invoice e a baixa manual preenchem; despesa criada ja cleared nasce NULL. Quem le precisa de coalesce(paid_at, occurred_at).';

-- Backfill: o que já está liquidado foi pago na data em que está registrado. É a
-- única suposição possível, e é a que preserva os relatórios como estão hoje.
update public.transactions
   set paid_at = occurred_at
 where status = 'cleared' and paid_at is null;

-- ── 2. quitar sem movimentar caixa ─────────────────────────────────────────
create or replace function public.settle_invoice(
  p_invoice_id uuid,
  p_paid_at date default current_date
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  inv record;
begin
  -- security invoker + RLS: quem não enxerga a fatura não acha a linha
  select ci.id, ci.status into inv
  from public.card_invoices ci where ci.id = p_invoice_id;
  if inv.id is null then
    raise exception 'fatura não encontrada';
  end if;

  -- Idempotente de propósito: o usuário toca duas vezes no botão antes da tela
  -- responder, e a segunda não pode virar erro nem segunda escrita.
  if inv.status = 'paid' then
    return p_invoice_id;
  end if;

  -- As parcelas de dentro TAMBÉM fecham. Sem isto o app se contradiz: fatura
  -- paga continuaria alimentando `upcoming_bills` e cada parcela continuaria
  -- oferecendo o botão "Paguei".
  --
  -- ⚠️ NÃO tocar em `occurred_at`: o trigger `set_invoice` é
  -- `before update of account_id, occurred_at` (0013:211) e remanejaria a
  -- parcela da fatura de maio para a fatura de hoje.
  update public.transactions
     set status = 'cleared', paid_at = p_paid_at
   where invoice_id = p_invoice_id and status = 'pending';

  -- `payment_transaction_id` fica NULL, e é isso que distingue esta operação de
  -- `pay_invoice`: não existe transferência, então nenhum saldo se move.
  update public.card_invoices
     set status = 'paid', paid_at = p_paid_at, payment_transaction_id = null
   where id = p_invoice_id;

  return p_invoice_id;
end;
$$;

comment on function public.settle_invoice(uuid, date) is
  'Marca a fatura como paga SEM criar transferência. Para dado histórico: a fatura já foi paga na vida real antes de o app existir. Pagamento de verdade é pay_invoice.';

-- ── 3. a fatura CORRENTE em destaque, com o atraso ao lado ─────────────────
--
-- O critério antigo (`order by reference_month` + `distinct on`) elegia a mais
-- antiga em aberto. O novo prefere, nesta ordem: a fatura do mês corrente, a
-- próxima futura, e só então a mais recente do passado.
--
-- ⚠️ `unpaid_total_cents` e `available_limit_cents` continuam somando TODAS as
-- faturas não pagas, e não a que passou a ser destacada. São eles que produzem o
-- "usado R$ 14.300 de R$ 12.000": escopá-los na fatura corrente faria o aviso de
-- estouro de limite sumir em silêncio.

-- ⚠️ `create or replace` NÃO consegue mudar as colunas de um `returns table` —
-- Postgres responde `cannot change return type of existing function`. Como as três
-- colunas de atraso são novas, as duas funções são DERRUBADAS antes. A migration
-- roda em transação, então não existe janela em que a RPC não exista.
drop function if exists public._card_summary(uuid);
drop function if exists public.card_summary();

create or replace function public._card_summary(uid uuid)
returns table(
  account_id uuid, name text, credit_limit_cents bigint,
  closing_day int, due_day int,
  invoice_id uuid, reference_month date, closing_date date, due_date date,
  invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint,
  overdue_count int, overdue_total_cents bigint, oldest_overdue_invoice_id uuid
)
language sql stable security definer
set search_path = public
as $$
  with cards as (
    select a.* from public.accounts a
    where a.workspace_id in (select public._workspace_ids(uid))
      and a.type = 'credit_card' and not a.archived
  ),
  totals as (
    select ci.id as invoice_id, coalesce(sum(t.amount_cents), 0)::bigint as total_cents
    from public.card_invoices ci
    -- escopo no workspace: sem este join a CTE varria card_invoices de TODOS os
    -- usuarios a cada chamada (herdado da 0013). Nao vazava, porque o resultado e
    -- filtrado depois, mas custava O(faturas do banco inteiro).
    join cards c on c.id = ci.account_id
    left join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    group by ci.id
  ),
  aberta as (
    select distinct on (ci.account_id) ci.*
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    where ci.status <> 'paid'
    order by ci.account_id,
             -- corrente e futuras primeiro, da mais próxima para a mais distante
             (ci.reference_month < date_trunc('month', current_date)::date),
             case when ci.reference_month >= date_trunc('month', current_date)::date
                  then ci.reference_month end asc,
             ci.reference_month desc
  ),
  atrasadas as (
    select ci.account_id,
           count(*)::int as overdue_count,
           coalesce(sum(tt.total_cents), 0)::bigint as overdue_total_cents,
           (array_agg(ci.id order by ci.reference_month))[1] as oldest_id
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    left join totals tt on tt.invoice_id = ci.id
    where ci.status <> 'paid' and ci.due_date < current_date
    group by ci.account_id
  )
  select c.id, c.name, c.credit_limit_cents, c.closing_day, c.due_day,
         ab.id, ab.reference_month, ab.closing_date, ab.due_date,
         coalesce(tt.total_cents, 0)::bigint,
         coalesce((select sum(t2.total_cents) from totals t2
                   join public.card_invoices ci2 on ci2.id = t2.invoice_id
                   where ci2.account_id = c.id and ci2.status <> 'paid'), 0)::bigint,
         (coalesce(c.credit_limit_cents, 0)
          - coalesce((select sum(t3.total_cents) from totals t3
                      join public.card_invoices ci3 on ci3.id = t3.invoice_id
                      where ci3.account_id = c.id and ci3.status <> 'paid'), 0))::bigint,
         coalesce(atr.overdue_count, 0),
         coalesce(atr.overdue_total_cents, 0)::bigint,
         atr.oldest_id
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  left join atrasadas atr on atr.account_id = c.id
  order by c.name;
$$;
revoke execute on function public._card_summary(uuid) from public, anon, authenticated;

-- Wrapper security invoker: query INLINE sob RLS, não chamada à interna (o
-- EXECUTE da interna é revogado para `authenticated`). Padrão duplo de
-- `supabase.md` — a duplicação da query é intencional.
create or replace function public.card_summary()
returns table(
  account_id uuid, name text, credit_limit_cents bigint,
  closing_day int, due_day int,
  invoice_id uuid, reference_month date, closing_date date, due_date date,
  invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint,
  overdue_count int, overdue_total_cents bigint, oldest_overdue_invoice_id uuid
)
language sql stable
set search_path = public
as $$
  with cards as (
    select a.* from public.accounts a
    where a.workspace_id in (select private.my_workspace_ids())
      and a.type = 'credit_card' and not a.archived
  ),
  totals as (
    select ci.id as invoice_id, coalesce(sum(t.amount_cents), 0)::bigint as total_cents
    from public.card_invoices ci
    -- escopo no workspace: sem este join a CTE varria card_invoices de TODOS os
    -- usuarios a cada chamada (herdado da 0013). Nao vazava, porque o resultado e
    -- filtrado depois, mas custava O(faturas do banco inteiro).
    join cards c on c.id = ci.account_id
    left join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    group by ci.id
  ),
  aberta as (
    select distinct on (ci.account_id) ci.*
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    where ci.status <> 'paid'
    order by ci.account_id,
             (ci.reference_month < date_trunc('month', current_date)::date),
             case when ci.reference_month >= date_trunc('month', current_date)::date
                  then ci.reference_month end asc,
             ci.reference_month desc
  ),
  atrasadas as (
    select ci.account_id,
           count(*)::int as overdue_count,
           coalesce(sum(tt.total_cents), 0)::bigint as overdue_total_cents,
           (array_agg(ci.id order by ci.reference_month))[1] as oldest_id
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    left join totals tt on tt.invoice_id = ci.id
    where ci.status <> 'paid' and ci.due_date < current_date
    group by ci.account_id
  )
  select c.id, c.name, c.credit_limit_cents, c.closing_day, c.due_day,
         ab.id, ab.reference_month, ab.closing_date, ab.due_date,
         coalesce(tt.total_cents, 0)::bigint,
         coalesce((select sum(t2.total_cents) from totals t2
                   join public.card_invoices ci2 on ci2.id = t2.invoice_id
                   where ci2.account_id = c.id and ci2.status <> 'paid'), 0)::bigint,
         (coalesce(c.credit_limit_cents, 0)
          - coalesce((select sum(t3.total_cents) from totals t3
                      join public.card_invoices ci3 on ci3.id = t3.invoice_id
                      where ci3.account_id = c.id and ci3.status <> 'paid'), 0))::bigint,
         coalesce(atr.overdue_count, 0),
         coalesce(atr.overdue_total_cents, 0)::bigint,
         atr.oldest_id
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  left join atrasadas atr on atr.account_id = c.id
  order by c.name;
$$;

-- ── 4. o saldo do cartão não pode carregar dívida fantasma ─────────────────
--
-- `account_balances` soma TODA transação do cartão, sem olhar fatura nem status.
-- Isso funcionava porque o único jeito de quitar era `pay_invoice`, que cria uma
-- transferência: as compras ficam negativas e a transferência as compensa,
-- sobrando exatamente a dívida não paga.
--
-- `settle_invoice` quebra essa aritmética de propósito — ela NÃO cria
-- transferência. Sem o filtro abaixo, o cartão ficaria negativo para sempre
-- enquanto a tela de Cartões mostra "limite livre", ou seja, o app se
-- contradizendo em duas telas.
--
-- ⚠️ O filtro é `paid` **E** `payment_transaction_id is null` — não basta
-- `status = 'paid'`. Fatura quitada por `pay_invoice` TEM a transferência
-- compensando, e excluir as compras dela também faria o cartão ficar POSITIVO.
-- A ausência do pagamento é justamente o que distingue as duas operações.

create or replace function public._account_balances(uid uuid)
returns table(account_id uuid, name text, type text, balance_cents bigint)
language sql stable security definer
set search_path = public
as $$
  select a.id as account_id, a.name, a.type,
         (a.initial_balance_cents + coalesce(sum(
           case
             when t.kind = 'income'   and t.account_id = a.id then t.amount_cents
             when t.kind = 'expense'  and t.account_id = a.id then -t.amount_cents
             when t.kind = 'transfer' and t.account_id = a.id then -t.amount_cents
             when t.kind = 'transfer' and t.counterparty_account_id = a.id then t.amount_cents
             else 0
           end), 0))::bigint as balance_cents
  from public.accounts a
  left join public.transactions t
    on t.workspace_id = a.workspace_id
   and (t.account_id = a.id or t.counterparty_account_id = a.id)
   and not exists (
     select 1 from public.card_invoices ci
     where ci.id = t.invoice_id
       and ci.status = 'paid' and ci.payment_transaction_id is null
   )
  where a.workspace_id in (select public._workspace_ids(uid)) and not a.archived
  group by a.id
  union all
  select null::uuid, 'Sem conta', 'none',
         sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end)::bigint
  from public.transactions t
  where t.workspace_id in (select public._workspace_ids(uid))
    and t.account_id is null and t.kind <> 'transfer'
  having count(*) > 0;
$$;
revoke execute on function public._account_balances(uuid) from public, anon, authenticated;

create or replace function public.account_balances()
returns table(account_id uuid, name text, type text, balance_cents bigint)
language sql stable
set search_path = public
as $$
  select a.id as account_id, a.name, a.type,
         (a.initial_balance_cents + coalesce(sum(
           case
             when t.kind = 'income'   and t.account_id = a.id then t.amount_cents
             when t.kind = 'expense'  and t.account_id = a.id then -t.amount_cents
             when t.kind = 'transfer' and t.account_id = a.id then -t.amount_cents
             when t.kind = 'transfer' and t.counterparty_account_id = a.id then t.amount_cents
             else 0
           end), 0))::bigint as balance_cents
  from public.accounts a
  left join public.transactions t
    on t.workspace_id = a.workspace_id
   and (t.account_id = a.id or t.counterparty_account_id = a.id)
   and not exists (
     select 1 from public.card_invoices ci
     where ci.id = t.invoice_id
       and ci.status = 'paid' and ci.payment_transaction_id is null
   )
  where a.workspace_id in (select private.my_workspace_ids()) and not a.archived
  group by a.id
  union all
  select null::uuid, 'Sem conta', 'none',
         sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end)::bigint
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
    and t.account_id is null and t.kind <> 'transfer'
  having count(*) > 0;
$$;
