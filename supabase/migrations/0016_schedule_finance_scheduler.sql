-- Agenda o `finance-scheduler` (materializa recorrentes 90 dias à frente, fecha
-- faturas vencidas, promove pendentes que já aconteceram).
--
-- De hora em hora, não por minuto: o horizonte é de 90 dias, então não há nada
-- que precise de precisão de minuto — e o job varre todas as séries ativas.
-- URL e token vêm do Vault, mesmo padrão da 0008 (nunca literal em migration).

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url') then
    raise exception 'vault: segredo "project_url" ausente';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'anon_key') then
    raise exception 'vault: segredo "anon_key" ausente';
  end if;
  if exists (select 1 from cron.job where jobname = 'finance-scheduler') then
    perform cron.unschedule('finance-scheduler');
  end if;
end $$;

select cron.schedule(
  'finance-scheduler',
  '7 * * * *',
  $CRON$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/finance-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb
  );
  $CRON$
);
