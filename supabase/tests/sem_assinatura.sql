-- Fim do plano grátis (20261010180000): access, portão de escrita, apagar a conta, convite x max_members.
-- Roda como postgres; `proops.forcar_app` faz o gatilho tratar a sessão como se fosse o PostgREST.

\set ON_ERROR_STOP on
begin;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000055a1';  -- dono, vai apagar a conta
  b uuid := '00000000-0000-0000-0000-0000000055b1';  -- outro usuário (família), A é membro do espaço dele
  c uuid := '00000000-0000-0000-0000-0000000055c1';  -- assinante
  wa uuid; wb uuid; wc uuid; acc uuid; tx uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
   (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-a@teste.local', '{}', '{}'),
   (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-b@teste.local', '{}', '{}'),
   (c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-c@teste.local', '{}', '{}');
  select id into wa from public.workspaces where owner_id = a;
  select id into wb from public.workspaces where owner_id = b;
  select id into wc from public.workspaces where owner_id = c;

  -- (a) access: never -> subscriber -> lapsed
  assert (select access from private.plan_status_for(wa)) = 'never', 'recém-criado é never';
  update public.subscriptions set plan = 'family', status = 'active', provider = 'google' where workspace_id in (wb, wc);
  assert (select access from private.plan_status_for(wb)) = 'subscriber', 'family ativo é subscriber';
  update public.subscriptions set plan = 'pro', status = 'canceled', provider = 'google' where workspace_id = wa;
  assert (select access from private.plan_status_for(wa)) = 'lapsed', 'cancelado é lapsed';

  -- (b) portão: sem forçar o app, o postgres escreve (agente/cron)
  insert into public.accounts (workspace_id, user_id, name, type) values (wa, a, 'Conta A', 'checking') returning id into acc;

  perform set_config('proops.forcar_app', 'on', true);
  begin
    insert into public.accounts (workspace_id, user_id, name, type) values (wa, a, 'Outra', 'checking');
    assert false, 'INSERT de free deveria ser recusado';
  exception when sqlstate 'PT402' then null; end;
  begin
    update public.accounts set name = 'Renomeada' where id = acc;
    assert false, 'UPDATE de free deveria ser recusado';
  exception when sqlstate 'PT402' then null; end;
  begin
    delete from public.accounts where id = acc;
    assert false, 'DELETE de free deveria ser recusado';
  exception when sqlstate 'PT402' then null; end;
  -- workspace_id vindo do DEFAULT (my_default_workspace) também passa pelo gatilho
  begin
    insert into public.notes (workspace_id, user_id, content) values (wa, a, 'x');
    assert false, 'notes de free deveria ser recusado';
  exception when sqlstate 'PT402' then null; end;
  assert exists (select 1 from public.accounts where id = acc), 'free ainda lê';
  -- assinante passa
  insert into public.accounts (workspace_id, user_id, name, type) values (wc, c, 'Conta C', 'checking');
  update public.accounts set name = 'C2' where workspace_id = wc;
  -- tabela fora do portão (conta/assinatura) segue escrevendo
  update public.workspaces set name = 'Renomeado' where id = wa;
  perform set_config('proops.forcar_app', 'off', true);
  update public.accounts set name = 'agente escreve' where id = acc;  -- sem forçar: passa

  -- (c) apagar a conta: A é dono de wa e membro de wb (com dado dele lá)
  insert into public.workspace_members (workspace_id, user_id, role) values (wb, a, 'member');
  insert into public.accounts (workspace_id, user_id, name, type) values (wb, a, 'Conta de A em B', 'checking');
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at)
    values (wa, a, 'expense', 1000, 'gasto A', current_date) returning id into tx;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at)
    values (wb, b, 'expense', 2000, 'gasto B', current_date);
  insert into public.emergency_reserves (workspace_id, user_id, base_mode, manual_monthly_cents, target_months)
    values (wb, a, 'manual', 100000, 6);

  -- histórico do agente: o de A some (por user_id, telefone e thread); o de B fica
  update public.profiles set phone = '5511988887771' where id = a;
  insert into public.user_sessions (thread_id, phone, user_id, workspace_id, session_epoch, channel)
    values ('sa-ta', '5511988887771', a, wa, 2, 'whatsapp'), ('sa-tb', '5511977776661', b, wb, 0, 'whatsapp');
  insert into public.user_sessions (thread_id, phone, user_id, workspace_id, channel)  -- órfã: só o telefone de A
    values ('sa-torfa', '+55 11 88887-771' , null, null, 'whatsapp');
  insert into public.pending_actions (thread_id, phone, user_id, workspace_id, action, summary, session_id)
    select 'sa-ta', '5511988887771', a, wa, '{}', 'x', id from public.user_sessions where thread_id = 'sa-ta';
  insert into public.pending_actions (thread_id, phone, user_id, workspace_id, action, summary, session_id)
    select 'sa-tb', '5511977776661', b, wb, '{}', 'x', id from public.user_sessions where thread_id = 'sa-tb';
  insert into public.draft_actions (thread_id, phone, user_id, workspace_id, action, raw_text, missing, session_id)
    select 'sa-ta', '5511988887771', a, wa, '{}', 'x', 'y', id from public.user_sessions where thread_id = 'sa-ta';
  insert into public.app_chat_messages (session_id, role, content, status, client_message_id)
    select id, 'user', 'sa-oi', 'completed', gen_random_uuid() from public.user_sessions where thread_id = 'sa-ta';
  insert into public.messages_queue (wa_message_id, thread_id, phone, user_id, workspace_id, payload) values
    ('sa-m1', 'sa-ta', '5511988887771', a, wa, '{}'),
    ('sa-m2', 'sa-x', '551188887771', null, null, '{}'),        -- sem o 9º dígito, sem usuário: só o telefone
    ('sa-m3', 'sa-tb', '5511977776661', b, wb, '{}'),
    ('sa-m4', 'sa-tc', '5511966665551', a, wb, '{}');           -- A em espaço de B (user_id vira null no cascade)
  insert into public.messages_raw (wa_message_id, direction, phone, payload) values
    ('sa-r1', 'inbound', '5511988887771', '{}'), ('sa-r2', 'inbound', '5511977776661', '{}');
  insert into public.agent_routing (phone) values ('5511988887771'), ('5511977776661');
  insert into public.ai_events (user_id, workspace_id, model, channel) values (a, wb, 'm', 'whatsapp'), (b, wb, 'm', 'whatsapp');
  insert into public.agent_feedback (workspace_id, user_id, channel, outcome) values (wb, a, 'app', 'approved'), (wb, b, 'app', 'approved');
  insert into public.whatsapp_sends (workspace_id, user_id, kind) values (wb, a, 'reply'), (wb, b, 'reply');
  insert into public.executed_actions (source_message_id, action_index, action_type, user_id, workspace_id) values
    ('sa-e1', 0, 'x', a, wb), ('sa-e2', 0, 'x', b, wb);
  insert into public.billing_events (id, type, provider, workspace_id, payload) values
    ('sa-bill-a', 'INITIAL_PURCHASE', 'google', wa, jsonb_build_object('app_user_id', a, 'email', 'a@x')),
    ('sa-bill-b', 'INITIAL_PURCHASE', 'google', wb, jsonb_build_object('app_user_id', b, 'email', 'b@x'));
  if pg_catalog.to_regclass('langgraph.checkpoints') is not null then
    insert into langgraph.checkpoints (thread_id, checkpoint_id, checkpoint) values
      ('sa-ta', '1', '{}'), ('sa-ta:1', '1', '{}'), ('sa-ta:2', '1', '{}'), ('sa-torfa:1', '1', '{}'),
      ('sa-tab', '1', '{}'), ('sa-tb', '1', '{}'), ('sa-tb:1', '1', '{}');
    insert into langgraph.checkpoint_writes (thread_id, checkpoint_id, task_id, idx, channel, blob) values
      ('sa-ta:2', '1', 't', 0, 'c', '\x00'), ('sa-tb', '1', 't', 0, 'c', '\x00');
    insert into langgraph.checkpoint_blobs (thread_id, channel, version, type) values
      ('sa-ta:1', 'c', '1', 't'), ('sa-tb:1', 'c', '1', 't');
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('proops.forcar_app', 'on', true);  -- apagar a conta passa mesmo para free vindo do app
  perform public.delete_my_account();
  perform set_config('proops.forcar_app', 'off', true);

  assert not exists (select 1 from auth.users where id = a), 'auth.users de A saiu';
  assert not exists (select 1 from public.profiles where id = a), 'profile de A saiu';
  assert not exists (select 1 from public.workspaces where id = wa), 'workspace de A saiu';
  assert not exists (select 1 from public.transactions where id = tx), 'dado de A saiu';
  assert not exists (select 1 from public.accounts where workspace_id = wb and user_id = a), 'dado de A em B saiu';
  assert not exists (select 1 from public.workspace_members where user_id = a), 'memberships de A saíram';
  assert exists (select 1 from auth.users where id = b) and exists (select 1 from public.workspaces where id = wb),
    'B e o espaço dele ficam';
  assert (select count(*) from public.transactions where workspace_id = wb) = 1, 'gasto de B fica';
  assert (select user_id from public.emergency_reserves where workspace_id = wb) = b, 'reserva do espaço passa ao dono';
  assert exists (select 1 from auth.users where id = c), 'C intocado';

  -- histórico do agente: nada de A sobra; o de B fica
  assert not exists (select 1 from public.user_sessions where thread_id in ('sa-ta', 'sa-torfa')), 'sessões de A saíram';
  assert not exists (select 1 from public.pending_actions where thread_id = 'sa-ta')
     and not exists (select 1 from public.draft_actions where thread_id = 'sa-ta')
     and not exists (select 1 from public.app_chat_messages where content = 'sa-oi'), 'pending/draft/chat de A saíram';
  assert (select array_agg(wa_message_id order by wa_message_id) from public.messages_queue where wa_message_id like 'sa-m%')
         = array['sa-m3'], 'fila de A saiu (user_id, thread e telefone com/sem 9), a de B fica';
  assert (select array_agg(wa_message_id) from public.messages_raw where wa_message_id like 'sa-r%') = array['sa-r2'], 'messages_raw';
  assert (select array_agg(phone) from public.agent_routing where phone in ('5511988887771', '5511977776661')) = array['5511977776661'], 'agent_routing';
  assert (select count(*) from public.ai_events where workspace_id = wb) = 1
     and (select user_id from public.ai_events where workspace_id = wb) = b, 'ai_events: só o de B';
  assert (select count(*) from public.agent_feedback where workspace_id = wb) = 1, 'agent_feedback: só o de B';
  assert (select count(*) from public.whatsapp_sends where workspace_id = wb) = 1, 'whatsapp_sends: só o de B';
  assert (select count(*) from public.executed_actions where source_message_id in ('sa-e1', 'sa-e2')) = 1, 'executed_actions: só o de B';
  assert exists (select 1 from public.user_sessions where thread_id = 'sa-tb')
     and exists (select 1 from public.pending_actions where thread_id = 'sa-tb'), 'sessão e pendente de B ficam';
  assert (select payload from public.billing_events where id = 'sa-bill-a') = '{"anonimizado": true}'::jsonb
     and not exists (select 1 from public.billing_events where id = 'sa-bill-a' and payload ? 'email'), 'cobrança de A: linha fica sem payload';
  assert (select payload->>'email' from public.billing_events where id = 'sa-bill-b') = 'b@x', 'cobrança de B intacta';
  if pg_catalog.to_regclass('langgraph.checkpoints') is not null then
    assert (select array_agg(thread_id order by thread_id) from langgraph.checkpoints where thread_id like 'sa-t%')
           = array['sa-tab', 'sa-tb', 'sa-tb:1'], 'checkpoints de A (todas as épocas e a órfã) saíram; prefixo parecido e B ficam';
    assert (select array_agg(thread_id) from langgraph.checkpoint_writes where thread_id like 'sa-t%') = array['sa-tb'], 'writes';
    assert (select array_agg(thread_id) from langgraph.checkpoint_blobs where thread_id like 'sa-t%') = array['sa-tb:1'], 'blobs';
  end if;
  -- idempotente: sem usuário logado nada acontece
  perform set_config('request.jwt.claims', '', true);
  perform public.delete_my_account();

  -- (d) convite não estoura max_members: pro tem 1 vaga e já tem 1 membro; family tem vaga
  insert into public.workspace_invites (workspace_id, invited_by, phone) values (wc, c, '+5511999990001');
  update public.subscriptions set plan = 'pro' where workspace_id = wc;
  insert into auth.users (id, instance_id, aud, role, email, phone, raw_user_meta_data, raw_app_meta_data)
  values ('00000000-0000-0000-0000-0000000055d1', '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'sa-d@teste.local', '+5511999990001', '{}', '{}');
  assert not exists (select 1 from public.workspace_members
                      where workspace_id = wc and user_id = '00000000-0000-0000-0000-0000000055d1'),
    'pro lotado não aceita convidado';
  assert (select status from public.workspace_invites where workspace_id = wc) = 'pending', 'convite fica pendente';

  insert into public.workspace_invites (workspace_id, invited_by, phone) values (wb, b, '+5511999990002');
  insert into auth.users (id, instance_id, aud, role, email, phone, raw_user_meta_data, raw_app_meta_data)
  values ('00000000-0000-0000-0000-0000000055e1', '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'sa-e@teste.local', '+5511999990002', '{}', '{}');
  assert exists (select 1 from public.workspace_members
                  where workspace_id = wb and user_id = '00000000-0000-0000-0000-0000000055e1'),
    'family com vaga aceita';
  assert (select status from public.workspace_invites where phone = '+5511999990002') = 'accepted';
end $$;

-- (e) tabela nova de dado nasce com o gatilho: toda tabela de public com workspace_id fora da lista de
-- exclusão da migration tem que ter `a0_exige_assinatura`. Sem isto a regra seria vigilância.
do $$
declare faltando text;
begin
  select string_agg(c.table_name, ', ' order by c.table_name) into faltando
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and c.column_name = 'workspace_id' and t.table_type = 'BASE TABLE'
    and c.table_name not in (
      'subscriptions','workspaces','workspace_members','workspace_invites','profiles',
      'ai_events','agent_feedback','alerts_sent','billing_events','user_sessions','messages_queue',
      'messages_raw','pending_actions','draft_actions','executed_actions','agent_routing',
      'app_chat_messages','jobs','transaction_embeddings','net_worth_snapshots',
      'whatsapp_sends',  -- whatsapp_sends: contador de envios do agente (infra, sem policy; só o agente escreve)
      'ai_reports')  -- ai_reports: denúncia de resposta da IA (sem policy; só o agente escreve, como agent_feedback)
    and not exists (
      select 1 from pg_catalog.pg_trigger g
      where g.tgrelid = format('public.%I', c.table_name)::regclass
        and g.tgname = 'a0_exige_assinatura' and not g.tgisinternal);
  assert faltando is null,
    'tabela de dado sem o portão a0_exige_assinatura (ou ponha na exclusão, com motivo): ' || faltando;
end $$;

rollback;
