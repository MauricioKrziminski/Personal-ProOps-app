-- Run after reminder occurrence history migration on a LOCAL database. Rollback is mandatory.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
values ('00000000-0000-0000-0000-00000000e101',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'reminder-history@test.local', '{}', '{}');

do $$
declare ws uuid;
begin
  select id into ws from public.workspaces
   where owner_id = '00000000-0000-0000-0000-00000000e101';
  insert into public.reminders
    (id, user_id, workspace_id, title, recurrence, next_run_at, channel, timezone, source)
  values
    ('00000000-0000-0000-0000-00000000e102', '00000000-0000-0000-0000-00000000e101',
     ws, 'Old title', 'FREQ=DAILY', '2026-10-02T12:00:00Z', 'push', 'UTC', 'app'),
    ('00000000-0000-0000-0000-00000000e103', '00000000-0000-0000-0000-00000000e101',
     ws, 'Blocked delivery', 'FREQ=DAILY', '2026-10-02T12:00:00Z', 'whatsapp', 'UTC', 'app');
end $$;

select public.finish_reminder_occurrence(
  '00000000-0000-0000-0000-00000000e103', '2026-10-02T12:00:00Z',
  'FREQ=DAILY', '2026-10-03T12:00:00Z', 'FREQ=DAILY', 'given_up', 'provider unavailable');
do $$
begin
  assert (select occurrence_outcome from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e103') = 'given_up';
  assert (select last_error from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e103') = 'provider unavailable';
  assert (select delivered_channels from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e103') is null;
end $$;

-- The scheduler advances the parent and persists a truthful occurrence snapshot.
select public.finish_reminder_occurrence(
  '00000000-0000-0000-0000-00000000e102', '2026-10-02T12:00:00Z',
  'FREQ=DAILY', '2026-10-03T12:00:00Z', 'FREQ=DAILY', 'sent', null, array['push'], 'Old title');
do $$
begin
  assert (select count(*) from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102') = 1;
  assert (select original_run_at from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102')
    = '2026-10-02T12:00:00Z'::timestamptz;
  assert (select occurrence_outcome from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102') = 'sent';
  assert (select delivered_title from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102') = 'Old title';
end $$;

-- A completed snapshot cannot accidentally be resumed as a new delivery.
do $$
begin
  begin
    update public.reminders set active = true
     where parent_reminder_id = '00000000-0000-0000-0000-00000000e102';
    raise exception 'completed occurrence became active';
  exception when check_violation then null;
  end;
  assert (select active from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102') = false;
end $$;

-- A replay must not create another snapshot.
select public.finish_reminder_occurrence(
  '00000000-0000-0000-0000-00000000e102', '2026-10-02T12:00:00Z',
  'FREQ=DAILY', '2026-10-03T12:00:00Z', 'FREQ=DAILY', 'sent', null);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e101', true);
set local role authenticated;

-- An exception for the next occurrence is superseded by the full series edit.
select public.save_reminder_scoped(
  '00000000-0000-0000-0000-00000000e102', '2026-10-03T12:00:00Z',
  'one', 'One-off', 'FREQ=DAILY', '2026-10-03T15:00:00Z', 'whatsapp', 'UTC');
select public.save_reminder_scoped(
  '00000000-0000-0000-0000-00000000e102', '2026-10-03T12:00:00Z',
  'all', 'New title', 'FREQ=WEEKLY', '2026-10-04T12:00:00Z', 'both', 'America/Sao_Paulo');

do $$
begin
  assert (select title from public.reminders
          where id = '00000000-0000-0000-0000-00000000e102') = 'New title';
  assert (select recurrence from public.reminders
          where id = '00000000-0000-0000-0000-00000000e102') = 'FREQ=WEEKLY';
  assert (select next_run_at from public.reminders
          where id = '00000000-0000-0000-0000-00000000e102')
    = '2026-10-04T12:00:00Z'::timestamptz;
  assert (select count(*) from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102') = 1,
    'pending exception removed, completed snapshot retained';
  assert (select title from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102') = 'New title';
  assert (select channel from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102') = 'both';
  assert (select next_run_at from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102')
    = '2026-10-02T12:00:00Z'::timestamptz,
    'actual past schedule must remain truthful';
  assert (select delivered_title from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102') = 'Old title',
    'delivery audit must remain truthful';
  assert (select delivered_channels from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102') = array['push'];
end $$;

-- Repeated Save with the original expected instant is a no-op.
select public.save_reminder_scoped(
  '00000000-0000-0000-0000-00000000e102', '2026-10-03T12:00:00Z',
  'all', 'New title', 'FREQ=WEEKLY', '2026-10-04T12:00:00Z', 'both', 'America/Sao_Paulo');
do $$
begin
  assert (select count(*) from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102') = 1;
end $$;

-- Editing a pending override can propagate to the parent without leaving the
-- overridden child active or creating a second occurrence.
select public.save_reminder_scoped(
  '00000000-0000-0000-0000-00000000e102', '2026-10-04T12:00:00Z',
  'one', 'One-off 2', 'FREQ=WEEKLY', '2026-10-04T16:00:00Z', 'push', 'UTC');
select public.save_reminder_child_scoped(
  (select id from public.reminders where parent_reminder_id = '00000000-0000-0000-0000-00000000e102'
     and active and original_run_at = '2026-10-04T12:00:00Z'),
  '00000000-0000-0000-0000-00000000e102', '2026-10-04T16:00:00Z',
  'future', 'From override onward', 'FREQ=MONTHLY', '2026-10-05T12:00:00Z', 'both', 'UTC');
do $$
begin
  assert (select count(*) from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102') = 1;
  assert (select title from public.reminders
          where id = '00000000-0000-0000-0000-00000000e102') = 'From override onward';
  assert (select title from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102') = 'New title',
    'future scope preserves completed history';
end $$;

select public.save_reminder_scoped(
  '00000000-0000-0000-0000-00000000e102', '2026-10-05T12:00:00Z',
  'one', 'Third override', 'FREQ=MONTHLY', '2026-10-05T16:00:00Z', 'push', 'UTC');
select public.save_reminder_child_scoped(
  (select id from public.reminders where parent_reminder_id = '00000000-0000-0000-0000-00000000e102'
     and active and original_run_at = '2026-10-05T12:00:00Z'),
  '00000000-0000-0000-0000-00000000e102', '2026-10-05T16:00:00Z',
  'one', 'Third override edited', null, '2026-10-05T17:00:00Z', 'whatsapp', 'UTC');
select public.save_reminder_child_scoped(
  (select id from public.reminders where parent_reminder_id = '00000000-0000-0000-0000-00000000e102'
     and active and original_run_at = '2026-10-05T12:00:00Z'),
  '00000000-0000-0000-0000-00000000e102', '2026-10-05T16:00:00Z',
  'one', 'Third override edited', null, '2026-10-05T17:00:00Z', 'whatsapp', 'UTC');
do $$
begin
  assert (select count(*) from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102' and active) = 1;
  assert (select title from public.reminders
          where parent_reminder_id = '00000000-0000-0000-0000-00000000e102' and active)
    = 'Third override edited';
end $$;

rollback;
