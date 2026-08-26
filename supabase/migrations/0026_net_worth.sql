-- Patrimônio e investimentos.
--
-- Histórico por SNAPSHOT, não por reconstrução: saldo de conta dá para
-- reconstruir das transações, mas valor de imóvel/carro/investimento e saldo de
-- dívida não — não existe histórico deles. Então o cron tira uma foto por dia e
-- a série lê as fotos. O histórico começa quando o usuário começa a usar, e isso
-- é honesto; reconstruir seria inventar número.

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade
    default public.my_default_workspace(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  class text not null default 'other'
    check (class in ('investment','real_estate','vehicle','crypto','equity','receivable','other')),
  -- true = é passivo (financiamento sobre o bem, dívida com terceiro)
  is_liability boolean not null default false,
  current_value_cents bigint not null check (current_value_cents >= 0),
  acquired_at date,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create index if not exists assets_ws_idx on public.assets (workspace_id) where not archived;
alter table public.assets enable row level security;
drop policy if exists "workspace rows" on public.assets;
create policy "workspace rows" on public.assets for all
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));
drop trigger if exists set_updated_at on public.assets;
create trigger set_updated_at before update on public.assets
  for each row execute function extensions.moddatetime(updated_at);

create table if not exists public.asset_valuations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade
    default public.my_default_workspace(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  value_cents bigint not null check (value_cents >= 0),
  as_of date not null default current_date,
  created_at timestamptz not null default now(),
  unique (asset_id, as_of)
);
create index if not exists asset_valuations_asset_idx
  on public.asset_valuations (asset_id, as_of desc);
alter table public.asset_valuations enable row level security;
drop policy if exists "workspace rows" on public.asset_valuations;
create policy "workspace rows" on public.asset_valuations for all
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));

/** Atualiza o valor do ativo e guarda a marcação no histórico. */
create or replace function public.update_asset_value(
  p_asset_id uuid,
  p_value_cents bigint,
  p_as_of date default current_date
)
returns bigint
language plpgsql security invoker
set search_path = public
as $$
declare
  ativo record;
begin
  select a.* into ativo from public.assets a where a.id = p_asset_id;
  if ativo.id is null then
    raise exception 'ativo % nao encontrado', p_asset_id;
  end if;

  insert into public.asset_valuations (workspace_id, asset_id, value_cents, as_of)
  values (ativo.workspace_id, p_asset_id, p_value_cents, p_as_of)
  on conflict (asset_id, as_of) do update set value_cents = excluded.value_cents;

  update public.assets set current_value_cents = p_value_cents where id = p_asset_id;
  return p_value_cents;
end;
$$;

create table if not exists public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  as_of date not null default current_date,
  cash_cents bigint not null,
  investments_cents bigint not null,
  other_assets_cents bigint not null,
  liabilities_cents bigint not null,
  net_cents bigint not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, as_of)
);
create index if not exists net_worth_snapshots_ws_idx
  on public.net_worth_snapshots (workspace_id, as_of desc);
alter table public.net_worth_snapshots enable row level security;
drop policy if exists "workspace rows read" on public.net_worth_snapshots;
create policy "workspace rows read" on public.net_worth_snapshots
  for select using (workspace_id in (select private.my_workspace_ids()));

-- ⚠️ `private.net_worth_now` é redefinida na 0028 (o caixa passa a incluir
-- lançamentos sem conta). A versão final está lá.
create or replace function private.net_worth_now(ws_id uuid)
returns table(
  cash_cents bigint, investments_cents bigint, other_assets_cents bigint,
  liabilities_cents bigint, net_cents bigint
)
language sql stable
set search_path = public
as $$
  with dinheiro as (
    select coalesce(sum(
      a.initial_balance_cents + coalesce((
        select sum(case
          when t.kind = 'income'   and t.account_id = a.id then t.amount_cents
          when t.kind = 'expense'  and t.account_id = a.id then -t.amount_cents
          when t.kind = 'transfer' and t.account_id = a.id then -t.amount_cents
          when t.kind = 'transfer' and t.counterparty_account_id = a.id then t.amount_cents
          else 0 end)
        from public.transactions t
        where t.status = 'cleared'
          and (t.account_id = a.id or t.counterparty_account_id = a.id)
      ), 0)), 0)::bigint as cents
    from public.accounts a
    where a.workspace_id = ws_id and not a.archived and a.type <> 'credit_card'
  ),
  investimentos as (
    select coalesce(sum(current_value_cents), 0)::bigint as cents
    from public.assets
    where workspace_id = ws_id and not archived and not is_liability
      and class in ('investment','crypto','equity')
  ),
  outros as (
    select coalesce(sum(current_value_cents), 0)::bigint as cents
    from public.assets
    where workspace_id = ws_id and not archived and not is_liability
      and class not in ('investment','crypto','equity')
  ),
  passivos as (
    select (
      coalesce((select sum(current_value_cents) from public.assets
                where workspace_id = ws_id and not archived and is_liability), 0)
      + coalesce((select sum(remaining_cents) from public.debts
                  where workspace_id = ws_id and not archived), 0)
      + coalesce((select sum(t.amount_cents) from public.card_invoices ci
                  join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
                  where ci.workspace_id = ws_id and ci.status <> 'paid'), 0)
    )::bigint as cents
  )
  select d.cents, i.cents, o.cents, p.cents,
         (d.cents + i.cents + o.cents - p.cents)::bigint
  from dinheiro d, investimentos i, outros o, passivos p;
$$;
grant execute on function private.net_worth_now(uuid) to authenticated, service_role;

/** Tira a foto do dia de TODOS os workspaces (chamada pelo finance-scheduler). */
create or replace function public._snapshot_net_worth()
returns int
language sql security definer
set search_path = public
as $$
  with gravadas as (
    insert into public.net_worth_snapshots
      (workspace_id, as_of, cash_cents, investments_cents, other_assets_cents,
       liabilities_cents, net_cents)
    select w.id, current_date, n.cash_cents, n.investments_cents, n.other_assets_cents,
           n.liabilities_cents, n.net_cents
    from public.workspaces w
    cross join lateral private.net_worth_now(w.id) n
    on conflict (workspace_id, as_of) do update set
      cash_cents = excluded.cash_cents,
      investments_cents = excluded.investments_cents,
      other_assets_cents = excluded.other_assets_cents,
      liabilities_cents = excluded.liabilities_cents,
      net_cents = excluded.net_cents
    returning 1
  )
  select count(*)::int from gravadas;
$$;
revoke execute on function public._snapshot_net_worth() from public, anon, authenticated;

/** Patrimônio de hoje, calculado na hora (não depende do cron ter rodado). */
create or replace function public.net_worth()
returns table(
  cash_cents bigint, investments_cents bigint, other_assets_cents bigint,
  liabilities_cents bigint, net_cents bigint
)
language sql stable
set search_path = public
as $$
  select coalesce(sum(n.cash_cents), 0)::bigint,
         coalesce(sum(n.investments_cents), 0)::bigint,
         coalesce(sum(n.other_assets_cents), 0)::bigint,
         coalesce(sum(n.liabilities_cents), 0)::bigint,
         coalesce(sum(n.net_cents), 0)::bigint
  from private.my_workspace_ids() ws
  cross join lateral private.net_worth_now(ws) n;
$$;

/** Série histórica: uma linha por mês, a última foto de cada mês. */
create or replace function public.net_worth_series(months_back int default 12)
returns table(month date, net_cents bigint, liabilities_cents bigint)
language sql stable
set search_path = public
as $$
  select distinct on (date_trunc('month', s.as_of))
         date_trunc('month', s.as_of)::date,
         s.net_cents, s.liabilities_cents
  from public.net_worth_snapshots s
  where s.workspace_id in (select private.my_workspace_ids())
    and s.as_of >= (date_trunc('month', current_date)
                    - make_interval(months => least(greatest(coalesce(months_back, 12), 1), 60)))::date
  order by date_trunc('month', s.as_of), s.as_of desc;
$$;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'assets') then
    alter publication supabase_realtime add table public.assets;
  end if;
end $$;
