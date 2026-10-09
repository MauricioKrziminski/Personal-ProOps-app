-- Observabilidade: erros agrupados por fingerprint (docs/ADMIN-API.md, seção Observabilidade).
-- RLS ligada sem policy e sem grant: só o papel do agente lê/escreve. Sem `workspace_id` de propósito
-- (a asserção (e) de sem_assinatura.sql varre esse nome). `error_events.user_id` tem FK `set null` para
-- auth.users: apagar a conta anula o autor do erro por qualquer caminho, sem tocar em `apagar_conta`.
create table public.error_issues (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  source text not null check (source in ('app', 'admin', 'agent')),
  kind text not null check (kind in ('crash', 'error', 'unhandled_rejection', 'render')),
  severity text not null check (severity in ('critical', 'error', 'warning')),
  title text not null,
  message text not null default '',
  route text,
  stack text,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  count bigint not null default 1,
  last_app_version text,
  platforms text[] not null default '{}',
  resolved_at timestamptz,
  resolved_by uuid
);
create index error_issues_status_last_seen_idx on public.error_issues (status, last_seen desc);
create index error_issues_last_seen_idx on public.error_issues (last_seen desc);
create index error_issues_count_idx on public.error_issues (count desc);
create index error_issues_first_seen_idx on public.error_issues (first_seen desc);

create table public.error_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.error_issues (id) on delete cascade,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  platform text,
  app_version text,
  route text,
  message text not null default '',
  context jsonb not null default '{}'
);
create index error_events_issue_idx on public.error_events (issue_id, created_at desc);
create index error_events_created_idx on public.error_events (created_at desc);
create index error_events_user_idx on public.error_events (user_id) where user_id is not null;

alter table public.error_issues enable row level security;
alter table public.error_events enable row level security;
revoke all on public.error_issues, public.error_events from public, anon, authenticated;

-- Upsert atômico: agrupa pelo fingerprint, conta, atualiza last_seen e REABRE a resolvida
-- (`ignored` continua ignorada mas conta). Grava o evento junto. Devolve o id do issue.
create function private.registrar_erro(
  p_fingerprint text, p_source text, p_kind text, p_severity text, p_title text, p_message text,
  p_route text, p_stack text, p_user uuid, p_platform text, p_app_version text, p_context jsonb
) returns uuid
language plpgsql security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  iid uuid;
  uid uuid := null;
begin
  -- token de conta já apagada não pode derrubar a gravação por causa da FK
  if p_user is not null then
    select u.id into uid from auth.users u where u.id = p_user;
  end if;

  insert into public.error_issues as i
    (fingerprint, source, kind, severity, title, message, route, stack, last_app_version, platforms)
  values
    (p_fingerprint, p_source, p_kind, p_severity, p_title, p_message, p_route, p_stack, p_app_version,
     case when p_platform is null then '{}'::text[] else array[p_platform] end)
  on conflict (fingerprint) do update set
    count = i.count + 1,
    last_seen = pg_catalog.now(),
    message = excluded.message,
    route = coalesce(excluded.route, i.route),
    stack = coalesce(i.stack, excluded.stack),
    last_app_version = coalesce(excluded.last_app_version, i.last_app_version),
    severity = case
      when pg_catalog.array_position(array['warning', 'error', 'critical'], excluded.severity)
         > pg_catalog.array_position(array['warning', 'error', 'critical'], i.severity) then excluded.severity
      else i.severity end,
    platforms = case
      when p_platform is null or p_platform = any (i.platforms) then i.platforms
      else i.platforms || p_platform end,
    status = case when i.status = 'resolved' then 'open' else i.status end,
    resolved_at = case when i.status = 'resolved' then null else i.resolved_at end,
    resolved_by = case when i.status = 'resolved' then null else i.resolved_by end
  returning i.id into iid;

  insert into public.error_events (issue_id, user_id, platform, app_version, route, message, context)
  values (iid, uid, p_platform, p_app_version, p_route, p_message, coalesce(p_context, '{}'));
  return iid;
end;
$$;
revoke execute on function private.registrar_erro(text, text, text, text, text, text, text, text, uuid, text, text, jsonb)
  from public, anon, authenticated;
