-- Travas do pacote de consentimento (revisão de 09/10/2026), sobre a 20261010230000.
-- 1) As seis colunas de aceite/consentimento/ping de `profiles` só mudam pelas RPCs (definer) ou pelo agente:
--    um UPDATE direto do app (policy "own row" deixa) volta ao valor antigo. A distinção é `current_user`:
--    no PostgREST a requisição roda `set role authenticated`; dentro de uma função security definer ele é o dono
--    (postgres). `session_user` NÃO serve: continua `authenticator` dentro da RPC e travaria as próprias RPCs.
-- 2) app_config: o app lê só as colunas públicas (sem `updated_by`, o id do admin).
-- 3) app_ping aceita só semver (MAJOR.MINOR.PATCH), o que `nativeApplicationVersion` manda.
create or replace function private.profiles_trava_consentimento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.terms_version := old.terms_version;
    new.terms_accepted_at := old.terms_accepted_at;
    new.ai_consent_at := old.ai_consent_at;
    new.last_app_version := old.last_app_version;
    new.last_app_platform := old.last_app_platform;
    new.last_seen_at := old.last_seen_at;
  end if;
  return new;
end;
$$;
revoke execute on function private.profiles_trava_consentimento() from public, anon, authenticated;

drop trigger if exists profiles_trava_consentimento on public.profiles;
create trigger profiles_trava_consentimento
  before update on public.profiles
  for each row execute function private.profiles_trava_consentimento();

revoke select on public.app_config from anon, authenticated;
grant select (id, min_version_ios, min_version_android, latest_version_ios, latest_version_android,
              store_url_ios, store_url_android, notice_title, notice_body, notice_level, notice_until, updated_at)
  on public.app_config to anon, authenticated;

-- corpo da 20261010230000 mantido (security definer, search_path, fuso, uid, plataforma); só a versão endurece
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
  if v is null or pg_catalog.char_length(v) not between 1 and 20 or v !~ '^\d+\.\d+\.\d+$' then
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
