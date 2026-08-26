-- Reescreve as RPCs de agregação para escopo de WORKSPACE (0010) e faz a
-- higiene pendente: updated_at com trigger e índices que faltavam.
-- Mantém TODAS as assinaturas — nem o app nem as Edge Functions mudam de chamada.
-- Padrão preservado: _interna(uid) security definer + revoke; wrapper invoker
-- com a query inline sob RLS (o wrapper nunca chama a interna).

-- ── resumo por tipo/categoria (exclui transfers) ─────────────────────────────
create or replace function public._tx_summary(uid uuid, from_date date, to_date date)
returns table(kind text, category text, total_cents bigint, tx_count bigint)
language sql stable security definer
set search_path = public
as $$
  select t.kind, coalesce(t.category, 'outros') as category,
         sum(t.amount_cents)::bigint as total_cents,
         count(*)::bigint as tx_count
  from public.transactions t
  where t.workspace_id in (select public._workspace_ids(uid))
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
  where t.workspace_id in (select public.my_workspace_ids())
    and t.kind <> 'transfer'
    and t.occurred_at between from_date and to_date
  group by 1, 2
  order by 3 desc;
$$;

-- ── fluxo mensal (receita x despesa) ────────────────────────────────────────
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
  where t.workspace_id in (select public.my_workspace_ids())
    and t.kind <> 'transfer'
    and t.occurred_at >= (date_trunc('month', current_date) - make_interval(months => months_back))::date
  group by 1
  order by 1;
$$;

-- ── saldo por conta (derivado; join agora por workspace) ────────────────────
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
  where a.workspace_id in (select public.my_workspace_ids()) and not a.archived
  group by a.id
  union all
  select null::uuid, 'Sem conta', 'none',
         sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end)::bigint
  from public.transactions t
  where t.workspace_id in (select public.my_workspace_ids())
    and t.account_id is null and t.kind <> 'transfer'
  having count(*) > 0;
$$;

-- ── orçamento vs gasto do mês ───────────────────────────────────────────────
create or replace function public._budgets_status(uid uuid, ref_month date default current_date)
returns table(category text, limit_cents bigint, spent_cents bigint)
language sql stable security definer
set search_path = public
as $$
  select b.category, b.limit_cents,
         coalesce(sum(t.amount_cents), 0)::bigint as spent_cents
  from public.budgets b
  left join public.transactions t
    on t.workspace_id = b.workspace_id
   and t.kind = 'expense'
   and t.category = b.category
   and t.occurred_at >= date_trunc('month', ref_month)::date
   and t.occurred_at < (date_trunc('month', ref_month) + interval '1 month')::date
  where b.workspace_id in (select public._workspace_ids(uid))
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
    on t.workspace_id = b.workspace_id
   and t.kind = 'expense'
   and t.category = b.category
   and t.occurred_at >= date_trunc('month', ref_month)::date
   and t.occurred_at < (date_trunc('month', ref_month) + interval '1 month')::date
  where b.workspace_id in (select public.my_workspace_ids())
  group by b.id, b.category, b.limit_cents
  order by 3 desc;
$$;

-- ── back-compat (assinatura da 0001, escopo de workspace) ───────────────────
create or replace function public.expenses_summary(from_date date, to_date date)
returns table(category text, total_cents bigint, expense_count bigint)
language sql stable
set search_path = public
as $$
  select coalesce(t.category, 'outros') as category,
         sum(t.amount_cents)::bigint as total_cents,
         count(*)::bigint as expense_count
  from public.transactions t
  where t.workspace_id in (select public.my_workspace_ids())
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
  where t.workspace_id in (select public.my_workspace_ids())
    and t.kind = 'expense'
    and t.occurred_at >= (date_trunc('month', current_date) - make_interval(months => months_back))::date
  group by 1
  order by 1;
$$;

-- ── higiene: updated_at com trigger ─────────────────────────────────────────
create extension if not exists moddatetime schema extensions;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles','notes','reminders','workspaces',
    'transactions','accounts','goals','budgets','recurring_transactions'
  ] loop
    execute format(
      'alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function extensions.moddatetime(updated_at)', t);
  end loop;
end $$;

-- ── higiene: índices que faltavam ───────────────────────────────────────────
-- rate limit do process-jobs conta ai_events da última hora por usuário
create index if not exists ai_events_user_created_idx on public.ai_events (user_id, created_at desc);
-- filtro por categoria (lista de lançamentos e orçamentos)
create index if not exists transactions_ws_category_idx on public.transactions (workspace_id, category);
