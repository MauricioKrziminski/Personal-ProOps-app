-- Fase 5 — o agente passa a morar dentro do app.
--
-- `user_sessions` deixa de ser "uma conversa por telefone" e vira "uma conversa por canal":
-- o WhatsApp continua com telefone, epoch e debounce; o app ganha várias conversas nomeadas,
-- cada uma com o próprio histórico. Pendência, rascunho e reserva de execução deixam de
-- carregar semântica de WhatsApp no nome e passam a apontar para o id estável da sessão.
--
-- O que NÃO muda: `messages_queue` continua exclusiva do WhatsApp e mantém `wa_message_id`
-- com o nome da Meta; o upsert de sessão continua com árbitro em `phone` (ver 0040).
--
-- ⚠️ ESTA É A FASE **EXPAND** DE UM PAR. A `0056` é a fase contract e só pode ser aplicada
-- DEPOIS que o Cloud Run estiver na revisão nova. A ordem é:
--
--     0055  →  deploy do agente  →  0056
--
-- Aqui tudo que a 0055 acrescenta é OPCIONAL para o código antigo: `session_id` nasce anulável,
-- `draft_actions_one_per_phone` continua de pé e `executed_actions.wa_message_id` ainda tem o
-- nome antigo. O agente que já está no ar segue funcionando sem tocar em nada.
--
-- O motivo é o custo de errar: uma falha no worker vira `mark_retry`, e na 3ª a mensagem do
-- usuário fica `failed` para sempre. Com o retry do Cloud Tasks e o sweep de 1 minuto, três
-- tentativas queimam em minutos — não é atraso, é mensagem perdida. Precedente: 0043 → 0044.

-- ===========================================================================
-- 1. Identidade estável e canal em user_sessions
-- ===========================================================================

alter table public.user_sessions
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists channel text default 'whatsapp',
  add column if not exists title text,
  add column if not exists first_client_message_id uuid,
  add column if not exists lease_message_id uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists deleting_at timestamptz;

update public.user_sessions set id = gen_random_uuid() where id is null;
update public.user_sessions set channel = 'whatsapp' where channel is null;

alter table public.user_sessions
  alter column id set not null,
  alter column channel set not null,
  alter column channel set default 'whatsapp',
  alter column phone drop not null;

-- A PK vira o id porque `thread_id` é derivado do telefone e muda quando o THREAD_SALT gira.
-- Nenhuma FK aponta para a PK antiga (pending/draft referenciam `phone`), então a troca é direta.
alter table public.user_sessions drop constraint if exists user_sessions_pkey;
alter table public.user_sessions add primary key (id);
alter table public.user_sessions drop constraint if exists user_sessions_thread_id_key;
alter table public.user_sessions add constraint user_sessions_thread_id_key unique (thread_id);

alter table public.user_sessions drop constraint if exists user_sessions_channel_check;
alter table public.user_sessions
  add constraint user_sessions_channel_check check (channel in ('whatsapp', 'app'));

-- A forma da linha é diferente por canal, e é o banco que garante isso: um bug na borda não
-- pode criar uma conversa de app sem dono nem uma sessão de WhatsApp sem número.
alter table public.user_sessions drop constraint if exists user_sessions_shape_check;
alter table public.user_sessions add constraint user_sessions_shape_check check (
  case channel
    when 'whatsapp' then phone is not null
                     and title is null
                     and first_client_message_id is null
    when 'app' then phone is null
                and user_id is not null
                and workspace_id is not null
                and title is not null
                and first_client_message_id is not null
                and session_epoch = 0
                and debounce_task_name is null
    else false
  end
);

alter table public.user_sessions drop constraint if exists user_sessions_title_check;
alter table public.user_sessions add constraint user_sessions_title_check
  check (title is null or char_length(btrim(title)) between 1 and 80);

-- Criar conversa é idempotente pelo UUID do primeiro turno: um retry do app não abre uma
-- segunda conversa com a mesma mensagem dentro.
create unique index if not exists user_sessions_first_client_message
  on public.user_sessions (user_id, first_client_message_id);

-- A lista do app é "minhas conversas, mais recente primeiro".
create index if not exists user_sessions_app_list
  on public.user_sessions (user_id, last_message_at desc, id desc)
  where channel = 'app' and deleting_at is null;

comment on column public.user_sessions.id is
  'Id estável da conversa. thread_id deriva do telefone e muda com o THREAD_SALT; este não.';
comment on column public.user_sessions.channel is
  'whatsapp (telefone, epoch, debounce) ou app (várias conversas nomeadas por usuário).';
comment on column public.user_sessions.lease_message_id is
  'Turno que detém o processamento da conversa. Serializa o app sem lock transacional.';

-- ===========================================================================
-- 2. Pendência e rascunho apontam para a sessão, não para o telefone
-- ===========================================================================

alter table public.pending_actions add column if not exists session_id uuid;
alter table public.draft_actions add column if not exists session_id uuid;

update public.pending_actions p
set session_id = s.id
from public.user_sessions s
where p.session_id is null and s.phone = p.phone;

update public.draft_actions d
set session_id = s.id
from public.user_sessions s
where d.session_id is null and s.phone = d.phone;

-- Backfill incompleto seria uma linha órfã com `not null` prestes a falhar: falhe aqui,
-- onde o erro diz o que aconteceu, e não no `alter` seguinte.
do $$
declare n integer;
begin
  select count(*) into n from public.pending_actions where session_id is null;
  if n > 0 then
    raise exception 'pending_actions ficou com % linha(s) sem sessão', n;
  end if;
  select count(*) into n from public.draft_actions where session_id is null;
  if n > 0 then
    raise exception 'draft_actions ficou com % linha(s) sem sessão', n;
  end if;
end $$;

alter table public.pending_actions drop constraint if exists pending_actions_phone_fkey;
alter table public.draft_actions drop constraint if exists draft_actions_phone_fkey;

-- `session_id` fica ANULÁVEL nesta fase: o agente antigo não sabe preenchê-lo, e um `not null`
-- aqui derrubaria todo HITL até o deploy. Quem fecha é a 0056.
alter table public.pending_actions drop constraint if exists pending_actions_session_id_fkey;
alter table public.pending_actions
  alter column phone drop not null,
  add constraint pending_actions_session_id_fkey
    foreign key (session_id) references public.user_sessions(id) on delete cascade;

alter table public.draft_actions drop constraint if exists draft_actions_session_id_fkey;
alter table public.draft_actions
  alter column phone drop not null,
  add constraint draft_actions_session_id_fkey
    foreign key (session_id) references public.user_sessions(id) on delete cascade;

-- Preenche `session_id` para quem ainda não sabe preenchê-lo. Existe SÓ na janela entre esta
-- migration e o deploy, e a 0056 remove.
--
-- Sem isto a janela teria um buraco estreito e real: o agente antigo gravaria um rascunho com
-- `session_id` nulo, e o agente novo, ao completar aquele mesmo rascunho, tentaria
-- `on conflict (session_id)` — que não casa com NULL — e cairia no unique por telefone como
-- 23505 cru. Uma mensagem perdida por causa de um índice é caro demais para 12 linhas.
create or replace function private.fill_action_session_id()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.session_id is null and new.phone is not null then
    select s.id into new.session_id
    from public.user_sessions s
    where s.phone = new.phone and s.channel = 'whatsapp';
  end if;
  return new;
end;
$$;

revoke execute on function private.fill_action_session_id() from public, anon, authenticated;

drop trigger if exists fill_session_id on public.pending_actions;
create trigger fill_session_id before insert on public.pending_actions
for each row execute function private.fill_action_session_id();

drop trigger if exists fill_session_id on public.draft_actions;
create trigger fill_session_id before insert on public.draft_actions
for each row execute function private.fill_action_session_id();

-- O rascunho passa a ser um por CONVERSA. O unique por TELEFONE continua de pé nesta fase —
-- é dele que o `on conflict (phone)` do agente antigo depende. A 0056 derruba.
create unique index if not exists draft_actions_one_per_session
  on public.draft_actions (session_id);

-- Duas pendências abertas da mesma pessoa eram legais sob a chave antiga: `thread_id` carrega o
-- epoch e `ensure_session` reescreve o thread quando o THREAD_SALT gira, então um giro com
-- pergunta aberta deixava dois `awaiting` sob threads diferentes. Pela sessão isso colide, e o
-- índice abaixo abortaria a migration no meio. Aposenta o mais antigo primeiro — é o que a 0044
-- fez antes de criar o unique dela.
update public.pending_actions p
set status = 'expired', resolved_at = now()
where p.status = 'awaiting'
  and exists (
    select 1 from public.pending_actions q
    where q.session_id = p.session_id
      and q.status = 'awaiting'
      and (q.created_at, q.id) > (p.created_at, p.id)
  );

-- A trava por thread continua para o WhatsApp (o epoch entra no thread_id); a nova cobre o app,
-- onde thread_id é aleatório e a identidade da conversa é a sessão. O unique parcial já serve a
-- consulta "tem pergunta aberta nesta conversa?" — um índice comum ao lado seria custo por
-- insert sem leitura nova.
create unique index if not exists pending_actions_one_open_per_session
  on public.pending_actions (session_id) where status = 'awaiting';

-- (A reserva de execução é renomeada na 0056: o nome da coluna quebra o agente antigo
--  no primeiro lançamento, e por isso espera o deploy.)

-- ===========================================================================
-- 4. Mensagens do app
-- ===========================================================================

create table if not exists public.app_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.user_sessions(id) on delete cascade,
  sequence bigint generated always as identity,
  client_message_id uuid,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (btrim(content) <> ''),
  ui_payload jsonb,
  in_reply_to uuid,
  status text not null check (status in ('processing', 'completed', 'failed')),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (session_id, sequence),
  unique (session_id, client_message_id),
  unique (session_id, id),
  foreign key (session_id, in_reply_to)
    references public.app_chat_messages(session_id, id) on delete cascade,
  constraint app_chat_messages_user_shape check (
    role <> 'user' or (client_message_id is not null and in_reply_to is null)
  ),
  constraint app_chat_messages_assistant_shape check (
    role <> 'assistant'
    or (client_message_id is null and in_reply_to is not null and status = 'completed')
  ),
  constraint app_chat_messages_error_shape check (
    (error_code is null) or status = 'failed'
  )
);

-- Sem índice de histórico: `unique (session_id, sequence)` é um btree e varre para trás sem
-- custo, então um (session_id, sequence desc) ao lado só encareceria o insert.
create index if not exists app_chat_messages_reply
  on public.app_chat_messages (session_id, in_reply_to);

-- Infraestrutura: RLS ligada, sem policy, e o cliente não fala com a tabela. O app lê o
-- histórico pelo FastAPI, que valida o JWT e a propriedade da conversa.
alter table public.app_chat_messages enable row level security;
revoke all on public.app_chat_messages from anon, authenticated;
-- `revoke all on <tabela>` NÃO alcança a sequence da coluna identity, e a 0039 concede
-- `usage, select on sequences` por default privileges a todo objeto novo do schema. Sem esta
-- linha sobra `nextval`/`currval`: dá para queimar valores e ler o contador global de turnos.
revoke all on sequence public.app_chat_messages_sequence_seq from anon, authenticated;

comment on table public.app_chat_messages is
  'Turnos da aba Agente. Só o serviço lê e escreve; o app passa pelo FastAPI.';

-- ===========================================================================
-- 5. Trocar o telefone não pode apagar o app
-- ===========================================================================
-- Redefinição da função viva da 0053. A única mudança é o filtro `channel = 'whatsapp'`: a
-- limpeza existe para impedir que um "sim" seja interpretado com o contexto do número antigo,
-- e o histórico do app não tem nada a ver com o número.

create or replace function public.handle_auth_phone_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  telefone_anterior text;
  telefone_novo text := nullif(new.phone, '');
  sessao record;
  tabela text;
begin
  if tg_op = 'UPDATE' then
    if new.phone is not distinct from old.phone then
      return new;
    end if;
    telefone_anterior := nullif(old.phone, '');
  elsif telefone_novo is null then
    return new;
  end if;

  update public.profiles
  set phone = telefone_novo,
      whatsapp_verified = (telefone_novo is not null)
  where id = new.id;

  -- Inclui três origens: sessão já anexada ao user_id, número anterior e número novo. A última
  -- remove uma sessão órfã criada quando a pessoa escreveu antes de terminar a vinculação e
  -- impede que um telefone reciclado herde o checkpoint do dono anterior.
  for sessao in
    select s.thread_id
    from public.user_sessions s
    where s.channel = 'whatsapp'
      and (
        s.user_id = new.id
        or (
          telefone_anterior is not null
          and private.canonical_whatsapp_phone(s.phone)
              = private.canonical_whatsapp_phone(telefone_anterior)
        )
        or (
          telefone_novo is not null
          and private.canonical_whatsapp_phone(s.phone)
              = private.canonical_whatsapp_phone(telefone_novo)
        )
      )
  loop
    -- Uma mensagem ainda não processada não pode acordar a conversa que acabamos de aposentar.
    delete from public.messages_queue
    where thread_id = sessao.thread_id and status in ('pending', 'processing');

    -- As tabelas são criadas no startup do agente. `to_regclass` mantém signup e testes válidos
    -- antes desse primeiro startup. Todos os epochs compartilham `hash:` como prefixo.
    foreach tabela in array array['checkpoints', 'checkpoint_blobs', 'checkpoint_writes']
    loop
      if pg_catalog.to_regclass('langgraph.' || tabela) is not null then
        execute pg_catalog.format(
          'delete from langgraph.%I where thread_id = $1 or '
          'pg_catalog.left(thread_id, pg_catalog.length($1) + 1) = $1 || '':''',
          tabela
        ) using sessao.thread_id;
      end if;
    end loop;
  end loop;

  -- `pending_actions` e `draft_actions` têm FK com ON DELETE CASCADE para esta linha.
  delete from public.user_sessions s
  where s.channel = 'whatsapp'
    and (
      s.user_id = new.id
      or (
        telefone_anterior is not null
        and private.canonical_whatsapp_phone(s.phone)
            = private.canonical_whatsapp_phone(telefone_anterior)
      )
      or (
        telefone_novo is not null
        and private.canonical_whatsapp_phone(s.phone)
            = private.canonical_whatsapp_phone(telefone_novo)
      )
    );

  return new;
end;
$$;

revoke execute on function public.handle_auth_phone_link() from public, anon, authenticated;
