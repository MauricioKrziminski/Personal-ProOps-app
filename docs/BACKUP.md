# Backup do banco

O Supabase Free não guarda backup; este é o nosso (`CUSTOS-E-PRECOS.md` §9 item 4).

## Como funciona

Todo dia 03:30 (Brasília) o Cloud Scheduler dispara o Cloud Run Job `backup-banco` (projeto
`personal-proops-agent`, imagem oficial `postgres:17`, a versão do servidor). Ele roda
`scripts/backup-banco.sh`: `pg_dump -Fc` dos schemas `public`, `private`, `auth`, `storage` e
`supabase_migrations` (o `langgraph`, conversas do agente, fica de fora), confere que o dump abre
(`pg_restore -l`) e grava no bucket `gs://personal-proops-agent-backups` (privado).

| pasta | o que | guarda |
|---|---|---|
| `diario/` | todo dia | 30 dias |
| `semanal/` | cópia do domingo | 90 dias |

Arquivo: `producao-AAAAMMDDTHHMMSSZ.dump` (UTC). Staging: bucket e job com sufixo `-staging`.
Lê o mesmo segredo `database-url` do agente. Custo: centavos por mês (job de ~15 s, ~2,5 MB por
dump em staging); só o 4º job do Scheduler passa dos 3 grátis (~US$ 0,10).

## Ligar (uma vez, na conta `gestao.proops@gmail.com`)

```bash
gcloud config set account gestao.proops@gmail.com
PROOPS_PROD_OK=1 ./scripts/setup-gcp.sh backup </dev/null   # idempotente
gcloud run jobs execute backup-banco --region southamerica-east1 --project personal-proops-agent --wait
gcloud storage ls -l gs://personal-proops-agent-backups/diario/
```

(`./scripts/setup-gcp.sh tudo` também inclui o backup.) Teste em staging: `./scripts/setup-gcp.sh backup-staging`.

## Saber se falhou

O script sai com código != 0 em qualquer erro, e o Cloud Run marca a execução como falha
(`gcloud run jobs executions list --job backup-banco --region southamerica-east1`). Aviso por
e-mail NÃO está criado. Para criar (alerta quando uma execução falha), com o canal de e-mail já
existente do `alertas`: política em Monitoring com a métrica
`run.googleapis.com/job/completed_execution_count`, filtro `resource.labels.job_name="backup-banco"`
e `metric.labels.result="failed"`, limite > 0. Alerta de "não rodou" (dump ausente há 26 h) exige
política de ausência de métrica `result="succeeded"`; também não criado.

## Restaurar

Sempre num Postgres de destino informado na linha de comando (nunca produção sem `PROOPS_PROD_OK=1`):

```bash
docker run -d --name pg-restore -e POSTGRES_PASSWORD=x -p 55432:5432 pgvector/pgvector:pg17
./scripts/restaurar-backup.sh gs://personal-proops-agent-backups/diario/<arquivo>.dump \
  postgresql://postgres:x@localhost:55432/postgres
```

O script cria os papéis `anon/authenticated/service_role` e o schema `extensions` (incluindo
`vector`) antes. É esperado 1 erro de `pg_restore` (`schema "public" already exists`).

Conferir: contagens de `public.transactions`, `public.accounts`, `public.profiles`,
`public.subscriptions`, `auth.users` e `supabase_migrations.schema_migrations` iguais às do banco
de origem. Prova em 09/10/2026 (staging, restaurado de `gs://` num Postgres 17 local): 379 / 11 / 6 / 6 / 6 / 301.

Limite: o dump não leva o `langgraph` nem `pg_cron`/`vault`/`pg_net`; um desastre em produção
exige criar um projeto Supabase novo, restaurar `public`/`private`/`auth` e reapontar o agente.
