-- Pacote "pronto para a loja": aceite dos termos, consentimento de IA, versão do app em campo,
-- configuração remota (versão mínima/aviso) e notas internas do painel.
-- 1) profiles ganha o aceite, o consentimento de IA e o último ping do app. As RPCs gravam SÓ nessas
--    colunas do PRÓPRIO perfil (auth.uid()) e nunca tocam `phone`.
-- 2) public.app_config: uma linha, legível por anon (a tela de bloqueio abre antes do login), sem escrita
--    pelo cliente — o painel escreve pelo agente (papel postgres).
-- 3) public.admin_account_notes: nota interna do painel, inacessível ao app; some com a conta (FK cascade).
--    O token de push mora em profiles.expo_push_token e sai junto do perfil: apagar a conta já o leva.

alter table public.profiles
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists ai_consent_at timestamptz,
  add column if not exists last_app_version text,
  add column if not exists last_app_platform text check (last_app_platform in ('ios', 'android', 'web')),
  add column if not exists last_seen_at timestamptz;

create or replace function private.accept_terms(p_version text, p_ai_consent boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := (select auth.uid());
  v text := pg_catalog.btrim(p_version);
  r record;
begin
  if uid is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  if v is null or pg_catalog.char_length(v) not between 1 and 20 then
    raise exception 'versão dos termos inválida' using errcode = '22023';
  end if;
  update public.profiles p set
    terms_version = v,
    terms_accepted_at = pg_catalog.now(),
    ai_consent_at = case when coalesce(p_ai_consent, false) then coalesce(p.ai_consent_at, pg_catalog.now()) end
  where p.id = uid
  returning p.terms_version, p.terms_accepted_at, p.ai_consent_at into r;
  if not found then raise exception 'perfil não encontrado' using errcode = 'P0002'; end if;
  return pg_catalog.jsonb_build_object(
    'terms_version', r.terms_version, 'terms_accepted_at', r.terms_accepted_at, 'ai_consent_at', r.ai_consent_at);
end;
$$;
revoke execute on function private.accept_terms(text, boolean) from public, anon;
grant execute on function private.accept_terms(text, boolean) to authenticated;

create or replace function public.accept_terms(p_version text, p_ai_consent boolean)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.accept_terms(p_version, p_ai_consent);
$$;
revoke execute on function public.accept_terms(text, boolean) from public, anon;
grant execute on function public.accept_terms(text, boolean) to authenticated;

create or replace function private.set_ai_consent(p_consent boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := (select auth.uid());
  quando timestamptz;
begin
  if uid is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  update public.profiles p set
    ai_consent_at = case when coalesce(p_consent, false) then coalesce(p.ai_consent_at, pg_catalog.now()) end
  where p.id = uid
  returning p.ai_consent_at into quando;
  if not found then raise exception 'perfil não encontrado' using errcode = 'P0002'; end if;
  return pg_catalog.jsonb_build_object('ai_consent_at', quando);
end;
$$;
revoke execute on function private.set_ai_consent(boolean) from public, anon;
grant execute on function private.set_ai_consent(boolean) to authenticated;

create or replace function public.set_ai_consent(p_consent boolean)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_ai_consent(p_consent);
$$;
revoke execute on function public.set_ai_consent(boolean) from public, anon;
grant execute on function public.set_ai_consent(boolean) to authenticated;

create or replace function private.app_ping(p_version text, p_platform text)
returns void
language plpgsql security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := (select auth.uid());
  v text := pg_catalog.btrim(p_version);
begin
  if uid is null then raise exception 'sem sessão' using errcode = '28000'; end if;
  if v is null or pg_catalog.char_length(v) not between 1 and 20 then
    raise exception 'versão do app inválida' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android', 'web') then
    raise exception 'plataforma inválida' using errcode = '22023';
  end if;
  update public.profiles set last_app_version = v, last_app_platform = p_platform, last_seen_at = pg_catalog.now()
  where id = uid;
end;
$$;
revoke execute on function private.app_ping(text, text) from public, anon;
grant execute on function private.app_ping(text, text) to authenticated;

create or replace function public.app_ping(p_version text, p_platform text)
returns void language sql security invoker set search_path = '' as $$
  select private.app_ping(p_version, p_platform);
$$;
revoke execute on function public.app_ping(text, text) from public, anon;
grant execute on function public.app_ping(text, text) to authenticated;

create table if not exists public.app_config (
  id smallint primary key default 1 check (id = 1),
  min_version_ios text, min_version_android text,
  latest_version_ios text, latest_version_android text,
  store_url_ios text, store_url_android text,
  notice_title text, notice_body text,
  notice_level text check (notice_level in ('info', 'warning', 'critical')),
  notice_until timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.app_config enable row level security;
revoke all on public.app_config from public, anon, authenticated;
grant select on public.app_config to anon, authenticated;
drop policy if exists "app_config: leitura publica" on public.app_config;
create policy "app_config: leitura publica" on public.app_config
  for select to anon, authenticated using (true);
insert into public.app_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.admin_account_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  admin_user_id uuid not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists admin_account_notes_user_idx on public.admin_account_notes (user_id, created_at desc);
alter table public.admin_account_notes enable row level security;
revoke all on public.admin_account_notes from public, anon, authenticated;
