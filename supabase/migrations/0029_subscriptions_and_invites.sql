-- Camada comercial: plano, limites, convite de membro e cancelamento.
--
-- A cobrança em si (Stripe/Kiwify/...) NÃO está aqui: `provider` e `external_id`
-- guardam o vínculo e o webhook do provedor entra quando o provedor for
-- escolhido. Até lá o plano é definido manualmente e o resto do produto já
-- respeita os limites.
--
-- O vínculo do produto é o TELEFONE (o mesmo do WhatsApp), então o convite de
-- membro é por telefone, não por e-mail.
--
-- ⚠️ Em `returns table(...)`, um `select *` sobre VALUES precisa projetar
-- exatamente as colunas declaradas — por isso `plan_limits` lista as colunas.

create table if not exists public.subscriptions (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','pro','family')),
  status text not null default 'active'
    check (status in ('trialing','active','past_due','canceled')),
  provider text,
  external_id text,
  current_period_end date,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists "subscriptions: members read" on public.subscriptions;
create policy "subscriptions: members read" on public.subscriptions
  for select using (workspace_id in (select private.my_workspace_ids()));
drop policy if exists "subscriptions: owner writes" on public.subscriptions;
create policy "subscriptions: owner writes" on public.subscriptions
  for all using (exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())))
  with check (exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())));
drop trigger if exists set_updated_at on public.subscriptions;
create trigger set_updated_at before update on public.subscriptions
  for each row execute function extensions.moddatetime(updated_at);

insert into public.subscriptions (workspace_id)
select w.id from public.workspaces w
where not exists (select 1 from public.subscriptions s where s.workspace_id = w.id);

/** Limites por plano, em UM lugar só. */
create or replace function private.plan_limits(p_plan text)
returns table(max_members int, max_ai_messages_month int, can_import boolean)
language sql immutable
set search_path = public
as $$
  select l.max_members, l.max_ai_messages_month, l.can_import
  from (values
    ('free',   1, 100,  false),
    ('pro',    3, 1000, true),
    ('family', 5, 2000, true)
  ) as l(plan, max_members, max_ai_messages_month, can_import)
  where l.plan = coalesce(p_plan, 'free');
$$;
grant execute on function private.plan_limits(text) to authenticated, service_role;

/** Plano + consumo do mês + limites: uma chamada serve a tela e o gate da IA. */
create or replace function private.plan_status_for(ws_id uuid)
returns table(
  plan text, status text, current_period_end date,
  members int, max_members int,
  ai_messages_month int, max_ai_messages_month int,
  can_import boolean
)
language sql stable
set search_path = public
as $$
  with assinatura as (
    select coalesce(s.plan, 'free') as plan,
           coalesce(s.status, 'active') as status,
           s.current_period_end
    from public.workspaces w
    left join public.subscriptions s on s.workspace_id = w.id
    where w.id = ws_id
  ),
  limites as (select * from private.plan_limits((select plan from assinatura))),
  uso as (
    select (select count(*)::int from public.workspace_members m where m.workspace_id = ws_id) as membros,
           (select count(*)::int from public.ai_events e
             join public.workspace_members m on m.user_id = e.user_id and m.workspace_id = ws_id
            where e.created_at >= date_trunc('month', now())) as mensagens
  )
  select a.plan, a.status, a.current_period_end,
         u.membros, l.max_members,
         u.mensagens, l.max_ai_messages_month,
         l.can_import
  from assinatura a, limites l, uso u;
$$;
grant execute on function private.plan_status_for(uuid) to authenticated, service_role;

create or replace function public.plan_status()
returns table(
  plan text, status text, current_period_end date,
  members int, max_members int,
  ai_messages_month int, max_ai_messages_month int,
  can_import boolean
)
language sql stable
set search_path = public
as $$
  select p.* from private.plan_status_for(public.my_default_workspace()) p;
$$;

create or replace function public._plan_status(ws_id uuid)
returns table(
  plan text, status text, current_period_end date,
  members int, max_members int,
  ai_messages_month int, max_ai_messages_month int,
  can_import boolean
)
language sql stable security definer
set search_path = public
as $$
  select * from private.plan_status_for(ws_id);
$$;
revoke execute on function public._plan_status(uuid) from public, anon, authenticated;

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  phone text not null,
  role text not null default 'member' check (role in ('member','viewer')),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (workspace_id, phone)
);
create index if not exists workspace_invites_phone_idx
  on public.workspace_invites (phone) where status = 'pending';
alter table public.workspace_invites enable row level security;
drop policy if exists "invites: owner manages" on public.workspace_invites;
create policy "invites: owner manages" on public.workspace_invites
  for all using (exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())))
  with check (exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_id = (select auth.uid())));

/**
 * Aceita os convites pendentes do telefone de quem chamou.
 * Respeita o limite de membros do plano DO CONVIDANTE — senão daria para lotar
 * uma conta free de gente.
 */
create or replace function public.accept_pending_invites()
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  meu_telefone text;
  convite record;
  aceitos int := 0;
  limites record;
begin
  select p.phone into meu_telefone from public.profiles p where p.id = (select auth.uid());
  if meu_telefone is null then return 0; end if;

  for convite in
    select * from public.workspace_invites
    where phone = meu_telefone and status = 'pending'
  loop
    select * into limites from private.plan_status_for(convite.workspace_id);
    if limites.members >= limites.max_members then
      continue; -- fica pendente até o dono subir de plano
    end if;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (convite.workspace_id, (select auth.uid()), convite.role)
    on conflict (workspace_id, user_id) do nothing;

    update public.workspace_invites
    set status = 'accepted', accepted_at = now()
    where id = convite.id;
    aceitos := aceitos + 1;
  end loop;

  return aceitos;
end;
$$;
grant execute on function public.accept_pending_invites() to authenticated;

/**
 * Cancelamento self-service.
 * É de propósito que seja UMA chamada, sem formulário e sem falar com ninguém:
 * dificultar cancelamento é a reclamação nº1 contra os concorrentes no Reclame
 * Aqui, e não vamos repetir isso.
 */
create or replace function public.cancel_subscription()
returns text
language plpgsql security invoker
set search_path = public
as $$
declare
  ws_id uuid;
begin
  select w.id into ws_id from public.workspaces w
  where w.owner_id = (select auth.uid()) order by w.created_at limit 1;
  if ws_id is null then
    raise exception 'nenhum espaco encontrado';
  end if;

  update public.subscriptions
  set status = 'canceled', canceled_at = now()
  where workspace_id = ws_id;

  return 'cancelado';
end;
$$;

-- signup passa a criar a assinatura free e a aceitar convite feito ANTES do cadastro
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ws_id uuid;
  telefone text;
begin
  telefone := coalesce(new.phone, '');

  insert into public.profiles (id, phone)
  values (new.id, telefone)
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

  insert into public.subscriptions (workspace_id)
  values (ws_id)
  on conflict (workspace_id) do nothing;

  insert into public.workspace_members (workspace_id, user_id, role)
  select i.workspace_id, new.id, i.role
  from public.workspace_invites i
  where i.phone = telefone and i.status = 'pending'
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invites
  set status = 'accepted', accepted_at = now()
  where phone = telefone and status = 'pending';

  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
