-- ===== asserções =====
-- ai_reports: a consulta de gravação do agente (db.report_chat_message), idempotência, cópia do texto,
-- fechamento de acesso e cascade da conta.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
values ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'rep-a@teste.local', '{}', '{}'),
       ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'rep-b@teste.local', '{}', '{}');

do $$
declare
  ua uuid := '00000000-0000-0000-0000-00000000a101';
  ub uuid := '00000000-0000-0000-0000-00000000a102';
  wa uuid; sid uuid; mu uuid; ma uuid; n int; achou int;
  sql text := $q$
    with alvo as (
      select m.id, m.content, s.id as sid, s.workspace_id
      from public.app_chat_messages m
      join public.user_sessions s on s.id = m.session_id
      where m.id = $1 and m.session_id = $2 and s.user_id = $3 and m.role = 'assistant'
        and s.channel = 'app' and s.deleting_at is null
    ), ins as (
      insert into public.ai_reports (workspace_id, user_id, session_id, message_id, content, reason, note)
      select workspace_id, $3, sid, id, content, 'errada', null from alvo
      on conflict (user_id, message_id) do nothing
      returning 1
    )
    select count(*)::int from alvo$q$;
begin
  select id into wa from public.workspaces where owner_id = ua;
  insert into public.user_sessions (thread_id, user_id, workspace_id, channel, title, first_client_message_id, last_message_at)
  values ('rep-app', ua, wa, 'app', 'Teste', gen_random_uuid(), now()) returning id into sid;
  insert into public.app_chat_messages (session_id, client_message_id, role, content, status)
  values (sid, gen_random_uuid(), 'user', 'quanto gastei?', 'completed') returning id into mu;
  insert into public.app_chat_messages (session_id, role, content, status, in_reply_to)
  values (sid, 'assistant', 'Você gastou R$ 10,00.', 'completed', mu) returning id into ma;

  execute sql into achou using ma, sid, ua;
  assert achou = 1, 'resposta do assistente deveria ser achada';
  execute sql into achou using ma, sid, ua;
  assert achou = 1, 'repetição deveria continuar achando';
  select count(*) into n from public.ai_reports where user_id = ua and message_id = ma;
  assert n = 1, 'repetição não pode duplicar';
  execute sql into achou using mu, sid, ua;
  assert achou = 0, 'mensagem do usuário não é reportável';
  execute sql into achou using ma, sid, ub;
  assert achou = 0, 'conversa de outra pessoa não é reportável';

  -- a cópia sobrevive à conversa apagada
  delete from public.user_sessions where id = sid;
  select count(*) into n from public.ai_reports where user_id = ua and content = 'Você gastou R$ 10,00.';
  assert n = 1, 'relato deveria sobreviver à conversa';

  begin
    insert into public.ai_reports (workspace_id, user_id, content, reason) values (wa, ua, 'x', 'spam');
    assert false, 'motivo inválido deveria violar o check';
  exception when check_violation then null; end;
  begin
    insert into public.ai_reports (workspace_id, user_id, content, reason, note)
    values (wa, ua, 'x', 'outra', repeat('a', 501));
    assert false, 'nota longa deveria violar o check';
  exception when check_violation then null; end;

  -- fechada para o app
  set local role authenticated;
  begin
    perform 1 from public.ai_reports;
    assert false, 'authenticated não pode ler ai_reports';
  exception when insufficient_privilege then null; end;
  reset role;

  -- apagar a conta leva os relatos
  perform set_config('request.jwt.claims', json_build_object('sub', ua)::text, true);
  perform public.delete_my_account();
  select count(*) into n from public.ai_reports where user_id = ua or workspace_id = wa;
  assert n = 0, 'apagar a conta deveria levar os relatos';
end $$;

rollback;
