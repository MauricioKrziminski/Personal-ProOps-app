-- Fase 4: vincular ou trocar o telefone só depois de confirmar o OTP.
--
-- O teste roda contra o Postgres LOCAL e inteira dentro de uma transação:
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/phone_link.sql

\set ON_ERROR_STOP on
begin;

-- O checkpointer nasce no startup do agente, não nas migrations. Criamos a mesma forma mínima
-- quando ele ainda não rodou para provar que a troca também apaga a memória da conversa.
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
create table if not exists langgraph.checkpoint_blobs (
  thread_id text not null,
  checkpoint_ns text not null default '',
  channel text not null,
  version text not null,
  type text not null,
  blob bytea,
  primary key (thread_id, checkpoint_ns, channel, version)
);
create table if not exists langgraph.checkpoint_writes (
  thread_id text not null,
  checkpoint_ns text not null default '',
  checkpoint_id text not null,
  task_id text not null,
  idx integer not null,
  channel text not null,
  type text,
  blob bytea not null,
  task_path text not null default '',
  primary key (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

insert into auth.users (id, instance_id, aud, role, email, phone, raw_user_meta_data, raw_app_meta_data)
values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'troca-a@teste.local', '5511999990001', '{}', '{}'),
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'troca-b@teste.local', null, '{}', '{}'),
  ('00000000-0000-0000-0000-00000000b003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'troca-c@teste.local', null, '{}', '{}');

do $$
declare telefone text; verificado boolean;
begin
  -- O login legado por Phone OTP continua válido: o trigger de INSERT roda depois de
  -- handle_new_user e marca o espelho como verificado.
  select phone, whatsapp_verified into telefone, verificado from public.profiles
  where id = '00000000-0000-0000-0000-00000000b001';
  assert telefone = '5511999990001', format('telefone inicial ficou %L', telefone);
  assert verificado, 'signup por telefone confirmado precisa ficar verificado';

  assert not has_function_privilege('anon', 'public.guard_auth_phone_change()', 'execute');
  assert not has_function_privilege('authenticated', 'public.guard_auth_phone_change()', 'execute');
  assert not has_function_privilege('anon', 'public.handle_auth_phone_link()', 'execute');
  assert not has_function_privilege('authenticated', 'public.handle_auth_phone_link()', 'execute');
end $$;

-- Uma tentativa ativa para o mesmo alvo não pode existir em duas contas. O Auth upstream busca
-- somente por phone_change; sem esta trava, o código pode confirmar a conta errada.
update auth.users
set phone_change = '5511999991001', phone_change_token = 'token-a', phone_change_sent_at = now()
where id = '00000000-0000-0000-0000-00000000b001';

do $$
begin
  begin
    update auth.users
    set phone_change = '5511999991001', phone_change_token = 'token-b', phone_change_sent_at = now()
    where id = '00000000-0000-0000-0000-00000000b002';
    raise exception 'duas contas ficaram com o mesmo phone_change';
  exception when unique_violation then
    null;
  end;
end $$;

-- Depois da janela do OTP, a tentativa abandonada é limpa e o número pode ser pedido de novo.
update auth.users set phone_change_sent_at = now() - interval '2 hours'
where id = '00000000-0000-0000-0000-00000000b001';
update auth.users
set phone_change = '5511999991001', phone_change_token = 'token-b', phone_change_sent_at = now()
where id = '00000000-0000-0000-0000-00000000b002';

do $$
declare anterior text; atual text;
begin
  select phone_change into anterior from auth.users
  where id = '00000000-0000-0000-0000-00000000b001';
  select phone_change into atual from auth.users
  where id = '00000000-0000-0000-0000-00000000b002';
  assert anterior = '', format('tentativa vencida não foi limpa: %L', anterior);
  assert atual = '5511999991001', format('nova tentativa não foi gravada: %L', atual);
end $$;

-- Conversa viva no número antigo: trocar o telefone precisa remover todos os lugares capazes de
-- interpretar um "sim" usando contexto anterior, inclusive epochs do LangGraph.
insert into public.user_sessions
  (thread_id, phone, user_id, workspace_id, last_message_at)
select 'hash-antigo', '5511999990001', p.id, public._default_workspace(p.id), now()
from public.profiles p where p.id = '00000000-0000-0000-0000-00000000b001';

insert into public.pending_actions
  (session_id, thread_id, phone, user_id, workspace_id, action, summary)
select s.id, 'hash-antigo:2', s.phone, s.user_id, s.workspace_id, '{"type":"delete"}'::jsonb,
       'apagar o lançamento'
from public.user_sessions s where s.thread_id = 'hash-antigo';

insert into public.draft_actions
  (session_id, thread_id, phone, user_id, workspace_id, action, raw_text, missing)
select s.id, 'hash-antigo:2', s.phone, s.user_id, s.workspace_id, '{}'::jsonb, 'comprei um mac',
       'qual foi o valor?'
from public.user_sessions s where s.thread_id = 'hash-antigo';

insert into public.messages_queue (wa_message_id, thread_id, phone, message_type, payload)
values ('phone-link-pendente', 'hash-antigo', '5511999990001', 'text', '{"text":"sim"}');

-- A mesma pessoa tem uma conversa aberta na aba Agente. Ela não fala com o número, e por isso
-- precisa sobreviver inteira à troca — histórico, checkpoint e tudo.
insert into public.user_sessions
  (thread_id, channel, user_id, workspace_id, title, first_client_message_id, last_message_at)
select 'app-do-mesmo-dono', 'app', p.id, public._default_workspace(p.id), 'Orçamento',
       '00000000-0000-0000-0000-0000000000f1', now()
from public.profiles p where p.id = '00000000-0000-0000-0000-00000000b001';

insert into public.app_chat_messages
  (session_id, client_message_id, role, content, status)
select s.id, '00000000-0000-0000-0000-0000000000f1', 'user', 'quanto sobrou?', 'completed'
from public.user_sessions s where s.thread_id = 'app-do-mesmo-dono';

insert into langgraph.checkpoints
  (thread_id, checkpoint_id, type, checkpoint, metadata)
values
  ('hash-antigo', 'cp-0', 'json', '{}', '{}'),
  ('app-do-mesmo-dono', 'cp-app', 'json', '{}', '{}'),
  ('hash-antigo:2', 'cp-2', 'json', '{}', '{}'),
  ('hash-outro', 'cp-x', 'json', '{}', '{}');
insert into langgraph.checkpoint_blobs
  (thread_id, channel, version, type, blob)
values ('hash-antigo:2', 'messages', '1', 'bytes', '\x01');
insert into langgraph.checkpoint_writes
  (thread_id, checkpoint_id, task_id, idx, channel, type, blob)
values ('hash-antigo:2', 'cp-2', 'task', 0, 'messages', 'bytes', '\x01');

-- Representa o instante em que o Auth confirmou o phone_change: só agora `phone` muda.
update auth.users set phone = '5511999990002'
where id = '00000000-0000-0000-0000-00000000b001';

do $$
declare n integer; telefone text; verificado boolean;
begin
  select phone, whatsapp_verified into telefone, verificado from public.profiles
  where id = '00000000-0000-0000-0000-00000000b001';
  assert telefone = '5511999990002', format('profile ficou com %L', telefone);
  assert verificado, 'telefone confirmado precisa marcar whatsapp_verified';

  select count(*) into n from public.user_sessions where thread_id = 'hash-antigo';
  assert n = 0, 'user_sessions antiga sobreviveu';
  select count(*) into n from public.pending_actions where thread_id = 'hash-antigo:2';
  assert n = 0, 'confirmação antiga sobreviveu';
  select count(*) into n from public.draft_actions where thread_id = 'hash-antigo:2';
  assert n = 0, 'rascunho antigo sobreviveu';
  select count(*) into n from public.messages_queue where wa_message_id = 'phone-link-pendente';
  assert n = 0, 'mensagem pendente do número antigo sobreviveu';
  select count(*) into n from langgraph.checkpoints where thread_id like 'hash-antigo%';
  assert n = 0, 'checkpoint antigo sobreviveu';
  select count(*) into n from langgraph.checkpoint_blobs where thread_id = 'hash-antigo:2';
  assert n = 0, 'blob antigo sobreviveu';
  select count(*) into n from langgraph.checkpoint_writes where thread_id = 'hash-antigo:2';
  assert n = 0, 'write antigo sobreviveu';
  select count(*) into n from langgraph.checkpoints where thread_id = 'hash-outro';
  assert n = 1, 'checkpoint de outra conversa foi apagado';

  -- A limpeza existe para o "sim" não ser lido com o contexto do número antigo. A aba Agente
  -- não tem número, então trocar de telefone não pode apagar o que a pessoa escreveu no app.
  select count(*) into n from public.user_sessions where thread_id = 'app-do-mesmo-dono';
  assert n = 1, 'a troca de telefone apagou a conversa do app';
  -- Escopado na sessão DESTE teste, nunca `count(*)` da tabela inteira: o banco
  -- local guarda conversas de outras execuções e a asserção global falhava
  -- dizendo que a troca apagou o histórico, quando nada tinha sido apagado.
  select count(*) into n from public.app_chat_messages m
  join public.user_sessions s on s.id = m.session_id
  where s.thread_id = 'app-do-mesmo-dono';
  assert n = 1, 'a troca de telefone apagou o histórico do app';
  select count(*) into n from langgraph.checkpoints where thread_id = 'app-do-mesmo-dono';
  assert n = 1, 'a troca de telefone apagou o checkpoint da conversa do app';
end $$;

rollback;
\echo '✓ vínculo de telefone verificado'
