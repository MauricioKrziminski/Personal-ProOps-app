-- Fundação multi-tenant: workspaces + membros.
-- O escopo de dado deixa de ser o usuário e passa a ser o WORKSPACE (permite
-- casal/família/PJ na mesma conta). `user_id` continua em todas as tabelas como
-- AUTOR do lançamento; quem decide visibilidade agora é `workspace_id`.
--
-- Ordem: cria tabelas -> helpers -> coluna em cada tabela -> backfill ->
-- not null -> troca policies -> reescreve RPCs (0011) -> dropa `categories`.
-- Idempotente: pode rodar duas vezes sem efeito colateral.

-- ── workspaces ───────────────────────────────────────────────────────────────
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Pessoal',
  owner_id uuid not null references public.profiles(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','pro','family')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workspaces_owner_idx on public.workspaces (owner_id);
alter table public.workspaces enable row level security;

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members (user_id);
alter table public.workspace_members enable row level security;

-- ── helpers de escopo ────────────────────────────────────────────────────────
-- security definer para não recursar no RLS de workspace_members quando a
-- própria policy de workspace_members precisar consultá-la.
-- Esta é a ÚNICA função definer que `authenticated` pode executar: ela só
-- enxerga as linhas de quem chamou (auth.uid() por dentro), nunca aceita uid.
create or replace function public.my_workspace_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select m.workspace_id from public.workspace_members m
  where m.user_id = (select auth.uid());
$$;
revoke execute on function public.my_workspace_ids() from public, anon;
grant execute on function public.my_workspace_ids() to authenticated, service_role;

-- workspace padrão do app (usado como DEFAULT das colunas: inserts do app não
-- precisam mandar workspace_id). Retorna null p/ service_role (auth.uid() null)
-- e aí o not null estoura de propósito — Edge Function tem que ser explícita.
create or replace function public.my_default_workspace()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select w.id from public.workspaces w
      where w.owner_id = (select auth.uid()) order by w.created_at limit 1),
    (select m.workspace_id from public.workspace_members m
      where m.user_id = (select auth.uid()) order by m.created_at limit 1)
  );
$$;
revoke execute on function public.my_default_workspace() from public, anon;
grant execute on function public.my_default_workspace() to authenticated, service_role;

-- versões p/ Edge Functions (recebem o uid resolvido do telefone): service_role
create or replace function public._workspace_ids(uid uuid)
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select m.workspace_id from public.workspace_members m where m.user_id = uid;
$$;
revoke execute on function public._workspace_ids(uuid) from public, anon, authenticated;

create or replace function public._default_workspace(uid uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select w.id from public.workspaces w where w.owner_id = uid
      order by w.created_at limit 1),
    (select m.workspace_id from public.workspace_members m where m.user_id = uid
      order by m.created_at limit 1)
  );
$$;
revoke execute on function public._default_workspace(uuid) from public, anon, authenticated;

-- ── policies de workspaces/membros ───────────────────────────────────────────
drop policy if exists "workspaces: members read" on public.workspaces;
create policy "workspaces: members read" on public.workspaces
  for select using (id in (select public.my_workspace_ids()));

drop policy if exists "workspaces: owner writes" on public.workspaces;
create policy "workspaces: owner writes" on public.workspaces
  for all using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "members: read own workspaces" on public.workspace_members;
create policy "members: read own workspaces" on public.workspace_members
  for select using (workspace_id in (select public.my_workspace_ids()));

drop policy if exists "members: owner manages" on public.workspace_members;
create policy "members: owner manages" on public.workspace_members
  for all using (exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())))
  with check (exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())));

-- ── backfill: um workspace pessoal por profile ───────────────────────────────
insert into public.workspaces (name, owner_id)
select 'Pessoal', p.id from public.profiles p
where not exists (select 1 from public.workspaces w where w.owner_id = p.id);

insert into public.workspace_members (workspace_id, user_id, role)
select w.id, w.owner_id, 'owner' from public.workspaces w
on conflict (workspace_id, user_id) do nothing;

-- ── coluna workspace_id em todas as tabelas de dado do usuário ──────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'notes','reminders','transactions','accounts','goals','budgets','recurring_transactions'
  ] loop
    execute format(
      'alter table public.%I add column if not exists workspace_id uuid
         references public.workspaces(id) on delete cascade', t);
    execute format(
      'update public.%I x set workspace_id = w.id from public.workspaces w
         where w.owner_id = x.user_id and x.workspace_id is null', t);
    execute format('alter table public.%I alter column workspace_id set not null', t);
    execute format(
      'alter table public.%I alter column workspace_id set default public.my_default_workspace()', t);
    execute format(
      'create index if not exists %I on public.%I (workspace_id)', t || '_ws_idx', t);
  end loop;
end $$;

-- unique constraints passam a ser por workspace (nome de conta/meta e categoria
-- de orçamento são únicos dentro da conta compartilhada, não por pessoa)
alter table public.accounts drop constraint if exists accounts_user_id_name_key;
alter table public.goals drop constraint if exists goals_user_id_name_key;
alter table public.budgets drop constraint if exists budgets_user_id_category_key;
create unique index if not exists accounts_ws_name_key on public.accounts (workspace_id, name);
create unique index if not exists goals_ws_name_key on public.goals (workspace_id, name);
create unique index if not exists budgets_ws_category_key on public.budgets (workspace_id, category);

-- índice quente do dashboard agora é por workspace
create index if not exists transactions_ws_occurred_idx
  on public.transactions (workspace_id, occurred_at desc);

-- ── policies das tabelas de dado: own-rows -> workspace ─────────────────────
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array[
    'notes','reminders','transactions','accounts','goals','budgets','recurring_transactions'
  ] loop
    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;
    execute format(
      'create policy "workspace rows" on public.%I for all
         using (workspace_id in (select public.my_workspace_ids()))
         with check (workspace_id in (select public.my_workspace_ids()))', t);
  end loop;
end $$;

-- ── signup cria profile + workspace pessoal + membership ────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ws_id uuid;
begin
  insert into public.profiles (id, phone)
  values (new.id, coalesce(new.phone, ''))
  on conflict (id) do nothing;

  select w.id into ws_id from public.workspaces w where w.owner_id = new.id
  order by w.created_at limit 1;

  if ws_id is null then
    insert into public.workspaces (name, owner_id) values ('Pessoal', new.id)
    returning id into ws_id;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ── `categories` legada: zero leituras no app e nas functions (docs/PENDENCIAS)
drop table if exists public.categories;
