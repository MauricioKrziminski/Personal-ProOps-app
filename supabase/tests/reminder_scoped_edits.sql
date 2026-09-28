-- Run against LOCAL Supabase Postgres after the migration; transaction rolls back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
values ('00000000-0000-0000-0000-00000000e001',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'scoped-reminder@test.local', '{}', '{}');

do $$
declare
  ws uuid;
begin
  select id into ws from public.workspaces
   where owner_id = '00000000-0000-0000-0000-00000000e001';
  insert into public.reminders (id, user_id, workspace_id, title, recurrence, next_run_at, channel, source)
  values ('00000000-0000-0000-0000-00000000e002',
          '00000000-0000-0000-0000-00000000e001', ws,
          'Remédio', 'FREQ=DAILY', '2026-10-01T12:00:00Z', 'push', 'app');
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e001', true);
set local role authenticated;

select public.save_reminder_scoped(
  '00000000-0000-0000-0000-00000000e002', '2026-10-01T12:00:00Z',
  'one', 'Remédio especial', 'FREQ=DAILY', '2026-10-01T15:00:00Z', 'whatsapp', 'UTC');

do $$
begin
  assert (select title from public.reminders where id = '00000000-0000-0000-0000-00000000e002') = 'Remédio';
  assert (select skip_run_at from public.reminders where id = '00000000-0000-0000-0000-00000000e002') = '2026-10-01T12:00:00Z'::timestamptz;
  assert (select count(*) from public.reminders where parent_reminder_id = '00000000-0000-0000-0000-00000000e002') = 1;
  assert (select next_run_at from public.reminders where parent_reminder_id = '00000000-0000-0000-0000-00000000e002') = '2026-10-01T15:00:00Z'::timestamptz;
end $$;

-- Repeated Save updates the same replacement rather than producing a duplicate.
select public.save_reminder_scoped(
  '00000000-0000-0000-0000-00000000e002', '2026-10-01T12:00:00Z',
  'one', 'Remédio especial', 'FREQ=DAILY', '2026-10-01T16:00:00Z', 'push', 'UTC');

do $$
begin
  assert (select count(*) from public.reminders where parent_reminder_id = '00000000-0000-0000-0000-00000000e002') = 1;
  assert (select next_run_at from public.reminders where parent_reminder_id = '00000000-0000-0000-0000-00000000e002') = '2026-10-01T16:00:00Z'::timestamptz;
end $$;

-- A future edit cancels the pending replacement and changes the rule from this boundary.
select public.save_reminder_scoped(
  '00000000-0000-0000-0000-00000000e002', '2026-10-01T12:00:00Z',
  'future', 'Remédio novo', 'FREQ=WEEKLY', '2026-10-01T17:00:00Z', 'push', 'UTC');

do $$
begin
  assert (select count(*) from public.reminders where parent_reminder_id = '00000000-0000-0000-0000-00000000e002') = 0;
  assert (select title from public.reminders where id = '00000000-0000-0000-0000-00000000e002') = 'Remédio novo';
  assert (select recurrence from public.reminders where id = '00000000-0000-0000-0000-00000000e002') = 'FREQ=WEEKLY';
  assert (select skip_run_at from public.reminders where id = '00000000-0000-0000-0000-00000000e002') is null;
end $$;

-- Deleting the edited occurrence restores its original place in the parent series.
select public.save_reminder_scoped(
  '00000000-0000-0000-0000-00000000e002', '2026-10-01T17:00:00Z',
  'one', 'Remédio temporário', 'FREQ=WEEKLY', '2026-10-01T18:00:00Z', 'push', 'UTC');
delete from public.reminders
 where parent_reminder_id = '00000000-0000-0000-0000-00000000e002';
do $$
begin
  assert (select skip_run_at from public.reminders where id = '00000000-0000-0000-0000-00000000e002') is null,
    'deleting a replacement must restore the original scheduled occurrence';
end $$;

rollback;
