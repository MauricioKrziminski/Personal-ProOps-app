-- Tira o anon JWT hardcoded dos cron jobs (dívida da 0003) e passa a lê-lo do
-- Supabase Vault em tempo de execução. A 0003 deixou o token e a project ref
-- literais no repositório — além do vazamento, trocar a chave exigia migration nova.
--
-- PRÉ-REQUISITO (rodar UMA vez, fora do repo, no SQL editor do projeto — contém segredo):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<anon key>',                'anon_key');
-- Para trocar depois: select vault.update_secret(id, '<novo valor>');
--
-- ⚠️ O anon key que estava na 0003 continua no histórico do git — rotacionar a
-- chave no dashboard e atualizar EXPO_PUBLIC_SUPABASE_ANON_KEY no app.

create extension if not exists supabase_vault with schema vault;

-- falha cedo e alto: sem os segredos, os crons virariam no-op silencioso
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url') then
    raise exception 'vault: segredo "project_url" ausente — crie antes de aplicar esta migration';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'anon_key') then
    raise exception 'vault: segredo "anon_key" ausente — crie antes de aplicar esta migration';
  end if;
end $$;

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
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/process-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
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
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb
  );
  $CRON$
);
