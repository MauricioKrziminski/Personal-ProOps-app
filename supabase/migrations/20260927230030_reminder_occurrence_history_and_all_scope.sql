-- Every completed recurring occurrence now has one inactive child snapshot. The
-- snapshot's schedule and delivery audit stay fixed when the series is edited.
-- Earlier parent occurrences were never stored and cannot be reconstructed.
alter table public.reminders
  add column if not exists occurrence_outcome text
    check (occurrence_outcome in ('sent', 'given_up')),
  add column if not exists processed_at timestamptz,
  add column if not exists delivered_title text,
  add column if not exists delivered_channels text[];

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.reminders'::regclass
                    and conname = 'reminders_completed_occurrence_inactive') then
    alter table public.reminders
      add constraint reminders_completed_occurrence_inactive
      check (parent_reminder_id is null or occurrence_outcome is null
             or (not active and processed_at is not null));
  end if;
end $$;

-- Called by the scheduler after delivery. Locking, compare-and-swap, advancing,
-- and inserting the snapshot happen in the same transaction. A replay is inert.
drop function if exists public.finish_reminder_occurrence(
  uuid, timestamptz, text, timestamptz, text, text, text
);
drop function if exists public.finish_reminder_occurrence(
  uuid, timestamptz, text, timestamptz, text, text, text, text[]
);
create or replace function public.finish_reminder_occurrence(
  p_id uuid,
  p_expected_run_at timestamptz,
  p_expected_recurrence text,
  p_next_run_at timestamptz,
  p_recurrence text,
  p_outcome text,
  p_error text,
  p_delivered_channels text[] default null,
  p_delivered_title text default null
) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_reminder public.reminders%rowtype;
  was_skipped boolean;
  finished_at timestamptz := now();
begin
  if p_outcome is null or p_outcome not in ('sent', 'given_up') then
    raise exception 'Invalid reminder outcome';
  end if;

  select * into current_reminder from public.reminders
   where id = p_id for update;
  if not found or not current_reminder.active
     or current_reminder.next_run_at is distinct from p_expected_run_at
     or current_reminder.recurrence is distinct from p_expected_recurrence then
    return false;
  end if;

  was_skipped := current_reminder.skip_run_at = current_reminder.next_run_at;
  update public.reminders
     set send_attempts = 0,
         last_error = case when p_outcome = 'given_up' then p_error else null end,
         updated_at = finished_at,
         skip_run_at = case when was_skipped then null else skip_run_at end,
         next_run_at = coalesce(p_next_run_at, next_run_at),
         active = p_next_run_at is not null,
         recurrence = p_recurrence,
         occurrence_outcome = case when current_reminder.recurrence is null
                                   then p_outcome else occurrence_outcome end,
         processed_at = case when current_reminder.recurrence is null
                             then finished_at else processed_at end,
         delivered_title = case when current_reminder.recurrence is null and p_outcome = 'sent'
                                 then coalesce(p_delivered_title, current_reminder.title)
                                 else delivered_title end,
         delivered_channels = case when current_reminder.recurrence is null and p_outcome = 'sent'
                                   then p_delivered_channels else delivered_channels end
   where id = p_id;

  if current_reminder.recurrence is not null
     and current_reminder.parent_reminder_id is null and not coalesce(was_skipped, false) then
    insert into public.reminders (
      user_id, workspace_id, title, recurrence, next_run_at, timezone,
      channel, active, source, parent_reminder_id, original_run_at,
      occurrence_outcome, processed_at, delivered_title, delivered_channels, last_error
    ) values (
      current_reminder.user_id, current_reminder.workspace_id, current_reminder.title,
      null, current_reminder.next_run_at, current_reminder.timezone,
      current_reminder.channel, false, current_reminder.source,
      current_reminder.id, current_reminder.next_run_at,
      p_outcome, finished_at,
      case when p_outcome = 'sent' then coalesce(p_delivered_title, current_reminder.title)
           else null end,
      case when p_outcome = 'sent' then p_delivered_channels else null end,
      case when p_outcome = 'given_up' then p_error else null end
    ) on conflict (parent_reminder_id, original_run_at)
      where parent_reminder_id is not null do nothing;
  end if;
  return true;
end;
$$;

revoke all on function public.finish_reminder_occurrence(
  uuid, timestamptz, text, timestamptz, text, text, text, text[], text
) from public, anon, authenticated;
grant execute on function public.finish_reminder_occurrence(
  uuid, timestamptz, text, timestamptz, text, text, text, text[], text
) to service_role;

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
  if p_scope is null or p_scope not in ('one', 'future', 'all') then
    raise exception 'Escolha uma ocorrência, esta e as próximas ou todas';
  end if;
  if nullif(btrim(p_title), '') is null or p_next_run_at is null
     or p_channel not in ('push', 'whatsapp', 'both')
     or nullif(btrim(p_timezone), '') is null then
    raise exception 'Dados inválidos para o lembrete';
  end if;

  select * into original from public.reminders where id = p_id for update;
  if not found or original.parent_reminder_id is not null then
    raise exception 'Lembrete recorrente não encontrado';
  end if;
  if p_scope in ('future', 'all')
     and original.title = btrim(p_title)
     and original.recurrence is not distinct from p_recurrence
     and original.next_run_at = p_next_run_at
     and original.channel = p_channel
     and original.timezone = p_timezone
     and original.skip_run_at is null and original.active then
    return;
  end if;
  if original.recurrence is null then
    raise exception 'Lembrete recorrente não encontrado';
  end if;
  if original.next_run_at is distinct from p_expected_run_at then
    -- A repeated Save with the exact already-persisted result is idempotent.
    if p_scope in ('future', 'all')
       and original.title = btrim(p_title)
       and original.recurrence is not distinct from p_recurrence
       and original.next_run_at = p_next_run_at
       and original.channel = p_channel
       and original.timezone = p_timezone then
      return;
    end if;
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
      send_attempts = 0, last_error = null, updated_at = now()
    where public.reminders.title is distinct from excluded.title
       or public.reminders.next_run_at is distinct from excluded.next_run_at
       or public.reminders.timezone is distinct from excluded.timezone
       or public.reminders.channel is distinct from excluded.channel
       or public.reminders.active is distinct from true;

    update public.reminders set skip_run_at = original.next_run_at, updated_at = now()
    where id = original.id and skip_run_at is distinct from original.next_run_at;
  else
    -- A series edit supersedes pending exceptions. Completed children stay as
    -- history, including delivered one-off overrides.
    delete from public.reminders
    where parent_reminder_id = original.id
      and original_run_at >= original.next_run_at and active = true;

    if p_scope = 'all' then
      update public.reminders
         set title = btrim(p_title), channel = p_channel,
             timezone = p_timezone, updated_at = now()
       where parent_reminder_id = original.id
         and (title is distinct from btrim(p_title)
              or channel is distinct from p_channel
              or timezone is distinct from p_timezone);
    end if;

    update public.reminders set title = btrim(p_title), recurrence = p_recurrence,
      next_run_at = p_next_run_at, timezone = p_timezone, channel = p_channel,
      skip_run_at = null, active = true, send_attempts = 0, last_error = null,
      updated_at = now()
    where id = original.id
      and (title is distinct from btrim(p_title)
           or recurrence is distinct from p_recurrence
           or next_run_at is distinct from p_next_run_at
           or timezone is distinct from p_timezone
           or channel is distinct from p_channel
           or skip_run_at is not null or not active
           or send_attempts <> 0 or last_error is not null);
  end if;
end;
$$;

-- A pending one-off override belongs to the series. Its Save menu offers the
-- same scopes: "one" edits the child directly; "future/all" replace it and
-- edit the parent atomically from the parent's current occurrence.
create or replace function public.save_reminder_child_scoped(
  p_child_id uuid,
  p_parent_id uuid,
  p_expected_child_run_at timestamptz,
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
  parent public.reminders%rowtype;
  child public.reminders%rowtype;
begin
  if p_scope is null or p_scope not in ('one', 'future', 'all') then
    raise exception 'Invalid child reminder scope';
  end if;
  if nullif(btrim(p_title), '') is null or p_next_run_at is null
     or p_channel not in ('push', 'whatsapp', 'both')
     or nullif(btrim(p_timezone), '') is null then
    raise exception 'Dados inválidos para o lembrete';
  end if;
  select * into parent from public.reminders where id = p_parent_id for update;
  if not found then
    raise exception 'Série não encontrada';
  end if;
  select * into child from public.reminders where id = p_child_id for update;
  if not found then
    if p_scope <> 'one' and parent.title = btrim(p_title)
       and parent.recurrence is not distinct from coalesce(p_recurrence, parent.recurrence)
       and parent.next_run_at = p_next_run_at
       and parent.channel = p_channel and parent.timezone = p_timezone then
      return;
    end if;
    raise exception 'Esta ocorrência mudou. Abra de novo antes de salvar.';
  end if;
  if child.parent_reminder_id is distinct from parent.id or not child.active then
    raise exception 'Esta ocorrência mudou. Abra de novo antes de salvar.';
  end if;
  if p_scope = 'one' then
    if child.title = btrim(p_title) and child.next_run_at = p_next_run_at
       and child.channel = p_channel and child.timezone = p_timezone then
      return;
    end if;
    if child.next_run_at is distinct from p_expected_child_run_at then
      raise exception 'Esta ocorrência mudou. Abra de novo antes de salvar.';
    end if;
    update public.reminders
       set title = btrim(p_title), next_run_at = p_next_run_at,
           channel = p_channel, timezone = p_timezone,
           send_attempts = 0, last_error = null, updated_at = now()
     where id = child.id;
    return;
  end if;
  if child.next_run_at is distinct from p_expected_child_run_at then
    raise exception 'Esta ocorrência mudou. Abra de novo antes de salvar.';
  end if;

  delete from public.reminders where id = child.id;
  perform public.save_reminder_scoped(
    parent.id, parent.next_run_at, p_scope, p_title, coalesce(p_recurrence, parent.recurrence),
    p_next_run_at, p_channel, p_timezone
  );
end;
$$;

revoke all on function public.save_reminder_child_scoped(
  uuid, uuid, timestamptz, text, text, text, timestamptz, text, text
) from public;
grant execute on function public.save_reminder_child_scoped(
  uuid, uuid, timestamptz, text, text, text, timestamptz, text, text
) to authenticated;
