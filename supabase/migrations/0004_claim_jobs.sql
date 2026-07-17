-- Codifica a RPC claim_jobs que o process-jobs chama (até aqui existia só no banco,
-- criada manualmente — nunca versionada). Idempotente: seguro rodar sobre banco que já a tenha.
--
-- Reivindicação atômica de jobs: um job vai para um único processador (FOR UPDATE SKIP LOCKED),
-- incrementa attempts e marca processing. Também recupera jobs órfãos: processing há mais de
-- 5 minutos = a function que os reivindicou morreu sem marcar done/failed.

alter table public.jobs add column if not exists claimed_at timestamptz;

create or replace function public.claim_jobs(batch_size int default 10)
returns setof public.jobs
language sql
security definer
set search_path = public
as $$
  update public.jobs j
  set status = 'processing',
      attempts = j.attempts + 1,
      claimed_at = now()
  from (
    select id
    from public.jobs
    where (
        status = 'pending'
        or (status = 'processing' and claimed_at < now() - interval '5 minutes')
      )
      and attempts < 3
    order by created_at
    limit batch_size
    for update skip locked
  ) picked
  where j.id = picked.id
  returning j.*;
$$;

revoke execute on function public.claim_jobs(int) from public, anon, authenticated;
