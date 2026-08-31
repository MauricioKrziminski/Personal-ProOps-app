-- Rascunhos: extração financeira incompleta que fica esperando o dado que falta.
--
-- "comprei um mac em 12x" tem intenção clara e falta o valor. Descartar obriga o
-- usuário a repetir a frase inteira; perguntar e travar a conversa impede que ele
-- mude de assunto. O rascunho resolve os dois: fica inerte no banco enquanto a
-- vida segue, e volta quando ele mandar o valor.
--
-- ⚠️ TABELA PRÓPRIA, e não `pending_actions` com kind='draft', por causa do
-- índice `pending_actions_one_open_per_thread`: um rascunho ali ocuparia o slot
-- da única pergunta aberta por conversa e bloquearia toda confirmação real —
-- que é o oposto da troca livre de contexto que ele existe para permitir.

create table if not exists public.draft_actions (
  id           uuid primary key default gen_random_uuid(),
  thread_id    text not null,
  phone        text not null references public.user_sessions (phone) on delete cascade,
  user_id      uuid not null,
  workspace_id uuid not null,
  -- a extração parcial, no mesmo formato de `pending_actions.action`
  action       jsonb not null,
  -- o texto cru que originou o rascunho: é o que permite remontar a frase
  -- ("seu rascunho do mac em 12x") sem gastar modelo
  raw_text     text not null,
  -- a pergunta que foi ao usuário, para poder repeti-la sem reinventar
  missing      text not null,
  -- 24h: rascunho de anteontem ressurgindo quando o usuário digita um número
  -- solto seria pior que não ter rascunho nenhum
  expires_at   timestamptz not null default now() + interval '24 hours',
  created_at   timestamptz not null default now()
);

alter table public.draft_actions enable row level security;
-- sem policies: tabela de infra, só o serviço (que ignora RLS) escreve aqui

-- Um rascunho ativo por conversa. Dois tornariam "foi 5000" ambíguo, pelo mesmo
-- motivo que duas perguntas abertas tornariam "sim" ambíguo.
create unique index if not exists draft_actions_one_per_thread
  on public.draft_actions (thread_id);

create index if not exists draft_actions_by_phone
  on public.draft_actions (phone, expires_at desc);

-- Limpeza: rascunho vencido nunca deve ser lido. Chamada junto do sweep, que já
-- roda a cada minuto — não vale um cron novo.
create or replace function public.expire_draft_actions()
returns integer
language sql
security definer
set search_path = public
as $$
  with mortos as (
    delete from public.draft_actions where expires_at <= now() returning 1
  )
  select count(*)::int from mortos;
$$;
revoke execute on function public.expire_draft_actions() from public, anon, authenticated;
