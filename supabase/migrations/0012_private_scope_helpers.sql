-- Fecha os 2 WARN dos security advisors abertos pela 0010:
-- "Signed-In Users Can Execute SECURITY DEFINER Function" em my_workspace_ids()
-- e my_default_workspace(), ambas expostas em /rest/v1/rpc/.
--
-- 1. `my_workspace_ids` PRECISA ser security definer (senão a policy de
--    workspace_members recursaria nela mesma), mas não precisa estar no schema
--    exposto pelo PostgREST -> vai para o schema `private`.
-- 2. `my_default_workspace` NÃO precisa ser definer: só lê linhas que o próprio
--    usuário já enxerga por RLS -> vira security invoker e continua em public
--    (o app chama por rpc e a coluna workspace_id a usa como DEFAULT).

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.my_workspace_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select m.workspace_id from public.workspace_members m
  where m.user_id = (select auth.uid());
$$;
revoke execute on function private.my_workspace_ids() from public, anon;
grant execute on function private.my_workspace_ids() to authenticated, service_role;

-- ── policies passam a apontar para o helper privado ─────────────────────────
drop policy if exists "workspaces: members read" on public.workspaces;
create policy "workspaces: members read" on public.workspaces
  for select using (id in (select private.my_workspace_ids()));

drop policy if exists "members: read own workspaces" on public.workspace_members;
create policy "members: read own workspaces" on public.workspace_members
  for select using (workspace_id in (select private.my_workspace_ids()));

do $$
declare
  t text;
begin
  foreach t in array array[
    'notes','reminders','transactions','accounts','goals','budgets','recurring_transactions'
  ] loop
    execute format('drop policy if exists "workspace rows" on public.%I', t);
    execute format(
      'create policy "workspace rows" on public.%I for all
         using (workspace_id in (select private.my_workspace_ids()))
         with check (workspace_id in (select private.my_workspace_ids()))', t);
  end loop;
end $$;

-- ── wrappers invoker (app) passam a usar o helper privado ───────────────────
create or replace function public.transactions_summary(from_date date, to_date date)
returns table(kind text, category text, total_cents bigint, tx_count bigint)
language sql stable
set search_path = public
as $$
  select t.kind, coalesce(t.category, 'outros') as category,
         sum(t.amount_cents)::bigint as total_cents,
         count(*)::bigint as tx_count
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
    and t.kind <> 'transfer'
    and t.occurred_at between from_date and to_date
  group by 1, 2
  order by 3 desc;
$$;

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
    and t.occurred_at >= (date_trunc('month', current_date) - make_interval(months => months_back))::date
  group by 1
  order by 1;
$$;

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
  where b.workspace_id in (select private.my_workspace_ids())
  group by b.id, b.category, b.limit_cents
  order by 3 desc;
$$;

create or replace function public.expenses_summary(from_date date, to_date date)
returns table(category text, total_cents bigint, expense_count bigint)
language sql stable
set search_path = public
as $$
  select coalesce(t.category, 'outros') as category,
         sum(t.amount_cents)::bigint as total_cents,
         count(*)::bigint as expense_count
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
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
  where t.workspace_id in (select private.my_workspace_ids())
    and t.kind = 'expense'
    and t.occurred_at >= (date_trunc('month', current_date) - make_interval(months => months_back))::date
  group by 1
  order by 1;
$$;

-- ── my_default_workspace: definer -> invoker (RLS já basta) ─────────────────
create or replace function public.my_default_workspace()
returns uuid
language sql stable security invoker
set search_path = public
as $$
  select coalesce(
    (select w.id from public.workspaces w
      where w.owner_id = (select auth.uid()) order by w.created_at limit 1),
    (select m.workspace_id from public.workspace_members m
      where m.user_id = (select auth.uid()) order by m.created_at limit 1)
  );
$$;

-- helper antigo em public não é mais referenciado por policy nenhuma
drop function if exists public.my_workspace_ids();
