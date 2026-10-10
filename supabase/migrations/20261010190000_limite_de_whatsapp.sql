-- Limite de uso do WhatsApp (CUSTOS-E-PRECOS §6). A unidade é a RESPOSTA ENVIADA ao telefone (é o que a Meta
-- cobra), não o turno de IA: `whatsapp_sends` guarda uma linha por envio feito pelo agente.
--   reply  = resposta no WhatsApp (try_send / try_send_interactive do worker)
--   notice = aviso ou lembrete proativo (send_template)
-- Limites: sem assinatura 0/0 · Pro 150 respostas/mês e 1 aviso/dia · Família 300 e 2 · teste de 7 dias: respostas 40.

create table if not exists public.whatsapp_sends (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid,
  kind text not null check (kind in ('reply', 'notice')),
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_sends_ws_idx on public.whatsapp_sends (workspace_id, kind, created_at);
-- infra: RLS ligada SEM policy. Só o agente (papel que ignora RLS) escreve e lê.
alter table public.whatsapp_sends enable row level security;
revoke all on public.whatsapp_sends from public, anon, authenticated;

-- ── limites ───────────────────────────────────────────────────────────────────────────────────────────
drop function if exists private.plan_limits(text, boolean);
create function private.plan_limits(p_plan text, p_trial boolean default false)
returns table(max_members int, max_ai_messages_month int, can_import boolean,
              max_whatsapp_replies_month int, max_whatsapp_notices_day int)
language sql immutable
set search_path = public
as $$
  select l.max_members,
         case when coalesce(p_trial, false) then least(l.max_ai_messages_month, 60)
              else l.max_ai_messages_month end,
         l.can_import,
         case when coalesce(p_trial, false) then least(l.replies, 40) else l.replies end,
         l.notices
  from (values
    ('free',   1, 0,    false, 0,   0),
    ('pro',    1, 400,  true,  150, 1),
    ('family', 5, 1000, true,  300, 2)
  ) as l(plan, max_members, max_ai_messages_month, can_import, replies, notices)
  where l.plan = coalesce(p_plan, 'free');
$$;
revoke execute on function private.plan_limits(text, boolean) from public, anon;
grant execute on function private.plan_limits(text, boolean) to authenticated, service_role;

-- ── plan_status_for + 4 colunas NO FIM (corpo da 20261010180000) ──────────────────────────────────────
drop function if exists public.plan_status();
drop function if exists public._plan_status(uuid);
drop function if exists private.plan_status_for(uuid);

-- Mês e dia dos contadores são LOCAIS (America/Sao_Paulo): o `set timezone` do cabeçalho vale para o
-- `now()` do recorte (inclusive o do uso de IA, que antes cortava o mês no UTC).
create function private.plan_status_for(ws_id uuid)
returns table(
  plan text, status text, current_period_end date, is_trial boolean, provider text,
  members int, max_members int,
  ai_messages_month int, ai_messages_whatsapp int, ai_messages_app int,
  max_ai_messages_month int, can_import boolean,
  access text,
  whatsapp_replies_month int, max_whatsapp_replies_month int,
  whatsapp_notices_today int, max_whatsapp_notices_day int
)
language sql stable
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $fn$
  with assinatura as (
    select private.effective_plan(ws_id) as plan,
           coalesce(s.plan, 'free') as plan_bruto,
           coalesce(s.status, 'active') as status_bruto,
           s.current_period_end,
           coalesce(s.is_trial, false) as is_trial,
           s.provider
    from public.workspaces w
    left join public.subscriptions s on s.workspace_id = w.id
    where w.id = ws_id
  ),
  limites as (
    select * from private.plan_limits((select plan from assinatura), (select is_trial from assinatura))
  ),
  uso as (
    select
      (select count(*)::int from public.workspace_members m
       where m.workspace_id = ws_id) as membros,
      count(e.id)::int as mensagens,
      count(e.id) filter (where e.channel = 'whatsapp')::int as mensagens_whatsapp,
      count(e.id) filter (where e.channel = 'app')::int as mensagens_app
    from public.ai_events e
    where e.workspace_id = ws_id
      and e.kind = 'turn'
      and e.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
  ),
  envios as (
    select
      count(*) filter (where s.kind = 'reply'
        and s.created_at >= pg_catalog.date_trunc('month', pg_catalog.now()))::int as respostas,
      count(*) filter (where s.kind = 'notice'
        and s.created_at >= pg_catalog.date_trunc('day', pg_catalog.now()))::int as avisos
    from public.whatsapp_sends s
    where s.workspace_id = ws_id
      and s.created_at >= pg_catalog.date_trunc('month', pg_catalog.now())
  )
  select a.plan,
         case when a.plan = 'free' and a.plan_bruto <> 'free' then 'expired'
              else a.status_bruto end,
         a.current_period_end, a.is_trial, a.provider,
         u.membros, l.max_members,
         u.mensagens, u.mensagens_whatsapp, u.mensagens_app,
         l.max_ai_messages_month, l.can_import,
         case when a.plan <> 'free' then 'subscriber'
              when a.provider is null then 'never'
              else 'lapsed' end,
         v.respostas, l.max_whatsapp_replies_month,
         v.avisos, l.max_whatsapp_notices_day
  from assinatura a, limites l, uso u, envios v;
$fn$;
revoke execute on function private.plan_status_for(uuid) from public, anon, authenticated;
grant execute on function private.plan_status_for(uuid) to service_role;

create function public._plan_status(ws_id uuid)
returns table(
  plan text, status text, current_period_end date, is_trial boolean, provider text,
  members int, max_members int,
  ai_messages_month int, ai_messages_whatsapp int, ai_messages_app int,
  max_ai_messages_month int, can_import boolean,
  access text,
  whatsapp_replies_month int, max_whatsapp_replies_month int,
  whatsapp_notices_today int, max_whatsapp_notices_day int
)
language sql stable security definer
set search_path = ''
as $fn$
  select * from private.plan_status_for(ws_id);
$fn$;
revoke execute on function public._plan_status(uuid) from public, anon, authenticated;
grant execute on function public._plan_status(uuid) to service_role;

create function public.plan_status()
returns table(
  plan text, status text, current_period_end date, is_trial boolean, provider text,
  members int, max_members int,
  ai_messages_month int, ai_messages_whatsapp int, ai_messages_app int,
  max_ai_messages_month int, can_import boolean,
  access text,
  whatsapp_replies_month int, max_whatsapp_replies_month int,
  whatsapp_notices_today int, max_whatsapp_notices_day int
)
language sql stable security definer
set search_path = ''
as $fn$
  with alvo as (
    select public.my_default_workspace() as workspace_id
  )
  select p.*
  from alvo a
  cross join lateral private.plan_status_for(a.workspace_id) p
  where a.workspace_id is not null
    and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = a.workspace_id
        and m.user_id = (select auth.uid())
    );
$fn$;
revoke execute on function public.plan_status() from public, anon;
grant execute on function public.plan_status() to authenticated, service_role;
