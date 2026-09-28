-- Deleting a pending one-off edit restores its original occurrence on the series.
-- Without this, skip_run_at would survive with no replacement to deliver.
create or replace function public.restore_deleted_reminder_occurrence()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.parent_reminder_id is not null then
    update public.reminders
       set skip_run_at = null, updated_at = now()
     where id = old.parent_reminder_id
       and next_run_at = old.original_run_at
       and skip_run_at = old.original_run_at;
  end if;
  return old;
end;
$$;

create trigger restore_deleted_reminder_occurrence
after delete on public.reminders
for each row execute function public.restore_deleted_reminder_occurrence();
