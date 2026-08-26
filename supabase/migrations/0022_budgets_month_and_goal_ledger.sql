-- Orçamento por mês (com rollover) e ledger de aportes em metas.
--
-- Orçamento: `month` null = limite padrão; uma linha com `month` preenchido
-- sobrescreve só aquele mês. São DOIS unique parciais porque no Postgres NULL
-- não colide com NULL — sem isso daria para cadastrar dez limites padrão para a
-- mesma categoria. Rollover soma a sobra do mês anterior (um nível só: acumular
-- indefinidamente vira um número que ninguém consegue explicar).
--
-- Metas: `saved_cents` era read-modify-write no app (corrida) e sem histórico.
-- Agora o aporte é uma linha em `goal_contributions` e o saldo é a SOMA do
-- ledger. Aporte NÃO vira transação: é movimento entre contas do próprio
-- usuário, e lançar como despesa inflaria o gasto do mês.
--
-- ⚠️ Mudar o shape de um `returns table` exige DROP antes do CREATE.

alter table public.budgets
  add column if not exists month date,
  add column if not exists rollover boolean not null default false;

comment on column public.budgets.month is
  'primeiro dia do mes que este limite sobrescreve. null = limite padrao.';
comment on column public.budgets.rollover is
  'true = o que sobrou do mes anterior soma no limite deste mes (envelope).';

drop index if exists budgets_ws_category_key;
create unique index if not exists budgets_ws_category_default_key
  on public.budgets (workspace_id, category) where month is null;
create unique index if not exists budgets_ws_category_month_key
  on public.budgets (workspace_id, category, month) where month is not null;

create or replace function private.budgets_status_for(ws_ids uuid[], ref_month date)
returns table(
  category text, limit_cents bigint, spent_cents bigint,
  base_limit_cents bigint, rollover_cents bigint, rollover boolean, month date
)
language sql stable
set search_path = public
as $$
  with mes as (
    select date_trunc('month', ref_month)::date as inicio,
           (date_trunc('month', ref_month) + interval '1 month')::date as fim,
           (date_trunc('month', ref_month) - interval '1 month')::date as anterior
  ),
  efetivos as (
    select distinct on (b.category)
           b.category, b.limit_cents, b.rollover, b.month
    from public.budgets b, mes m
    where b.workspace_id = any(ws_ids)
      and (b.month is null or b.month = m.inicio)
    order by b.category, b.month nulls last
  ),
  gasto as (
    select coalesce(t.category, 'outros') as category,
           sum(t.amount_cents)::bigint as cents
    from public.transactions t, mes m
    where t.workspace_id = any(ws_ids)
      and t.kind = 'expense'
      and t.occurred_at >= m.inicio and t.occurred_at < m.fim
    group by 1
  ),
  gasto_anterior as (
    select coalesce(t.category, 'outros') as category,
           sum(t.amount_cents)::bigint as cents
    from public.transactions t, mes m
    where t.workspace_id = any(ws_ids)
      and t.kind = 'expense'
      and t.occurred_at >= m.anterior and t.occurred_at < m.inicio
    group by 1
  ),
  limite_anterior as (
    select distinct on (b.category) b.category, b.limit_cents
    from public.budgets b, mes m
    where b.workspace_id = any(ws_ids)
      and (b.month is null or b.month = m.anterior)
    order by b.category, b.month nulls last
  )
  select e.category,
         (e.limit_cents + case
            when e.rollover then greatest(
              coalesce(la.limit_cents, 0) - coalesce(ga.cents, 0), 0)
            else 0 end)::bigint as limit_cents,
         coalesce(g.cents, 0)::bigint as spent_cents,
         e.limit_cents as base_limit_cents,
         (case when e.rollover then greatest(
            coalesce(la.limit_cents, 0) - coalesce(ga.cents, 0), 0)
         else 0 end)::bigint as rollover_cents,
         e.rollover,
         e.month
  from efetivos e
  left join gasto g on g.category = e.category
  left join gasto_anterior ga on ga.category = e.category
  left join limite_anterior la on la.category = e.category
  order by 3 desc;
$$;
grant execute on function private.budgets_status_for(uuid[], date) to authenticated, service_role;

drop function if exists public._budgets_status(uuid, date);
create function public._budgets_status(uid uuid, ref_month date default current_date)
returns table(
  category text, limit_cents bigint, spent_cents bigint,
  base_limit_cents bigint, rollover_cents bigint, rollover boolean, month date
)
language sql stable security definer
set search_path = public
as $$
  select * from private.budgets_status_for(
    array(select public._workspace_ids(uid)), ref_month);
$$;
revoke execute on function public._budgets_status(uuid, date) from public, anon, authenticated;

drop function if exists public.budgets_status(date);
create function public.budgets_status(ref_month date default current_date)
returns table(
  category text, limit_cents bigint, spent_cents bigint,
  base_limit_cents bigint, rollover_cents bigint, rollover boolean, month date
)
language sql stable
set search_path = public
as $$
  select * from private.budgets_status_for(
    array(select private.my_workspace_ids()), ref_month);
$$;

create table if not exists public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade
    default public.my_default_workspace(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  amount_cents bigint not null check (amount_cents <> 0),
  occurred_at date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists goal_contributions_goal_idx
  on public.goal_contributions (goal_id, occurred_at desc);
alter table public.goal_contributions enable row level security;
drop policy if exists "workspace rows" on public.goal_contributions;
create policy "workspace rows" on public.goal_contributions for all
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));

-- backfill: o saldo que já existia vira o primeiro aporte, para o histórico não
-- começar mentindo
insert into public.goal_contributions (workspace_id, user_id, goal_id, amount_cents, occurred_at, note)
select g.workspace_id, g.user_id, g.id, g.saved_cents, g.created_at::date, 'saldo inicial'
from public.goals g
where g.saved_cents > 0
  and not exists (select 1 from public.goal_contributions c where c.goal_id = g.id);

create or replace function public.goal_deposit(
  p_goal_id uuid,
  p_amount_cents bigint,
  p_occurred_at date default current_date,
  p_note text default null
)
returns bigint
language plpgsql security invoker
set search_path = public
as $$
declare
  meta record;
  novo bigint;
begin
  select g.* into meta from public.goals g where g.id = p_goal_id;
  if meta.id is null then
    raise exception 'meta % nao encontrada', p_goal_id;
  end if;
  if p_amount_cents = 0 then
    raise exception 'aporte precisa ser diferente de zero';
  end if;

  insert into public.goal_contributions
    (workspace_id, user_id, goal_id, amount_cents, occurred_at, note)
  values (meta.workspace_id, coalesce((select auth.uid()), meta.user_id),
          p_goal_id, p_amount_cents, p_occurred_at, p_note);

  select greatest(coalesce(sum(c.amount_cents), 0), 0)::bigint into novo
  from public.goal_contributions c where c.goal_id = p_goal_id;

  update public.goals set saved_cents = novo where id = p_goal_id;
  return novo;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'goal_contributions') then
    alter publication supabase_realtime add table public.goal_contributions;
  end if;
end $$;
