-- Lançamentos capturados das notificações dos bancos (Android).
-- Spec: docs/superpowers/specs/2026-10-12-captura-de-lancamentos-design.md
-- Quem INSERE é o agente (`POST /internal/captures/notifications`, papel que ignora RLS). O app só lê e
-- muda o status (confirmar/descartar) e apaga o texto da notificação ao resolver.
create table if not exists public.captured_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- id calculado no aparelho (pacote + texto + janela de 5 min): a mesma notificação não entra duas vezes
  external_id text not null check (char_length(external_id) between 8 and 128),
  bank text not null check (char_length(bank) between 1 and 128),
  posted_at timestamptz not null,
  -- o texto da notificação só enquanto o item está em aberto (o app o apaga ao resolver)
  texto text check (char_length(texto) <= 1300),
  status text not null default 'pending'
    check (status in ('pending','duplicate','confirmed','discarded','ignored')),
  -- `RascunhoOut` do agente: {tipo, params, perguntas, entendido} — o que `/finance/lancar` lê
  draft jsonb check (draft is null or jsonb_typeof(draft) = 'object'),
  entendido text,
  kind text check (kind in ('expense','income')),
  amount_cents bigint check (amount_cents > 0),
  occurred_at date,
  -- o lançamento que a conciliação achou (status duplicate)
  match_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, external_id),
  check (status in ('ignored','discarded','confirmed') or draft is not null)
);
create index if not exists captured_notifications_ws_status_idx
  on public.captured_notifications (workspace_id, status, posted_at desc);
create index if not exists captured_notifications_user_idx on public.captured_notifications (user_id);
create index if not exists captured_notifications_match_idx
  on public.captured_notifications (match_transaction_id) where match_transaction_id is not null;

alter table public.captured_notifications enable row level security;
drop policy if exists "workspace read" on public.captured_notifications;
create policy "workspace read" on public.captured_notifications
  for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));
drop policy if exists "workspace resolve" on public.captured_notifications;
create policy "workspace resolve" on public.captured_notifications
  for update to authenticated
  using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));
revoke all on public.captured_notifications from public, anon, authenticated;
grant select on public.captured_notifications to authenticated;
grant update (status, texto) on public.captured_notifications to authenticated;
grant all on public.captured_notifications to service_role;

drop trigger if exists set_updated_at on public.captured_notifications;
create trigger set_updated_at before update on public.captured_notifications
  for each row execute function extensions.moddatetime(updated_at);
drop trigger if exists a0_exige_assinatura on public.captured_notifications;
create trigger a0_exige_assinatura before insert or update or delete on public.captured_notifications
  for each row execute function private.tg_exige_assinatura();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                  and schemaname = 'public' and tablename = 'captured_notifications') then
    alter publication supabase_realtime add table public.captured_notifications;
  end if;
end $$;

-- a captura grava o seu custo em ai_events, sem contar no limite mensal (só `turn` conta)
alter table public.ai_events drop constraint if exists ai_events_kind_check;
alter table public.ai_events
  add constraint ai_events_kind_check check (kind in ('turn', 'transcription', 'import', 'capture'));
