-- Alertas proativos uma vez por dia, 12:00 UTC = 9h em Sao Paulo.
-- Diario e nao por minuto porque o dedupe de alerts_sent e POR DIA: rodar mais
-- vezes so gastaria invocacao sem entregar nada novo.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-alerts') then
    perform cron.unschedule('send-alerts');
  end if;
end $$;

select cron.schedule(
  'send-alerts',
  '0 12 * * *',
  $CRON$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/send-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $CRON$
);
