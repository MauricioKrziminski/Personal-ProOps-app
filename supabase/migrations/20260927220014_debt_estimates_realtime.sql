-- Historical declared estimates must refresh on another device after a scoped edit.
-- The client subscribes to this table and the original debt/transaction publications.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'debt_declared_estimates'
     ) then
    alter publication supabase_realtime add table public.debt_declared_estimates;
  end if;
end $$;
