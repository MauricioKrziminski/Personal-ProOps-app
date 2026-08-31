-- Suporte ao agente Python (FastAPI + LangGraph) que substitui o par
-- whatsapp-webhook / process-jobs.
--
-- Três problemas do fluxo antigo morrem aqui, por construção:
--   1. messages_queue É a tabela de entrada (o webhook antigo escrevia em
--      messages_raw e DEPOIS em jobs, sem transação: se o segundo insert
--      falhasse, o retry da Meta batia no dedupe e a mensagem sumia);
--   2. executed_actions dá idempotência por AÇÃO (o process-jobs executava
--      antes de marcar done, então job órfão re-executado duplicava lançamento);
--   3. pending_actions é o que faltava para existir confirmação humana.

-- ---------------------------------------------------------------------------
-- schema isolado para o checkpointer do LangGraph
-- ---------------------------------------------------------------------------
-- As tabelas de checkpoint (checkpoints, checkpoint_blobs, checkpoint_writes)
-- guardam o CONTEÚDO das conversas — valores, contas, notas. Criadas em `public`
-- elas ficariam legíveis pelo PostgREST com a anon key. Mesmo motivo pelo qual
-- `private.my_workspace_ids()` não mora em public.
-- O AsyncPostgresSaver.setup() as cria aqui via search_path na connection string.
create schema if not exists langgraph;
revoke all on schema langgraph from public;
revoke all on schema langgraph from anon, authenticated;

-- ---------------------------------------------------------------------------
-- messages_queue: fila de entrada. O webhook grava e responde 200.
-- ---------------------------------------------------------------------------
create table if not exists public.messages_queue (
  id            uuid primary key default gen_random_uuid(),
  -- idempotência de ENTRADA: a Meta reenvia o mesmo webhook várias vezes
  wa_message_id text unique not null,
  thread_id     text not null,
  phone         text not null,
  user_id       uuid references public.profiles (id) on delete set null,
  workspace_id  uuid references public.workspaces (id) on delete cascade,
  message_type  text,
  payload       jsonb not null,
  status        text not null default 'pending'
                check (status in ('pending', 'processing', 'done', 'failed')),
  retry_count   int not null default 0,
  last_error    text,
  -- lote consolidado pelo debounce: N mensagens rápidas = 1 execução do grafo
  batch_id      uuid,
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  processed_at  timestamptz
);

-- o worker sempre pergunta "o que está pendente NESTA thread, em ordem"
create index if not exists messages_queue_thread_pending_idx
  on public.messages_queue (thread_id, created_at)
  where status = 'pending';
-- Duas perguntas quentes sobre `processing`, ambas cobertas por este índice:
--   1. "esta conversa está ocupada?" (thread_id + claimed_at recente) — roda em
--      TODA reivindicação, então não pode ser seq scan;
--   2. "há órfão para o sweep?" (claimed_at antigo).
-- Com `(claimed_at)` sozinho a primeira varreria todos os processing do sistema.
create index if not exists messages_queue_claimed_idx
  on public.messages_queue (thread_id, claimed_at)
  where status = 'processing';

alter table public.messages_queue enable row level security;
-- sem policies: apenas service_role (o app nunca lê a fila)

-- ---------------------------------------------------------------------------
-- user_sessions: telefone <-> thread do LangGraph
-- ---------------------------------------------------------------------------
-- thread_id é sha256(salt + telefone): o checkpoint guarda dado financeiro e o
-- identificador não precisa ser reversível.
--
-- session_epoch corta a conversa depois de horas de silêncio (thread infinita =
-- context rot + checkpoint sem fim). O thread_id EFETIVO é `thread_id:epoch`.
-- Regra inegociável: com pending_action em 'awaiting', o epoch NÃO gira —
-- resumir um interrupt() exige exatamente o mesmo thread_id.
create table if not exists public.user_sessions (
  thread_id          text primary key,
  phone              text unique not null,
  user_id            uuid references public.profiles (id) on delete cascade,
  workspace_id       uuid references public.workspaces (id) on delete cascade,
  timezone           text not null default 'America/Sao_Paulo',
  session_epoch      int not null default 0,
  last_message_at    timestamptz,
  -- nome da task de debounce agendada no Cloud Tasks (a próxima mensagem apaga
  -- esta e agenda outra: janela deslizante de verdade, não bucket)
  debounce_task_name text,
  created_at         timestamptz not null default now()
);

alter table public.user_sessions enable row level security;

-- ⚠️ SOBRE O UPSERT DESTA TABELA (a análise está em agent.md; o resumo é este):
-- ela tem DUAS restrições únicas — `thread_id` (PK) e `phone`. O `ON CONFLICT` só
-- sabe tratar o índice que a query nomeia; conflitar pelo OUTRO vira 23505 cru.
-- O árbitro correto é **`phone`**, não `thread_id`:
--   • telefone conhecido, mesmo thread  -> DO UPDATE (o caso normal);
--   • telefone conhecido, thread NOVO   -> DO UPDATE reescreve o thread_id, que é
--     o que acontece se o THREAD_SALT for trocado. Com árbitro em thread_id isso
--     seria 23505 em TODA mensagem de usuário existente;
--   • telefone novo                     -> insert simples.
-- O caminho inverso (thread colidir sem o telefone colidir) exigiria colisão de
-- SHA-256 truncado em 128 bits — e aí 23505 alto e claro é a resposta certa.

-- ---------------------------------------------------------------------------
-- pending_actions: o que espera um SIM do usuário
-- ---------------------------------------------------------------------------
-- Complementar ao checkpointer, não redundante: o checkpoint guarda o estado do
-- grafo, mas o worker precisa saber ANTES de acordar o grafo que a mensagem
-- "sim" é resposta a uma pergunta.
--
-- thread_id aqui é o EFETIVO (`hash:epoch`), o mesmo que vai no config do
-- LangGraph. Por isso não há FK para user_sessions.thread_id (que guarda o hash
-- base) — a ponte é o telefone.
create table if not exists public.pending_actions (
  id           uuid primary key default gen_random_uuid(),
  thread_id    text not null,
  phone        text not null references public.user_sessions (phone) on delete cascade,
  user_id      uuid not null,
  workspace_id uuid not null,
  -- ActionSpec já validado pelo Nível 1 (guards.py) ANTES de virar pergunta:
  -- nunca se pergunta sobre uma ação que não passaria na validação.
  action       jsonb not null,
  -- a frase exata que foi ao WhatsApp — o usuário confirma o que LEU
  summary      text not null,
  status       text not null default 'awaiting'
               check (status in ('awaiting', 'approved', 'rejected', 'expired')),
  expires_at   timestamptz not null default now() + interval '10 minutes',
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

-- uma pergunta aberta por conversa. Duas perguntas simultâneas tornariam "sim"
-- ambíguo, que é exatamente o que este mecanismo existe para evitar.
create unique index if not exists pending_actions_one_open_per_thread
  on public.pending_actions (thread_id)
  where status = 'awaiting';

-- o worker pergunta "este telefone tem confirmação aberta?" antes de CADA
-- mensagem — é o fast-path do SIM/NÃO, e ele não pode custar seq scan
create index if not exists pending_actions_open_by_phone
  on public.pending_actions (phone)
  where status = 'awaiting';

alter table public.pending_actions enable row level security;

-- ---------------------------------------------------------------------------
-- executed_actions: idempotência de EXECUÇÃO
-- ---------------------------------------------------------------------------
-- A tool checa esta tabela antes de escrever. Reprocessar a mensagem inteira
-- (timeout, redeploy, retry do Cloud Tasks) deixa de duplicar lançamento.
create table if not exists public.executed_actions (
  wa_message_id text not null,
  action_index  int not null,
  action_type   text not null,
  result_id     uuid,
  executed_at   timestamptz not null default now(),
  primary key (wa_message_id, action_index)
);

alter table public.executed_actions enable row level security;

-- ---------------------------------------------------------------------------
-- claim atômico do lote da thread
-- ---------------------------------------------------------------------------
-- Um telefone = uma thread = um worker por vez. O advisory lock serializa por
-- conversa (o SKIP LOCKED do fluxo antigo garantia exclusividade por JOB, o que
-- deixava "gastei 45" e "apaga o último" correrem fora de ordem).
--
-- Devolve vazio quando outro worker já está com a thread: a task duplicada do
-- Cloud Tasks vira no-op barato em vez de execução concorrente.
create or replace function public.claim_thread_batch(p_thread_id text)
returns setof public.messages_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_ocupada boolean;
  v_tem_retry boolean;
begin
  -- Serializa a reivindicação em si. NÃO serializa a execução do grafo: este
  -- lock é transacional e a transação acaba junto com o UPDATE, muito antes do
  -- Gemini responder. Quem impede duas execuções simultâneas na MESMA conversa
  -- é o teste de "processing recente" logo abaixo.
  if not pg_try_advisory_xact_lock(hashtext(p_thread_id)) then
    return;
  end if;

  -- Um worker por conversa. Sem isto, uma segunda task de debounce chegando
  -- enquanto o grafo ainda fala com o Gemini reivindicaria a mesma thread: dois
  -- escritores no mesmo checkpoint e resposta fora de ordem
  -- ("gastei 45" e "apaga o último" invertidos).
  -- Passados 5 minutos consideramos o worker morto e a thread volta a ser livre.
  select exists (
    select 1 from public.messages_queue
    where thread_id = p_thread_id
      and status = 'processing'
      and claimed_at > now() - interval '5 minutes'
  ) into v_ocupada;
  if v_ocupada then
    return;  -- o /worker/sweep pega o resto em no máximo um minuto
  end if;

  -- A idempotência de execução é chaveada no wa_message_id da ÚLTIMA mensagem do
  -- lote. Se uma retentativa juntasse mensagens NOVAS ao lote antigo, a chave
  -- mudaria e as ações já executadas rodariam de novo. Por isso: havendo
  -- retentativa pendente, o lote é só ela — as mensagens novas esperam o próximo
  -- ciclo e viram um lote próprio.
  select exists (
    select 1 from public.messages_queue
    where thread_id = p_thread_id and status = 'pending' and retry_count > 0
  ) into v_tem_retry;

  return query
  update public.messages_queue q
  set status = 'processing',
      claimed_at = now(),
      batch_id = v_batch
  where q.id in (
    select id
    from public.messages_queue
    where thread_id = p_thread_id
      and status = 'pending'
      and retry_count < 3
      and (not v_tem_retry or retry_count > 0)
    order by created_at
  )
  returning q.*;
end;
$$;

revoke execute on function public.claim_thread_batch(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- expiração de confirmações
-- ---------------------------------------------------------------------------
-- Chamada pelo worker antes de ler o pending. Não vira cron: pergunta vencida
-- só importa quando alguém volta a falar naquela conversa.
create or replace function public.expire_pending_actions(p_thread_id text default null)
returns int
language sql
security definer
set search_path = public
as $$
  with expirados as (
    update public.pending_actions
    set status = 'expired', resolved_at = now()
    where status = 'awaiting'
      and expires_at < now()
      and (p_thread_id is null or thread_id = p_thread_id)
    returning 1
  )
  select count(*)::int from expirados;
$$;

revoke execute on function public.expire_pending_actions(text) from public, anon, authenticated;
