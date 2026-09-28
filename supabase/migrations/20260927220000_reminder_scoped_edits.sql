-- A recurring reminder is one RRULE row. A one-occurrence edit is a separate
-- one-time reminder, with the original scheduled instant recorded on both rows.
-- The cron skips that instant on the parent and delivers the child normally.
alter table public.reminders
  add column if not exists parent_reminder_id uuid references public.reminders(id) on delete cascade,
  add column if not exists original_run_at timestamptz,
  add column if not exists skip_run_at timestamptz;

create unique index if not exists reminders_one_override_per_occurrence
  on public.reminders(parent_reminder_id, original_run_at)
  where parent_reminder_id is not null;

alter table public.reminders
  add constraint reminders_override_shape check (
    (parent_reminder_id is null and original_run_at is null)
    or (parent_reminder_id is not null and original_run_at is not null and recurrence is null and note_id is null)
  );

create or replace function public.save_reminder_scoped(
  p_id uuid,
  p_expected_run_at timestamptz,
  p_scope text,
  p_title text,
  p_recurrence text,
  p_next_run_at timestamptz,
  p_channel text,
  p_timezone text
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  original public.reminders%rowtype;
begin
  if p_scope not in ('one', 'future') then
    raise exception 'Escolha só esta ocorrência ou esta e as próximas';
  end if;
  if nullif(btrim(p_title), '') is null or p_next_run_at is null
     or p_channel not in ('push', 'whatsapp', 'both')
     or nullif(btrim(p_timezone), '') is null then
    raise exception 'Dados inválidos para o lembrete';
  end if;

  select * into original from public.reminders where id = p_id for update;
  if not found or original.recurrence is null or original.parent_reminder_id is not null then
    raise exception 'Lembrete recorrente não encontrado';
  end if;
  if original.next_run_at is distinct from p_expected_run_at then
    raise exception 'Este lembrete mudou. Abra de novo antes de salvar.';
  end if;

  if p_scope = 'one' then
    insert into public.reminders (
      user_id, workspace_id, title, recurrence, next_run_at, timezone,
      channel, active, source, parent_reminder_id, original_run_at
    ) values (
      original.user_id, original.workspace_id, btrim(p_title), null, p_next_run_at,
      p_timezone, p_channel, true, 'app', original.id, original.next_run_at
    )
    on conflict (parent_reminder_id, original_run_at)
      where parent_reminder_id is not null
    do update set title = excluded.title, next_run_at = excluded.next_run_at,
      timezone = excluded.timezone, channel = excluded.channel, active = true,
      send_attempts = 0, last_error = null, updated_at = now();

    update public.reminders set skip_run_at = original.next_run_at, updated_at = now()
    where id = original.id;
  else
    -- A future change supersedes pending exceptions at and after the boundary.
    -- Delivered overrides (active=false) remain as past history.
    delete from public.reminders
    where parent_reminder_id = original.id
      and original_run_at >= original.next_run_at and active = true;

    update public.reminders set title = btrim(p_title), recurrence = p_recurrence,
      next_run_at = p_next_run_at, timezone = p_timezone, channel = p_channel,
      skip_run_at = null, active = true, send_attempts = 0, last_error = null,
      updated_at = now()
    where id = original.id;
  end if;
end;
$$;

revoke all on function public.save_reminder_scoped(
  uuid, timestamptz, text, text, text, timestamptz, text, text
) from public;
grant execute on function public.save_reminder_scoped(
  uuid, timestamptz, text, text, text, timestamptz, text, text
) to authenticated;
