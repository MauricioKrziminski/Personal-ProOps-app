-- Observabilidade: agrupamento por fingerprint, reabertura, `ignored` continua ignorada, apagar conta
-- anula o autor do evento, e o app (anon/authenticated) não alcança nada.
\set ON_ERROR_STOP on
begin;

do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000077a1';
  i1 uuid; i2 uuid; i3 uuid;
  r record;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
   (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'obs-a@teste.local', '{}', '{}');

  i1 := private.registrar_erro('fp-obs-1', 'app', 'error', 'error', 'TypeError', 'x é undefined', '/hoje', 'stack1', u, 'ios', '1.4.0', '{"a":1}');
  i2 := private.registrar_erro('fp-obs-1', 'app', 'error', 'critical', 'TypeError', 'x é undefined', null, 'stack2', null, 'android', '1.4.1', '{}');
  assert i1 = i2, 'mesmo fingerprint = mesmo issue';
  select * into r from public.error_issues where id = i1;
  assert r.count = 2, 'conta 2';
  assert r.route = '/hoje', 'rota nula não apaga a rota';
  assert r.stack = 'stack1', 'stack da 1ª ocorrência fica';
  assert r.severity = 'critical', 'severidade sobe';
  assert r.platforms @> array['ios', 'android'] and array_length(r.platforms, 1) = 2, 'plataformas unidas';
  assert r.last_app_version = '1.4.1', 'última versão';
  assert (select count(*) from public.error_events where issue_id = i1) = 2, 'dois eventos';
  assert (select count(distinct user_id) from public.error_events where issue_id = i1) = 1, 'um usuário afetado';

  -- reabre a resolvida
  update public.error_issues set status = 'resolved', resolved_at = now(), resolved_by = u where id = i1;
  perform private.registrar_erro('fp-obs-1', 'app', 'error', 'error', 'TypeError', 'x', null, null, null, null, null, null);
  select * into r from public.error_issues where id = i1;
  assert r.status = 'open' and r.resolved_at is null and r.resolved_by is null, 'resolved reabre';

  -- ignorada continua ignorada, mas conta
  update public.error_issues set status = 'ignored' where id = i1;
  perform private.registrar_erro('fp-obs-1', 'app', 'error', 'error', 'TypeError', 'x', null, null, null, null, null, null);
  select * into r from public.error_issues where id = i1;
  assert r.status = 'ignored' and r.count = 4, 'ignored fica ignorada e conta';

  -- usuário inexistente (conta apagada) não derruba a gravação
  i3 := private.registrar_erro('fp-obs-2', 'agent', 'error', 'critical', 'Boom', 'm', '/x', null, gen_random_uuid(), null, null, '{}');
  assert (select user_id from public.error_events where issue_id = i3) is null, 'user inexistente vira null';

  -- apagar a conta anula o autor, mantém o evento
  perform private.apagar_conta(u);
  assert (select count(*) from public.error_events where issue_id = i1) = 4, 'eventos ficam';
  assert (select count(*) from public.error_events where issue_id = i1 and user_id is not null) = 0, 'autor anulado';

  -- remover o issue leva os eventos (cascade)
  delete from public.error_issues where id = i3;
  assert not exists (select 1 from public.error_events where issue_id = i3), 'cascade';

  -- o app não alcança nada
  assert not has_table_privilege('authenticated', 'public.error_issues', 'select'), 'authenticated lê issues';
  assert not has_table_privilege('anon', 'public.error_events', 'select'), 'anon lê eventos';
  assert not has_function_privilege('authenticated', 'private.registrar_erro(text,text,text,text,text,text,text,text,uuid,text,text,jsonb)', 'execute'), 'authenticated executa';
  assert not has_function_privilege('anon', 'private.registrar_erro(text,text,text,text,text,text,text,text,uuid,text,text,jsonb)', 'execute'), 'anon executa';
end $$;

rollback;
