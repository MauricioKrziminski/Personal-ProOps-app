-- Núcleo financeiro v1: contas, transações unificadas (expense/income/transfer),
-- metas, orçamentos e lançamentos recorrentes.
-- Faz backfill de `expenses` -> `transactions` e recria `expenses_summary`/
-- `expenses_monthly` (mesma assinatura) lendo `transactions`.
-- IMPORTANTE: `expenses` NÃO é dropada aqui — o process-jobs em produção ainda
-- escreve nela. O drop acontece na 0006, depois do deploy do executor novo.

-- ── contas/carteiras ─────────────────────────────────────────────────────────
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  type text not null default 'checking'
    check (type in ('checking','savings','credit_card','cash','investment')),
  currency text not null default 'BRL',
  initial_balance_cents bigint not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table public.accounts enable row level security;
drop policy if exists "accounts own rows" on public.accounts;
create policy "accounts own rows" on public.accounts
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── transações unificadas ────────────────────────────────────────────────────
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('expense','income','transfer')),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'BRL',
  category text,
  description text,
  account_id uuid references public.accounts(id) on delete set null,
  counterparty_account_id uuid references public.accounts(id) on delete set null,
  occurred_at date not null default current_date,
  source text not null default 'whatsapp'
    check (source in ('whatsapp','app','import','recurring')),
  created_at timestamptz not null default now(),
  check (kind <> 'transfer' or counterparty_account_id is not null),
  check (kind = 'transfer' or counterparty_account_id is null),
  check (kind <> 'transfer' or account_id is distinct from counterparty_account_id)
);
create index if not exists transactions_user_occurred_idx on public.transactions (user_id, occurred_at desc);
create index if not exists transactions_account_idx on public.transactions (account_id);
create index if not exists transactions_counterparty_idx on public.transactions (counterparty_account_id);
alter table public.transactions enable row level security;
drop policy if exists "transactions own rows" on public.transactions;
create policy "transactions own rows" on public.transactions
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── metas ────────────────────────────────────────────────────────────────────
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  target_cents bigint not null check (target_cents > 0),
  saved_cents bigint not null default 0 check (saved_cents >= 0),
  deadline date,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table public.goals enable row level security;
drop policy if exists "goals own rows" on public.goals;
create policy "goals own rows" on public.goals
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── orçamentos (limite mensal fixo por categoria) ────────────────────────────
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  limit_cents bigint not null check (limit_cents > 0),
  created_at timestamptz not null default now(),
  unique (user_id, category)
);
alter table public.budgets enable row level security;
drop policy if exists "budgets own rows" on public.budgets;
create policy "budgets own rows" on public.budgets
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── lançamentos recorrentes (materializados pelo cron do send-reminders) ────
create table if not exists public.recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('expense','income')),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'BRL',
  category text,
  description text,
  account_id uuid references public.accounts(id) on delete set null,
  rrule text not null,
  next_run_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists recurring_tx_due_idx on public.recurring_transactions (next_run_at) where active;
create index if not exists recurring_tx_user_idx on public.recurring_transactions (user_id, next_run_at);
alter table public.recurring_transactions enable row level security;
drop policy if exists "recurring own rows" on public.recurring_transactions;
create policy "recurring own rows" on public.recurring_transactions
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── backfill dos gastos existentes (idempotente; delta final roda na 0006) ──
insert into public.transactions
  (id, user_id, kind, amount_cents, currency, category, description, occurred_at, source, created_at)
select e.id, e.user_id, 'expense', e.amount_cents, e.currency, e.category, e.description, e.spent_at, e.source, e.created_at
from public.expenses e
where not exists (select 1 from public.transactions t where t.id = e.id);

-- ── back-compat: mesma assinatura da 0001, agora lendo transactions ─────────
-- security invoker: RLS own-rows de transactions garante o escopo do usuário.
create or replace function public.expenses_summary(from_date date, to_date date)
returns table(category text, total_cents bigint, expense_count bigint)
language sql stable
set search_path = public
as $$
  select coalesce(t.category, 'outros') as category,
         sum(t.amount_cents)::bigint as total_cents,
         count(*)::bigint as expense_count
  from public.transactions t
  where t.user_id = (select auth.uid())
    and t.kind = 'expense'
    and t.occurred_at between from_date and to_date
  group by 1
  order by 2 desc;
$$;

create or replace function public.expenses_monthly(months_back int default 6)
returns table(month date, total_cents bigint)
language sql stable
set search_path = public
as $$
  select date_trunc('month', t.occurred_at)::date as month,
         sum(t.amount_cents)::bigint as total_cents
  from public.transactions t
  where t.user_id = (select auth.uid())
    and t.kind = 'expense'
    and t.occurred_at >= (date_trunc('month', current_date) - make_interval(months => months_back))::date
  group by 1
  order by 1;
$$;

-- ── RPCs de agregação ────────────────────────────────────────────────────────
-- Padrão: _interna(uid) security definer + revoke (só service_role, p/ Edge
-- Functions) e wrapper security invoker com a query inline sob RLS (p/ o app).
-- O wrapper NÃO chama a interna: invoker não tem EXECUTE nela (revogado).

-- resumo por tipo/categoria (exclui transfers)
create or replace function public._tx_summary(uid uuid, from_date date, to_date date)
returns table(kind text, category text, total_cents bigint, tx_count bigint)
language sql stable security definer
set search_path = public
as $$
  select t.kind, coalesce(t.category, 'outros') as category,
         sum(t.amount_cents)::bigint as total_cents,
         count(*)::bigint as tx_count
  from public.transactions t
  where t.user_id = uid
    and t.kind <> 'transfer'
    and t.occurred_at between from_date and to_date
  group by 1, 2
  order by 3 desc;
$$;
revoke execute on function public._tx_summary(uuid, date, date) from public, anon, authenticated;

create or replace function public.transactions_summary(from_date date, to_date date)
returns table(kind text, category text, total_cents bigint, tx_count bigint)
language sql stable
set search_path = public
as $$
  select t.kind, coalesce(t.category, 'outros') as category,
         sum(t.amount_cents)::bigint as total_cents,
         count(*)::bigint as tx_count
  from public.transactions t
  where t.user_id = (select auth.uid())
    and t.kind <> 'transfer'
    and t.occurred_at between from_date and to_date
  group by 1, 2
  order by 3 desc;
$$;

-- fluxo mensal (receita x despesa)
create or replace function public._monthly_cashflow(uid uuid, months_back int default 6)
returns table(month date, income_cents bigint, expense_cents bigint)
language sql stable security definer
set search_path = public
as $$
  select date_trunc('month', t.occurred_at)::date as month,
         sum(case when t.kind = 'income' then t.amount_cents else 0 end)::bigint as income_cents,
         sum(case when t.kind = 'expense' then t.amount_cents else 0 end)::bigint as expense_cents
  from public.transactions t
  where t.user_id = uid
    and t.kind <> 'transfer'
    and t.occurred_at >= (date_trunc('month', current_date) - make_interval(months => months_back))::date
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
  where t.user_id = (select auth.uid())
    and t.kind <> 'transfer'
    and t.occurred_at >= (date_trunc('month', current_date) - make_interval(months => months_back))::date
  group by 1
  order by 1;
$$;

-- saldo por conta (derivado; nunca materializado)
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
    on t.user_id = a.user_id and (t.account_id = a.id or t.counterparty_account_id = a.id)
  where a.user_id = uid and not a.archived
  group by a.id
  union all
  select null::uuid, 'Sem conta', 'none',
         sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end)::bigint
  from public.transactions t
  where t.user_id = uid and t.account_id is null and t.kind <> 'transfer'
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
    on t.user_id = a.user_id and (t.account_id = a.id or t.counterparty_account_id = a.id)
  where a.user_id = (select auth.uid()) and not a.archived
  group by a.id
  union all
  select null::uuid, 'Sem conta', 'none',
         sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end)::bigint
  from public.transactions t
  where t.user_id = (select auth.uid()) and t.account_id is null and t.kind <> 'transfer'
  having count(*) > 0;
$$;

-- orçamento vs gasto do mês
create or replace function public._budgets_status(uid uuid, ref_month date default current_date)
returns table(category text, limit_cents bigint, spent_cents bigint)
language sql stable security definer
set search_path = public
as $$
  select b.category, b.limit_cents,
         coalesce(sum(t.amount_cents), 0)::bigint as spent_cents
  from public.budgets b
  left join public.transactions t
    on t.user_id = b.user_id
   and t.kind = 'expense'
   and t.category = b.category
   and t.occurred_at >= date_trunc('month', ref_month)::date
   and t.occurred_at < (date_trunc('month', ref_month) + interval '1 month')::date
  where b.user_id = uid
  group by b.id, b.category, b.limit_cents
  order by 3 desc;
$$;
revoke execute on function public._budgets_status(uuid, date) from public, anon, authenticated;

create or replace function public.budgets_status(ref_month date default current_date)
returns table(category text, limit_cents bigint, spent_cents bigint)
language sql stable
set search_path = public
as $$
  select b.category, b.limit_cents,
         coalesce(sum(t.amount_cents), 0)::bigint as spent_cents
  from public.budgets b
  left join public.transactions t
    on t.user_id = b.user_id
   and t.kind = 'expense'
   and t.category = b.category
   and t.occurred_at >= date_trunc('month', ref_month)::date
   and t.occurred_at < (date_trunc('month', ref_month) + interval '1 month')::date
  where b.user_id = (select auth.uid())
  group by b.id, b.category, b.limit_cents
  order by 3 desc;
$$;

-- ── realtime ─────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'transactions') then
    alter publication supabase_realtime add table public.transactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'goals') then
    alter publication supabase_realtime add table public.goals;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'budgets') then
    alter publication supabase_realtime add table public.budgets;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'accounts') then
    alter publication supabase_realtime add table public.accounts;
  end if;
end $$;
