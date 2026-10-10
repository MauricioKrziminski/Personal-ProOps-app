-- Consentimento de IA, aceite dos termos, ping de versão, app_config e notas do painel (20261010230000).
\set ON_ERROR_STOP on
begin;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000077a1';
  b uuid := '00000000-0000-0000-0000-0000000077b1';
  r jsonb; p record; fone text := '5511955554441'; nota uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
   (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'co-a@teste.local', '{}', '{}'),
   (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'co-b@teste.local', '{}', '{}');
  update public.profiles set phone = fone, expo_push_token = 'ExponentPushToken[co-a]' where id = a;

  assert (select ai_consent_at is null and terms_version is null and last_seen_at is null
            from public.profiles where id = a), 'perfil novo não tem aceite nem ping';

  -- app_config: anon lê a linha 1; ninguém do app escreve
  set local role anon;
  assert (select count(*) from public.app_config) = 1, 'anon lê app_config';
  begin
    update public.app_config set notice_title = 'x';
    assert false, 'anon não escreve em app_config';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.app_config (id) values (2);
    assert false, 'anon não insere em app_config';
  exception when insufficient_privilege then null; end;
  begin
    perform public.accept_terms('2026-10-09', true);
    assert false, 'anon não executa accept_terms';
  exception when insufficient_privilege then null; end;
  begin
    perform public.app_ping('1.0.0', 'ios');
    assert false, 'anon não executa app_ping';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_ai_consent(true);
    assert false, 'anon não executa set_ai_consent';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.admin_account_notes;
    assert false, 'anon não lê notas do painel';
  exception when insufficient_privilege then null; end;
  reset role;

  -- como A (authenticated)
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.app_config) = 1, 'authenticated lê app_config';
  begin
    update public.app_config set notice_title = 'x';
    assert false, 'authenticated não escreve em app_config';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.admin_account_notes;
    assert false, 'authenticated não lê notas do painel';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.admin_account_notes (user_id, admin_user_id, body) values (a, a, 'x');
    assert false, 'authenticated não escreve notas do painel';
  exception when insufficient_privilege then null; end;

  -- accept_terms: sem consentimento de IA, depois com (coalesce preserva o primeiro instante)
  r := public.accept_terms('2026-10-09', false);
  assert r->>'terms_version' = '2026-10-09' and r->>'terms_accepted_at' is not null and r->'ai_consent_at' = 'null'::jsonb,
    'aceita os termos sem IA';
  r := public.accept_terms('2026-10-09', true);
  assert r->>'ai_consent_at' is not null, 'aceita com IA';
  select * into p from public.profiles where id = a;
  assert p.ai_consent_at is not null and p.terms_version = '2026-10-09', 'perfil gravado';
  perform public.accept_terms('2026-10-09', true);
  assert (select ai_consent_at from public.profiles where id = a) = p.ai_consent_at, 'segundo aceite não move o instante';
  r := public.accept_terms('2026-10-09', false);
  assert (select ai_consent_at from public.profiles where id = a) is null, 'aceitar sem IA revoga a IA';

  -- set_ai_consent
  r := public.set_ai_consent(true);
  assert r->>'ai_consent_at' is not null, 'liga';
  r := public.set_ai_consent(false);
  assert r->'ai_consent_at' = 'null'::jsonb and (select ai_consent_at from public.profiles where id = a) is null, 'revoga';

  -- versão inválida
  begin perform public.accept_terms('', true); assert false, 'versão vazia'; exception when sqlstate '22023' then null; end;
  begin perform public.accept_terms(repeat('x', 21), true); assert false, 'versão longa'; exception when sqlstate '22023' then null; end;
  begin perform public.accept_terms(null, true); assert false, 'versão nula'; exception when sqlstate '22023' then null; end;

  -- app_ping
  perform public.app_ping('1.4.2', 'android');
  select * into p from public.profiles where id = a;
  assert p.last_app_version = '1.4.2' and p.last_app_platform = 'android' and p.last_seen_at is not null, 'ping gravado';
  begin perform public.app_ping('1.4.2', 'windows'); assert false, 'plataforma fora da lista'; exception when sqlstate '22023' then null; end;
  begin perform public.app_ping('1.4.2', null); assert false, 'plataforma nula'; exception when sqlstate '22023' then null; end;
  begin perform public.app_ping('', 'ios'); assert false, 'versão vazia'; exception when sqlstate '22023' then null; end;
  begin perform public.app_ping(repeat('9', 21), 'ios'); assert false, 'versão longa'; exception when sqlstate '22023' then null; end;

  begin perform public.app_ping('2026-10-09', 'ios'); assert false, 'só semver'; exception when sqlstate '22023' then null; end;
  begin perform public.app_ping('1.4', 'ios'); assert false, 'só MAJOR.MINOR.PATCH'; exception when sqlstate '22023' then null; end;

  -- UPDATE direto (o que o PostgREST faz): as seis colunas voltam ao valor antigo, o resto muda
  select * into p from public.profiles where id = a;
  update public.profiles set display_name = 'Direto', terms_version = 'hack', terms_accepted_at = null,
    ai_consent_at = now(), last_app_version = '9.9.9', last_app_platform = 'web', last_seen_at = null where id = a;
  assert (select display_name from public.profiles where id = a) = 'Direto', 'coluna comum muda';
  assert (select terms_version is not distinct from p.terms_version and terms_accepted_at is not distinct from p.terms_accepted_at
                 and ai_consent_at is not distinct from p.ai_consent_at and last_app_version is not distinct from p.last_app_version
                 and last_app_platform is not distinct from p.last_app_platform and last_seen_at is not distinct from p.last_seen_at
            from public.profiles where id = a), 'update direto não muda as seis colunas';
  perform public.set_ai_consent(true);
  assert (select ai_consent_at from public.profiles where id = a) is not null, 'a RPC muda';

  -- app_config: anon/authenticated não leem updated_by, leem o resto
  reset role;
  set local role anon;
  assert (select count(min_version_ios) from public.app_config) >= 0, 'anon lê colunas públicas';
  begin perform updated_by from public.app_config; assert false, 'anon não lê updated_by'; exception when insufficient_privilege then null; end;
  begin perform * from public.app_config; assert false, 'select * falha'; exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform updated_by from public.app_config; assert false, 'authenticated não lê updated_by'; exception when insufficient_privilege then null; end;

  -- nunca toca o telefone nem o perfil de outro
  reset role;
  assert (select phone from public.profiles where id = a) = fone, 'phone intacto';
  assert (select ai_consent_at is null and terms_version is null and last_seen_at is null
            from public.profiles where id = b), 'perfil de B intacto';

  -- sem sessão: recusa
  perform set_config('request.jwt.claims', '', true);
  set local role authenticated;
  begin perform public.app_ping('1.0.0', 'ios'); assert false, 'sem uid'; exception when sqlstate '28000' then null; end;
  begin perform public.accept_terms('2026-10-09', true); assert false, 'sem uid'; exception when sqlstate '28000' then null; end;
  begin perform public.set_ai_consent(true); assert false, 'sem uid'; exception when sqlstate '28000' then null; end;
  reset role;

  -- nota interna: checks de tamanho; apagar a conta leva nota e token de push
  insert into public.admin_account_notes (user_id, admin_user_id, body) values (a, b, 'ligou pedindo reembolso') returning id into nota;
  begin
    insert into public.admin_account_notes (user_id, admin_user_id, body) values (a, b, '');
    assert false, 'nota vazia';
  exception when check_violation then null; end;
  begin
    insert into public.admin_account_notes (user_id, admin_user_id, body) values (a, b, repeat('x', 2001));
    assert false, 'nota longa';
  exception when check_violation then null; end;
  insert into public.admin_account_notes (user_id, admin_user_id, body) values (b, b, 'nota de B');
  assert (select expo_push_token from public.profiles where id = a) is not null, 'token existe antes';

  perform private.apagar_conta(a);
  assert not exists (select 1 from public.admin_account_notes where user_id = a), 'apagar a conta leva as notas';
  assert not exists (select 1 from public.profiles where id = a), 'perfil saiu';
  assert not exists (select 1 from public.profiles where expo_push_token = 'ExponentPushToken[co-a]'), 'token de push saiu';
  assert exists (select 1 from public.admin_account_notes where user_id = b), 'nota de B fica';

  begin insert into public.app_config (id) values (2); assert false, 'só a linha 1'; exception when check_violation then null; end;
  begin
    update public.app_config set notice_level = 'grave';
    assert false, 'nivel fora da lista';
  exception when check_violation then null; end;
end $$;

rollback;
