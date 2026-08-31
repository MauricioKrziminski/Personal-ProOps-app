-- Verificação das migrations 0040/0041 contra um Postgres de verdade.
--
--   npx supabase start
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/agent_migrations.sql
--
-- Falha alto e claro (assert) em vez de imprimir tabela para alguém conferir:
-- verificação que depende de humano olhando volta a quebrar sozinha.
-- Roda inteiro dentro de uma transação e dá rollback: não suja o banco.

\set ON_ERROR_STOP on
begin;

-- O MESMO upsert que `agent/app/db.py::ensure_session` executa, com uma diferença
-- que importa saber: aqui a janela de inatividade é **6h fixas**, enquanto o
-- db.py lê `SESSION_IDLE_HOURS` do config. Mexeu no env var, mexe aqui também.
-- A função nasce e morre dentro da transação (o `rollback` do fim a remove) —
-- ela não fica no banco de ninguém.
create or replace function public.__upsert_sessao_teste(p_thread text, p_phone text)
returns void language sql as $$
  insert into public.user_sessions as s (thread_id, phone, last_message_at)
  values (p_thread, p_phone, now())
  on conflict (phone) do update
    set last_message_at = now(),
        thread_id = excluded.thread_id,
        session_epoch = case
          when s.last_message_at < now() - make_interval(hours => 6)
           and not exists (select 1 from public.pending_actions p
                           where p.phone = s.phone and p.status = 'awaiting')
          then s.session_epoch + 1 else s.session_epoch end;
$$;

-- ===========================================================================
-- 1. O upsert de sessão sob os três conflitos possíveis
-- ===========================================================================
-- `user_sessions` tem DUAS restrições únicas (thread_id PK e phone). O
-- ON CONFLICT só trata a que a query nomeia — conflitar pela outra vira 23505
-- cru. Estes casos provam que o árbitro `phone` é o certo.
do $$
declare
  v_thread text;
  v_epoch int;
begin
  -- (a) telefone novo -> insert
  perform public.__upsert_sessao_teste('hash_A', '5551000000001');
  select thread_id, session_epoch into v_thread, v_epoch
    from public.user_sessions where phone = '5551000000001';
  assert v_thread = 'hash_A', 'insert inicial não gravou o thread';
  assert v_epoch = 0, 'sessão nova deveria nascer no epoch 0';

  -- (b) mesma conversa de novo -> UPDATE, nunca 23505
  perform public.__upsert_sessao_teste('hash_A', '5551000000001');

  -- (c) THREAD_SALT trocado: mesmo telefone, thread DIFERENTE.
  -- Com árbitro em thread_id isto seria 23505 em TODA mensagem de quem já usa.
  perform public.__upsert_sessao_teste('hash_B', '5551000000001');
  select thread_id into v_thread from public.user_sessions where phone = '5551000000001';
  assert v_thread = 'hash_B', 'troca de salt deveria reescrever o thread_id';

  -- (d) silêncio longo -> a sessão gira (evita thread infinita e context rot)
  update public.user_sessions set last_message_at = now() - interval '10 hours'
    where phone = '5551000000001';
  perform public.__upsert_sessao_teste('hash_B', '5551000000001');
  select session_epoch into v_epoch from public.user_sessions where phone = '5551000000001';
  assert v_epoch = 1, format('epoch deveria ter girado para 1, veio %s', v_epoch);

  -- (e) MESMO silêncio, mas com confirmação pendente -> NÃO gira.
  -- Girar deixaria o interrupt() do LangGraph órfão e o "sim" cairia no vazio.
  insert into public.pending_actions (thread_id, phone, user_id, workspace_id, action, summary)
  values ('hash_B:1', '5551000000001', gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 'apagar algo');
  update public.user_sessions set last_message_at = now() - interval '10 hours'
    where phone = '5551000000001';
  perform public.__upsert_sessao_teste('hash_B', '5551000000001');
  select session_epoch into v_epoch from public.user_sessions where phone = '5551000000001';
  assert v_epoch = 1, 'epoch girou com confirmação pendente — o "sim" ficaria órfão';
end $$;

-- ===========================================================================
-- 2. Uma pergunta aberta por conversa
-- ===========================================================================
-- Duas perguntas simultâneas tornariam "SIM" ambíguo, que é exatamente o que
-- este mecanismo existe para evitar.
do $$
begin
  begin
    insert into public.pending_actions (thread_id, phone, user_id, workspace_id, action, summary)
    values ('hash_B:1', '5551000000001', gen_random_uuid(), gen_random_uuid(), '{}'::jsonb, 'segunda');
    assert false, 'deixou abrir DUAS confirmações na mesma conversa';
  exception when unique_violation then
    null; -- esperado
  end;
end $$;

do $$
declare n int;
begin
  update public.pending_actions set expires_at = now() - interval '1 minute'
    where thread_id = 'hash_B:1';
  select public.expire_pending_actions('hash_B:1') into n;
  assert n = 1, format('expire_pending_actions devolveu %s, esperado 1', n);
end $$;

-- ===========================================================================
-- 3. claim_thread_batch
-- ===========================================================================
do $$
declare n int;
begin
  insert into public.messages_queue (wa_message_id, thread_id, phone, message_type, payload)
  values ('t.1','T1','5551000000001','text','{}'::jsonb),
         ('t.2','T1','5551000000001','text','{}'::jsonb),
         ('t.3','T1','5551000000001','text','{}'::jsonb);

  -- o LOTE inteiro vem junto: é o debounce virando UMA execução do grafo
  select count(*) into n from public.claim_thread_batch('T1');
  assert n = 3, format('lote deveria ter 3 mensagens, veio %s', n);

  -- conversa ocupada devolve vazio: um worker por conversa, senão "gastei 45" e
  -- "apaga o último" correriam fora de ordem
  insert into public.messages_queue (wa_message_id, thread_id, phone, message_type, payload)
  values ('t.4','T1','5551000000001','text','{}'::jsonb);
  select count(*) into n from public.claim_thread_batch('T1');
  assert n = 0, format('thread ocupada deveria devolver 0, veio %s', n);

  -- passados 5 minutos o worker é dado como morto e a conversa volta a ser livre
  update public.messages_queue set claimed_at = now() - interval '6 minutes'
    where thread_id = 'T1' and status = 'processing';
  select count(*) into n from public.claim_thread_batch('T1');
  assert n = 1, format('órfão deveria liberar 1, veio %s', n);
end $$;

do $$
declare v_quais text;
begin
  -- retentativa NÃO se mistura com mensagem nova: a chave de idempotência é o
  -- wa_message_id da ÚLTIMA do lote, e recompor o lote mudaria a chave — as
  -- ações já executadas rodariam de novo.
  update public.messages_queue set status = 'done' where thread_id = 'T1';
  insert into public.messages_queue (wa_message_id, thread_id, phone, message_type, payload, retry_count)
  values ('t.5','T1','5551000000001','text','{}'::jsonb, 1);
  insert into public.messages_queue (wa_message_id, thread_id, phone, message_type, payload)
  values ('t.6','T1','5551000000001','text','{}'::jsonb);

  select string_agg(wa_message_id, ',' order by wa_message_id)
    into v_quais from public.claim_thread_batch('T1');
  assert v_quais = 't.5', format('lote deveria ser só a retentativa, veio %s', v_quais);
end $$;

-- ===========================================================================
-- 4. Idempotência de execução
-- ===========================================================================
do $$
declare n int;
begin
  insert into public.executed_actions (wa_message_id, action_index, action_type)
  values ('t.1', 0, 'create_expense');

  with tentativa as (
    insert into public.executed_actions (wa_message_id, action_index, action_type)
    values ('t.1', 0, 'create_expense')
    on conflict (wa_message_id, action_index) do nothing
    returning 1
  ) select count(*) into n from tentativa;
  assert n = 0, 'reserva repetida passou — reprocessar duplicaria lançamento';
end $$;

-- ===========================================================================
-- 5. Roteamento do corte, com e sem o 9º dígito
-- ===========================================================================
do $$
begin
  insert into public.agent_routing (phone, use_python_agent) values ('5551992553295', true);
  assert public.routes_to_python('5551992553295'), 'não casou com o número cadastrado';
  assert public.routes_to_python('555192553295'), 'não casou sem o 9º dígito (a Meta manda assim)';
  assert public.routes_to_python('+55 (51) 99255-3295'), 'não casou com o número formatado';
  assert not public.routes_to_python('5511999998888'), 'roteou um número que não está na flag';
end $$;

-- ===========================================================================
-- 6. O checkpointer fica fora do alcance da anon key
-- ===========================================================================
-- As tabelas de checkpoint guardam o conteúdo das conversas (valores, contas,
-- notas). Em `public` elas seriam legíveis pelo PostgREST.
do $$
begin
  assert not has_schema_privilege('anon', 'langgraph', 'USAGE'),
    'anon enxerga o schema langgraph — o conteúdo das conversas vaza';
  assert not has_schema_privilege('authenticated', 'langgraph', 'USAGE'),
    'authenticated enxerga o schema langgraph';
end $$;

rollback;
\echo '✓ 0040/0041 verificadas'
