-- Captura de lançamentos, segunda parte (spec 2026-10-12-captura-de-lancamentos-design.md, §6 e §8).
--
-- 1. Cada pessoa vê e resolve só as PRÓPRIAS capturas (decisão do dono do produto, 13/10/2026): o texto
--    é a notificação do banco de quem a recebeu, e num espaço compartilhado o outro membro não a lê. A
--    condição de membro continua: quem sai do espaço deixa de ver na hora (a retenção diária apaga).
-- 2. `processing` = reserva do agente ANTES de chamar o modelo. A mesma notificação chega de dois aparelhos
--    da pessoa com o mesmo `external_id`; sem a reserva, os dois pagavam o modelo. Só o agente grava esse
--    estado, e o app não o vê nem o escreve.
-- 3. Toda leitura do app filtra pela pessoa: o índice passa a começar por `user_id` (ele também serve ao
--    `on delete cascade` de `profiles`). O de `(workspace_id, status, posted_at)` não tem mais leitor.

alter table public.captured_notifications drop constraint if exists captured_notifications_status_check;
alter table public.captured_notifications add constraint captured_notifications_status_check
  check (status in ('processing', 'pending', 'duplicate', 'confirmed', 'discarded', 'ignored'));
alter table public.captured_notifications drop constraint if exists captured_notifications_check;
alter table public.captured_notifications add constraint captured_notifications_check
  check (status in ('processing', 'ignored', 'discarded', 'confirmed') or draft is not null);

drop policy if exists "workspace read" on public.captured_notifications;
drop policy if exists "own read" on public.captured_notifications;
create policy "own read" on public.captured_notifications
  for select to authenticated
  using (user_id = (select auth.uid())
         and status <> 'processing'
         and workspace_id in (select private.my_workspace_ids()));

drop policy if exists "workspace resolve" on public.captured_notifications;
drop policy if exists "own resolve" on public.captured_notifications;
create policy "own resolve" on public.captured_notifications
  for update to authenticated
  using (user_id = (select auth.uid())
         and status in ('pending', 'duplicate', 'confirmed', 'discarded')
         and workspace_id in (select private.my_workspace_ids()))
  with check (user_id = (select auth.uid())
              and status in ('pending', 'duplicate', 'confirmed', 'discarded')
              and workspace_id in (select private.my_workspace_ids()));

drop index if exists public.captured_notifications_ws_status_idx;
drop index if exists public.captured_notifications_user_idx;
create index if not exists captured_notifications_user_status_idx
  on public.captured_notifications (user_id, status, posted_at desc);
