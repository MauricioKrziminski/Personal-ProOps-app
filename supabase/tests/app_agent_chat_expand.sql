-- A fase EXPAND (0055) não pode quebrar o agente que já está no ar.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/app_agent_chat_expand.sql
--
-- O par 0055/0056 existe porque uma falha do worker vira `mark_retry`, e na 3ª a mensagem do
-- usuário fica `failed` para sempre. O que prova que o par valeu a pena não é a 0056 — é este
-- arquivo, que exercita as MESMAS queries do agente anterior contra o schema novo.
--
-- ⚠️ Roda contra o banco local, que já tem a 0056 aplicada. Por isso cada caso diz explicitamente
-- se depende da janela (0055 sozinha) ou do estado final. Os que dependem da janela recriam a
-- condição à mão, para o arquivo continuar valendo depois do contract.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, instance_id, aud, role, email, phone, raw_user_meta_data, raw_app_meta_data)
values ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'expand@teste.local', '5511977770001', '{}', '{}');

insert into public.user_sessions (thread_id, phone, user_id, workspace_id, last_message_at)
select 'expand-wa', '5511977770001', p.id, public._default_workspace(p.id), now()
from public.profiles p where p.id = '00000000-0000-0000-0000-00000000e001';

-- ===========================================================================
-- 1. A ORDEM das duas migrations está escrita, e nesta ordem
-- ===========================================================================
do $$
declare v_0055 boolean; v_0056 boolean;
begin
  select exists (select 1 from supabase_migrations.schema_migrations where version = '0055'),
         exists (select 1 from supabase_migrations.schema_migrations where version = '0056')
    into v_0055, v_0056;
  assert v_0055, 'a 0055 (expand) não está aplicada';
  assert v_0056, 'a 0056 (contract) não está aplicada — o banco local roda as duas';
end $$;

-- ===========================================================================
-- 2. Estado final: session_id é obrigatório e o unique por telefone saiu
-- ===========================================================================
do $$
begin
  assert (select attnotnull from pg_attribute
          where attrelid = 'public.pending_actions'::regclass and attname = 'session_id'),
    'a 0056 não fechou pending_actions.session_id';
  assert (select attnotnull from pg_attribute
          where attrelid = 'public.draft_actions'::regclass and attname = 'session_id'),
    'a 0056 não fechou draft_actions.session_id';

  assert not exists (select 1 from pg_indexes
                     where schemaname = 'public' and indexname = 'draft_actions_one_per_phone'),
    'o unique por telefone sobreviveu à 0056 — no app não existe telefone para ele guardar';
  assert exists (select 1 from pg_indexes
                 where schemaname = 'public' and indexname = 'draft_actions_one_per_session'),
    'o unique por sessão não existe';

  -- a muleta da janela não pode ficar no banco depois do contract
  assert to_regprocedure('private.fill_action_session_id()') is null,
    'o trigger da janela sobreviveu à 0056';
end $$;

-- ===========================================================================
-- 3. A JANELA: com a 0055 sozinha, o agente ANTERIOR continua escrevendo
-- ===========================================================================
-- Recria o estado intermediário e roda, letra por letra, as queries que o agente anterior
-- executa. É este bloco que justifica ter quebrado a migration em duas.
do $$
declare v_sessao uuid; v_id uuid; n integer;
begin
  select id into v_sessao from public.user_sessions where thread_id = 'expand-wa';

  -- volta ao schema da 0055
  alter table public.pending_actions alter column session_id drop not null;
  alter table public.draft_actions alter column session_id drop not null;
  create unique index draft_actions_one_per_phone on public.draft_actions (phone);
  alter table public.executed_actions rename column source_message_id to wa_message_id;

  create function private.fill_action_session_id()
  returns trigger language plpgsql security definer set search_path = '' as $f$
  begin
    if new.session_id is null and new.phone is not null then
      select s.id into new.session_id
      from public.user_sessions s
      where s.phone = new.phone and s.channel = 'whatsapp';
    end if;
    return new;
  end;
  $f$;
  create trigger fill_session_id before insert on public.pending_actions
  for each row execute function private.fill_action_session_id();
  create trigger fill_session_id before insert on public.draft_actions
  for each row execute function private.fill_action_session_id();

  -- (a) `create_pending` do agente anterior: sem session_id nenhum
  insert into public.pending_actions (thread_id, phone, user_id, workspace_id, action, summary)
  select 'expand-wa:0', s.phone, s.user_id, s.workspace_id, '{"type":"delete"}'::jsonb, 'apagar'
  from public.user_sessions s where s.id = v_sessao;

  select session_id into v_id from public.pending_actions where thread_id = 'expand-wa:0';
  assert v_id = v_sessao,
    'a pendência do agente anterior ficou sem sessão — a 0056 não teria o que preencher';

  -- (b) `save_draft` do agente anterior: upsert com árbitro em PHONE
  insert into public.draft_actions
    (thread_id, phone, user_id, workspace_id, action, raw_text, missing)
  select 'expand-wa:0', s.phone, s.user_id, s.workspace_id, '{}'::jsonb, 'comprei um mac', 'valor?'
  from public.user_sessions s where s.id = v_sessao;

  insert into public.draft_actions
    (thread_id, phone, user_id, workspace_id, action, raw_text, missing)
  select 'expand-wa:0', s.phone, s.user_id, s.workspace_id, '{}'::jsonb, 'outro', 'valor?'
  from public.user_sessions s where s.id = v_sessao
  on conflict (phone) do update
    set raw_text = excluded.raw_text, created_at = now();

  select count(*) into n from public.draft_actions where phone = '5511977770001';
  assert n = 1, format('o upsert por telefone do agente anterior falhou: %s linhas', n);

  -- (c) `reserve_execution` do agente anterior: coluna com o nome da Meta
  insert into public.executed_actions (wa_message_id, action_index, action_type)
  values ('wamid.EXPAND', 0, 'create_transaction')
  on conflict (wa_message_id, action_index) do nothing;
  assert exists (select 1 from public.executed_actions where wa_message_id = 'wamid.EXPAND'),
    'a reserva de execução do agente anterior quebrou na janela';

  -- (d) o agente NOVO, no mesmo instante, completa aquele rascunho por session_id.
  -- Sem o trigger de (b) o rascunho teria session_id nulo, `on conflict (session_id)` não
  -- casaria com NULL e o insert cairia no unique por telefone como 23505 cru.
  insert into public.draft_actions
    (session_id, thread_id, phone, user_id, workspace_id, action, raw_text, missing)
  select v_sessao, 'expand-wa:0', s.phone, s.user_id, s.workspace_id, '{}'::jsonb,
         'comprei um mac por 8400', 'valor?'
  from public.user_sessions s where s.id = v_sessao
  on conflict (session_id) do update
    set raw_text = excluded.raw_text, created_at = now();

  select count(*) into n from public.draft_actions where session_id = v_sessao;
  assert n = 1, format('os dois agentes juntos criaram %s rascunhos na mesma conversa', n);
end $$;

rollback;
\echo '✓ a fase expand não quebra o agente anterior'
