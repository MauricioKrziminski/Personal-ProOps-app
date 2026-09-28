-- `restore_deleted_reminder_occurrence` (20260927220001) nasceu em `public` sem o revoke, e o
-- PUBLIC do padrão global a deixou executável por `anon` (`supabase/tests/anon_sem_execute.sql`).
-- É função de gatilho: o gatilho dispara sem EXECUTE de ninguém.
revoke execute on function public.restore_deleted_reminder_occurrence() from public, anon, authenticated;
