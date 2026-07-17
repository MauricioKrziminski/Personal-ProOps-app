-- Automação: pg_cron dispara as functions via pg_net.
-- process-jobs: consome a fila (classifica mensagens do WhatsApp) a cada minuto.
-- send-reminders: dispara lembretes vencidos a cada minuto.
-- Auth: usa a anon key (pública) só para passar o gate verify_jwt;
-- as functions usam service_role internamente.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- idempotência: remove agendamentos anteriores com o mesmo nome
do $$
begin
  if exists (select 1 from cron.job where jobname = 'process-jobs') then
    perform cron.unschedule('process-jobs');
  end if;
  if exists (select 1 from cron.job where jobname = 'send-reminders') then
    perform cron.unschedule('send-reminders');
  end if;
end $$;

select cron.schedule(
  'process-jobs',
  '* * * * *',
  $CRON$
  select net.http_post(
    url := 'https://kwriuifcwyvdrxtspjiz.supabase.co/functions/v1/process-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3cml1aWZjd3l2ZHJ4dHNwaml6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NzAzNTYsImV4cCI6MjA5OTU0NjM1Nn0.Dt3n1K05yz3CMy2soOwDaXxiiVtrylF-Zw11GlbXcEQ'
    ),
    body := '{}'::jsonb
  );
  $CRON$
);

select cron.schedule(
  'send-reminders',
  '* * * * *',
  $CRON$
  select net.http_post(
    url := 'https://kwriuifcwyvdrxtspjiz.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3cml1aWZjd3l2ZHJ4dHNwaml6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NzAzNTYsImV4cCI6MjA5OTU0NjM1Nn0.Dt3n1K05yz3CMy2soOwDaXxiiVtrylF-Zw11GlbXcEQ'
    ),
    body := '{}'::jsonb
  );
  $CRON$
);
