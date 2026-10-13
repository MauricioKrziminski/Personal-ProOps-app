-- Contato comercial com opção de sair (13/10/2026, Política de Privacidade §2-A).
-- Base: legítimo interesse (LGPD art. 7º, IX). Quem cria a conta pode receber novidades e ofertas por
-- e-mail até pedir para sair, e o pedido fica com a DATA (respeitado também em listas montadas depois).
-- 1) `marketing_opt_out_at`: null = aceita; com data = pediu para não receber.
-- 2) `marketing_token`: segredo aleatório por pessoa, para o link de descadastro de cada e-mail
--    (`/contato/sair/<token>`, servido pelo agente) funcionar sem login. Não é credencial de nada além disso.
-- 3) `set_marketing_contact`: o app grava SÓ essa coluna do PRÓPRIO perfil (auth.uid()), como `set_ai_consent`.

alter table public.profiles
  add column if not exists marketing_opt_out_at timestamptz,
  add column if not exists marketing_token uuid not null default gen_random_uuid();
create unique index if not exists profiles_marketing_token_key on public.profiles (marketing_token);

create or replace function private.set_marketing_contact(p_accept boolean)
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
  if p_accept is null then raise exception 'escolha obrigatória' using errcode = '22023'; end if;
  update public.profiles p set
    marketing_opt_out_at = case when p_accept then null else coalesce(p.marketing_opt_out_at, pg_catalog.now()) end
  where p.id = uid
  returning p.marketing_opt_out_at into quando;
  if not found then raise exception 'perfil não encontrado' using errcode = 'P0002'; end if;
  return pg_catalog.jsonb_build_object('marketing_opt_out_at', quando);
end;
$$;
revoke execute on function private.set_marketing_contact(boolean) from public, anon;
grant execute on function private.set_marketing_contact(boolean) to authenticated;

create or replace function public.set_marketing_contact(p_accept boolean)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_marketing_contact(p_accept);
$$;
revoke execute on function public.set_marketing_contact(boolean) from public, anon;
grant execute on function public.set_marketing_contact(boolean) to authenticated;

-- A preferência e o token só mudam pela RPC (ou pelo agente, no descadastro pelo link): o UPDATE direto do app
-- volta ao valor antigo, como as colunas de consentimento. Corpo da 20261010231000 repetido inteiro.
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
    new.marketing_opt_out_at := old.marketing_opt_out_at;
    new.marketing_token := old.marketing_token;
  end if;
  return new;
end;
$$;
revoke execute on function private.profiles_trava_consentimento() from public, anon, authenticated;
