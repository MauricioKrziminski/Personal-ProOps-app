-- Fase CONTRACT do par 0055/0056.
--
-- ⚠️ SÓ APLICAR DEPOIS QUE O CLOUD RUN ESTIVER NA REVISÃO NOVA. A ordem é:
--
--     0055  →  deploy do agente  →  0056
--
-- Cada linha aqui quebra o agente ANTERIOR de propósito, porque a essa altura ele não existe
-- mais. Aplicada cedo, cada falha do worker vira `mark_retry` e na 3ª a mensagem do usuário
-- fica `failed` para sempre — não é atraso, é mensagem perdida.
--
-- Para saber se já pode: o agente novo grava `session_id` em toda pendência e todo rascunho, e
-- usa `on conflict (session_id)`. A checagem do backfill abaixo falha alto se ainda houver
-- linha do formato antigo viva.

-- ===========================================================================
-- 1. A muleta da janela sai
-- ===========================================================================
-- O trigger da 0055 preenchia `session_id` para o agente que não sabia preencher. Ele existia
-- só para a janela entre as duas migrations.

drop trigger if exists fill_session_id on public.pending_actions;
drop trigger if exists fill_session_id on public.draft_actions;
drop function if exists private.fill_action_session_id();

-- ===========================================================================
-- 2. session_id vira obrigatório
-- ===========================================================================
-- Repete o backfill da 0055: linha escrita durante a janela por um caminho que o trigger não
-- cobriu (telefone sem sessão, por exemplo) ainda pode estar nula.

update public.pending_actions p
set session_id = s.id
from public.user_sessions s
where p.session_id is null and s.phone = p.phone;

update public.draft_actions d
set session_id = s.id
from public.user_sessions s
where d.session_id is null and s.phone = d.phone;

-- Pendência viva expira em 10 min e rascunho em 24h: o que sobrou nulo aqui é lixo de uma
-- sessão que já não existe. Apagar é mais correto que inventar dono.
delete from public.pending_actions where session_id is null;
delete from public.draft_actions where session_id is null;

alter table public.pending_actions alter column session_id set not null;
alter table public.draft_actions alter column session_id set not null;

-- ===========================================================================
-- 3. O rascunho é um por CONVERSA, e só
-- ===========================================================================
-- O unique por telefone sobreviveu à 0055 porque o `on conflict (phone)` do agente antigo
-- dependia dele. Com o agente novo no ar, ele passa a ser uma segunda chave para a mesma coisa
-- — e a errada, porque a conversa do app não tem telefone.

drop index if exists public.draft_actions_one_per_phone;

-- ===========================================================================
-- 4. A reserva de execução serve aos dois canais
-- ===========================================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'executed_actions'
      and column_name = 'wa_message_id'
  ) then
    alter table public.executed_actions rename column wa_message_id to source_message_id;
  end if;
end $$;

comment on column public.executed_actions.source_message_id is
  'Chave de idempotência do turno: id da Meta no WhatsApp, app:<uuid do cliente> no app.';

-- `messages_queue.wa_message_id` NÃO muda: aquela tabela é exclusiva do WhatsApp e o nome da
-- Meta ali é a verdade, não legado.
