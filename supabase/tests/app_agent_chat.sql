-- Fase 5: conversas do agente dentro do app, sem misturar com o WhatsApp.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/app_agent_chat.sql
--
-- Assert em vez de tabela impressa: verificação que depende de alguém olhando
-- volta a quebrar sozinha. Roda inteiro em transação e dá rollback.

\set ON_ERROR_STOP on
begin;

-- O checkpointer nasce no startup do agente, não nas migrations.
create table if not exists langgraph.checkpoints (
  thread_id text not null,
  checkpoint_ns text not null default '',
  checkpoint_id text not null,
  parent_checkpoint_id text,
  type text,
  checkpoint jsonb not null,
  metadata jsonb not null default '{}',
  primary key (thread_id, checkpoint_ns, checkpoint_id)
);

insert into auth.users (id, instance_id, aud, role, email, phone, raw_user_meta_data, raw_app_meta_data)
values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'agente-a@teste.local', '5511988880001', '{}', '{}'),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'agente-b@teste.local', null, '{}', '{}');

-- ===========================================================================
-- 1. Canal: o default preserva o WhatsApp e o app é explícito
-- ===========================================================================
do $$
declare v_channel text; v_id uuid;
begin
  insert into public.user_sessions (thread_id, phone, user_id, workspace_id, last_message_at)
  select 'app-teste-wa', '5511988880001', p.id, public._default_workspace(p.id), now()
  from public.profiles p where p.id = '00000000-0000-0000-0000-00000000c001';

  select channel, id into v_channel, v_id
    from public.user_sessions where thread_id = 'app-teste-wa';
  assert v_channel = 'whatsapp',
    format('sessão sem channel deveria nascer whatsapp, veio %L', v_channel);
  assert v_id is not null, 'toda sessão precisa de um id estável';
end $$;

-- ===========================================================================
-- 2. Várias conversas do app para o mesmo usuário e workspace
-- ===========================================================================
do $$
declare n integer;
begin
  insert into public.user_sessions
    (thread_id, channel, user_id, workspace_id, title, first_client_message_id, last_message_at)
  select 'app-conv-1', 'app', p.id, public._default_workspace(p.id), 'Contas do mês',
         '00000000-0000-0000-0000-0000000000a1', now()
  from public.profiles p where p.id = '00000000-0000-0000-0000-00000000c001';

  insert into public.user_sessions
    (thread_id, channel, user_id, workspace_id, title, first_client_message_id, last_message_at)
  select 'app-conv-2', 'app', p.id, public._default_workspace(p.id), 'Viagem',
         '00000000-0000-0000-0000-0000000000a2', now()
  from public.profiles p where p.id = '00000000-0000-0000-0000-00000000c001';

  select count(*) into n from public.user_sessions
   where channel = 'app' and user_id = '00000000-0000-0000-0000-00000000c001';
  assert n = 2, format('o app precisa aceitar várias conversas, achou %s', n);
end $$;

-- ===========================================================================
-- 3. WhatsApp sem telefone não existe
-- ===========================================================================
do $$
begin
  begin
    insert into public.user_sessions (thread_id, channel, user_id, workspace_id)
    select 'app-wa-sem-fone', 'whatsapp', p.id, public._default_workspace(p.id)
    from public.profiles p where p.id = '00000000-0000-0000-0000-00000000c001';
    raise exception 'sessão whatsapp sem telefone foi aceita';
  exception when check_violation then null;
  end;
end $$;

-- ===========================================================================
-- 4. A forma da sessão do app é obrigatória
-- ===========================================================================
do $$
declare
  v_ws uuid;
  v_user uuid := '00000000-0000-0000-0000-00000000c001';
begin
  select public._default_workspace(v_user) into v_ws;

  -- (a) com telefone
  begin
    insert into public.user_sessions
      (thread_id, channel, phone, user_id, workspace_id, title, first_client_message_id)
    values ('app-ruim-a', 'app', '5511988880009', v_user, v_ws, 'x',
            '00000000-0000-0000-0000-0000000000b1');
    raise exception 'conversa do app aceitou telefone';
  exception when check_violation then null;
  end;

  -- (b) sem usuário
  begin
    insert into public.user_sessions
      (thread_id, channel, workspace_id, title, first_client_message_id)
    values ('app-ruim-b', 'app', v_ws, 'x', '00000000-0000-0000-0000-0000000000b2');
    raise exception 'conversa do app aceitou user_id nulo';
  exception when check_violation then null;
  end;

  -- (c) sem workspace
  begin
    insert into public.user_sessions
      (thread_id, channel, user_id, title, first_client_message_id)
    values ('app-ruim-c', 'app', v_user, 'x', '00000000-0000-0000-0000-0000000000b3');
    raise exception 'conversa do app aceitou workspace_id nulo';
  exception when check_violation then null;
  end;

  -- (d) sem título
  begin
    insert into public.user_sessions
      (thread_id, channel, user_id, workspace_id, first_client_message_id)
    values ('app-ruim-d', 'app', v_user, v_ws, '00000000-0000-0000-0000-0000000000b4');
    raise exception 'conversa do app aceitou título nulo';
  exception when check_violation then null;
  end;

  -- (e) sem o UUID do primeiro turno (é o que torna a criação idempotente)
  begin
    insert into public.user_sessions
      (thread_id, channel, user_id, workspace_id, title)
    values ('app-ruim-e', 'app', v_user, v_ws, 'x');
    raise exception 'conversa do app aceitou first_client_message_id nulo';
  exception when check_violation then null;
  end;

  -- (f) título em branco
  begin
    insert into public.user_sessions
      (thread_id, channel, user_id, workspace_id, title, first_client_message_id)
    values ('app-ruim-f', 'app', v_user, v_ws, '   ',
            '00000000-0000-0000-0000-0000000000b6');
    raise exception 'título só com espaço foi aceito';
  exception when check_violation then null;
  end;

  -- (g) o mesmo primeiro turno não cria uma segunda conversa
  begin
    insert into public.user_sessions
      (thread_id, channel, user_id, workspace_id, title, first_client_message_id)
    values ('app-ruim-g', 'app', v_user, v_ws, 'Contas do mês',
            '00000000-0000-0000-0000-0000000000a1');
    raise exception 'first_client_message_id repetido criou conversa duplicada';
  exception when unique_violation then null;
  end;
end $$;

-- ===========================================================================
-- 5. thread_id e id são únicos
-- ===========================================================================
do $$
declare v_id uuid;
begin
  select id into v_id from public.user_sessions where thread_id = 'app-conv-1';

  begin
    insert into public.user_sessions
      (thread_id, channel, user_id, workspace_id, title, first_client_message_id)
    select 'app-conv-1', 'app', p.id, public._default_workspace(p.id), 'Colisão',
           '00000000-0000-0000-0000-0000000000c1'
    from public.profiles p where p.id = '00000000-0000-0000-0000-00000000c002';
    raise exception 'thread_id repetido foi aceito';
  exception when unique_violation then null;
  end;

  begin
    insert into public.user_sessions
      (id, thread_id, channel, user_id, workspace_id, title, first_client_message_id)
    select v_id, 'app-conv-3', 'app', p.id, public._default_workspace(p.id), 'Colisão',
           '00000000-0000-0000-0000-0000000000c2'
    from public.profiles p where p.id = '00000000-0000-0000-0000-00000000c002';
    raise exception 'id repetido foi aceito';
  exception when unique_violation then null;
  end;
end $$;

-- ===========================================================================
-- 6. Pendência e rascunho apontam para a sessão; no app o telefone é nulo
-- ===========================================================================
do $$
declare v_sessao uuid; n integer;
begin
  select id into v_sessao from public.user_sessions where thread_id = 'app-conv-1';

  insert into public.pending_actions
    (session_id, thread_id, user_id, workspace_id, action, summary)
  select v_sessao, s.thread_id, s.user_id, s.workspace_id, '{"type":"delete"}'::jsonb,
         'apagar o gasto de R$ 45'
  from public.user_sessions s where s.id = v_sessao;

  select count(*) into n from public.pending_actions
   where session_id = v_sessao and phone is null;
  assert n = 1, 'pendência do app precisa existir com telefone nulo';

  insert into public.draft_actions
    (session_id, thread_id, user_id, workspace_id, action, raw_text, missing)
  select v_sessao, s.thread_id, s.user_id, s.workspace_id, '{}'::jsonb, 'comprei um mac',
         'qual foi o valor?'
  from public.user_sessions s where s.id = v_sessao;

  select count(*) into n from public.draft_actions
   where session_id = v_sessao and phone is null;
  assert n = 1, 'rascunho do app precisa existir com telefone nulo';

  -- um rascunho por sessão, não por telefone (no app o telefone não existe)
  begin
    insert into public.draft_actions
      (session_id, thread_id, user_id, workspace_id, action, raw_text, missing)
    select v_sessao, s.thread_id, s.user_id, s.workspace_id, '{}'::jsonb, 'outro',
           'qual foi o valor?'
    from public.user_sessions s where s.id = v_sessao;
    raise exception 'a sessão aceitou dois rascunhos abertos';
  exception when unique_violation then null;
  end;

  -- uma pendência aberta por sessão
  begin
    insert into public.pending_actions
      (session_id, thread_id, user_id, workspace_id, action, summary)
    select v_sessao, s.thread_id, s.user_id, s.workspace_id, '{"type":"delete"}'::jsonb,
           'outra'
    from public.user_sessions s where s.id = v_sessao;
    raise exception 'a sessão aceitou duas pendências abertas';
  exception when unique_violation then null;
  end;
end $$;

-- ===========================================================================
-- 7. Apagar uma conversa do app leva só o que é dela
-- ===========================================================================
do $$
declare v_um uuid; v_dois uuid; n integer;
begin
  select id into v_um from public.user_sessions where thread_id = 'app-conv-1';
  select id into v_dois from public.user_sessions where thread_id = 'app-conv-2';

  insert into public.app_chat_messages
    (id, session_id, client_message_id, role, content, status)
  values
    ('00000000-0000-0000-0000-0000000000d1', v_um,
     '00000000-0000-0000-0000-0000000000a1', 'user', 'quanto gastei?', 'completed'),
    ('00000000-0000-0000-0000-0000000000d3', v_dois,
     '00000000-0000-0000-0000-0000000000a2', 'user', 'e a viagem?', 'completed');

  insert into public.app_chat_messages
    (session_id, role, content, in_reply_to, status, completed_at)
  values (v_um, 'assistant', 'R$ 1.234,00', '00000000-0000-0000-0000-0000000000d1',
          'completed', now());

  insert into public.pending_actions
    (session_id, thread_id, user_id, workspace_id, action, summary)
  select v_dois, s.thread_id, s.user_id, s.workspace_id, '{"type":"delete"}'::jsonb, 'outra'
  from public.user_sessions s where s.id = v_dois;

  delete from public.user_sessions where id = v_um;

  select count(*) into n from public.app_chat_messages where session_id = v_um;
  assert n = 0, 'mensagens da conversa apagada sobreviveram';
  select count(*) into n from public.pending_actions where session_id = v_um;
  assert n = 0, 'pendência da conversa apagada sobreviveu';
  select count(*) into n from public.draft_actions where session_id = v_um;
  assert n = 0, 'rascunho da conversa apagada sobreviveu';

  select count(*) into n from public.app_chat_messages where session_id = v_dois;
  assert n = 1, 'a outra conversa perdeu mensagem';
  select count(*) into n from public.pending_actions where session_id = v_dois;
  assert n = 1, 'a outra conversa perdeu a pendência';
end $$;

-- ===========================================================================
-- 7b. A forma das mensagens do app
-- ===========================================================================
do $$
declare v_sessao uuid;
begin
  select id into v_sessao from public.user_sessions where thread_id = 'app-conv-2';

  -- turno do usuário exige o UUID do cliente
  begin
    insert into public.app_chat_messages (session_id, role, content, status)
    values (v_sessao, 'user', 'sem uuid', 'processing');
    raise exception 'mensagem do usuário sem client_message_id foi aceita';
  exception when check_violation then null;
  end;

  -- o mesmo UUID do cliente não vira dois turnos
  begin
    insert into public.app_chat_messages (session_id, client_message_id, role, content, status)
    values (v_sessao, '00000000-0000-0000-0000-0000000000a2', 'user', 'de novo', 'processing');
    raise exception 'client_message_id repetido foi aceito na mesma conversa';
  exception when unique_violation then null;
  end;

  -- resposta precisa apontar para o turno que respondeu
  begin
    insert into public.app_chat_messages (session_id, role, content, status)
    values (v_sessao, 'assistant', 'órfã', 'completed');
    raise exception 'resposta sem in_reply_to foi aceita';
  exception when check_violation then null;
  end;

  -- código de erro só existe em falha
  begin
    insert into public.app_chat_messages
      (session_id, client_message_id, role, content, status, error_code)
    values (v_sessao, '00000000-0000-0000-0000-0000000000e9', 'user', 'ok', 'processing',
            'plan_limit');
    raise exception 'error_code apareceu fora de failed';
  exception when check_violation then null;
  end;

  -- conteúdo vazio não é mensagem
  begin
    insert into public.app_chat_messages (session_id, client_message_id, role, content, status)
    values (v_sessao, '00000000-0000-0000-0000-0000000000ea', 'user', '   ', 'processing');
    raise exception 'mensagem em branco foi aceita';
  exception when check_violation then null;
  end;
end $$;

-- ===========================================================================
-- 8. Trocar o telefone aposenta o WhatsApp e preserva o app
-- ===========================================================================
do $$
declare n integer;
begin
  insert into langgraph.checkpoints (thread_id, checkpoint_id, type, checkpoint, metadata)
  values ('app-teste-wa', 'cp-wa', 'json', '{}', '{}'),
         ('app-conv-2', 'cp-app', 'json', '{}', '{}');

  update auth.users set phone = '5511988880002'
  where id = '00000000-0000-0000-0000-00000000c001';

  select count(*) into n from public.user_sessions where thread_id = 'app-teste-wa';
  assert n = 0, 'sessão de WhatsApp antiga sobreviveu à troca';

  select count(*) into n from public.user_sessions where thread_id = 'app-conv-2';
  assert n = 1, 'a troca de telefone apagou a conversa do app';

  select count(*) into n from public.app_chat_messages;
  assert n >= 1, 'a troca de telefone apagou o histórico do app';

  select count(*) into n from langgraph.checkpoints where thread_id = 'app-conv-2';
  assert n = 1, 'a troca de telefone apagou o checkpoint da conversa do app';
  select count(*) into n from langgraph.checkpoints where thread_id = 'app-teste-wa';
  assert n = 0, 'o checkpoint do WhatsApp antigo sobreviveu';
end $$;

-- ===========================================================================
-- 9. O cliente não fala com a tabela de mensagens
-- ===========================================================================
do $$
declare v_priv text;
begin
  assert (select relrowsecurity from pg_class where oid = 'public.app_chat_messages'::regclass),
    'app_chat_messages precisa de RLS ligada';
  assert not exists (select 1 from pg_policies
                     where schemaname = 'public' and tablename = 'app_chat_messages'),
    'app_chat_messages é infraestrutura: não pode ter policy';

  foreach v_priv in array array['select', 'insert', 'update', 'delete']
  loop
    assert not has_table_privilege('anon', 'public.app_chat_messages', v_priv),
      format('anon manteve %s em app_chat_messages', v_priv);
    assert not has_table_privilege('authenticated', 'public.app_chat_messages', v_priv),
      format('authenticated manteve %s em app_chat_messages', v_priv);
  end loop;

  -- `revoke all on <tabela>` não alcança a sequence da coluna identity, e a 0039 concede
  -- `usage, select on sequences` por default privileges. Sem revoke próprio sobra nextval.
  foreach v_priv in array array['usage', 'select', 'update']
  loop
    assert not has_sequence_privilege('anon', 'public.app_chat_messages_sequence_seq', v_priv),
      format('anon manteve %s na sequence dos turnos', v_priv);
    assert not has_sequence_privilege('authenticated', 'public.app_chat_messages_sequence_seq', v_priv),
      format('authenticated manteve %s na sequence dos turnos', v_priv);
  end loop;
end $$;

-- ===========================================================================
-- 10. A chave de execução deixou de ser exclusiva da Meta
-- ===========================================================================
do $$
declare n integer;
begin
  assert exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'executed_actions'
                   and column_name = 'source_message_id'),
    'executed_actions precisa de source_message_id';
  assert not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'executed_actions'
                       and column_name = 'wa_message_id'),
    'wa_message_id continua em executed_actions';

  -- a mesma reserva serve aos dois canais
  insert into public.executed_actions (source_message_id, action_index, action_type)
  values ('wamid.TESTE', 0, 'create_transaction'),
         ('app:00000000-0000-0000-0000-0000000000a1', 0, 'create_transaction');
  select count(*) into n from public.executed_actions;
  assert n = 2, format('reserva por canal falhou, achou %s linhas', n);

  begin
    insert into public.executed_actions (source_message_id, action_index, action_type)
    values ('app:00000000-0000-0000-0000-0000000000a1', 0, 'create_transaction');
    raise exception 'a reserva do app não é idempotente';
  exception when unique_violation then null;
  end;

  -- messages_queue continua falando o idioma da Meta: ela é só do WhatsApp
  assert exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'messages_queue'
                   and column_name = 'wa_message_id'),
    'messages_queue perdeu wa_message_id sem motivo';
end $$;

rollback;
\echo '✓ conversas do agente no app verificadas'
