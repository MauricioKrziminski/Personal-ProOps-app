-- A tela de recorrentes (src/app/finance/recurring.tsx) lê `recurring_transactions`,
-- e o cron do send-reminders muda essa tabela por fora (materializa, reagenda, marca
-- last_error). Sem estar na publicação, o app só veria a mudança no próximo refetch.
-- Regra do projeto: tabela que o app exibe entra em supabase_realtime.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'recurring_transactions'
  ) then
    alter publication supabase_realtime add table public.recurring_transactions;
  end if;
end $$;
