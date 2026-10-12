-- Reportar resposta da IA (política da Google Play para conteúdo gerado por IA).
-- O relato guarda uma CÓPIA do texto: a conversa pode ser apagada e o relato continua legível
-- para análise, por isso `message_id`/`session_id` não têm FK. Escrita e leitura só pelo serviço.
create table public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  session_id uuid,
  message_id uuid,
  content text not null,
  reason text not null check (reason in ('ofensiva', 'errada', 'outra')),
  note text check (note is null or pg_catalog.char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);

alter table public.ai_reports enable row level security;
-- sem policy: só o serviço (papel que ignora RLS) lê e escreve
revoke all on public.ai_reports from public, anon, authenticated;

create index ai_reports_created_idx on public.ai_reports (created_at desc);

comment on table public.ai_reports is
  'Relato de resposta da IA feito pela pessoa no chat do app: motivo, nota e cópia do texto. Sai com a conta (cascade).';
