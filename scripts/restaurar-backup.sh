#!/usr/bin/env bash
# Restaura um dump de scripts/backup-banco.sh num Postgres ALVO informado explicitamente.
#
#   ./scripts/restaurar-backup.sh <dump | gs://bucket/diario/arquivo.dump> <URL-do-Postgres-alvo>
#
# O alvo é argumento obrigatório (nunca lido de .env). Recusa o ref de PRODUÇÃO sem PROOPS_PROD_OK=1.
# Para provar um backup: suba um Postgres 17 com pgvector (`docker run -d -e POSTGRES_PASSWORD=x
# -p 55432:5432 pgvector/pgvector:pg17`) e use postgresql://postgres:x@localhost:55432/postgres.
# O alvo vazio recebe antes o mínimo que o dump pressupõe: papéis do Supabase e schema `extensions`.
set -euo pipefail
PROD_REF="kwriuifcwyvdrxtspjiz"
dump="${1:-}" alvo="${2:-}"
[[ -n "$dump" && -n "$alvo" ]] || { echo "uso: $0 <dump|gs://...> <url-do-postgres-alvo>" >&2; exit 2; }
if [[ "$alvo" == *"$PROD_REF"* && -z "${PROOPS_PROD_OK:-}" ]]; then
  echo "✗ o alvo é PRODUÇÃO ($PROD_REF). Restaurar ali sobrescreve dado real: só com PROOPS_PROD_OK=1." >&2
  exit 1
fi

pasta="$(mktemp -d)"; trap 'rm -rf "$pasta"' EXIT
if [[ "$dump" == gs://* ]]; then
  gcloud storage cp "$dump" "$pasta/backup.dump" >/dev/null
else
  cp "$dump" "$pasta/backup.dump"
fi

# psql/pg_restore locais se existirem; senão uma imagem postgres:17 (a versão do servidor).
if command -v pg_restore >/dev/null && command -v psql >/dev/null; then
  pg() { "$@"; }
else
  alvo="${alvo//@localhost/@host.docker.internal}"; alvo="${alvo//@127.0.0.1/@host.docker.internal}"
  pg() { docker run --rm -i -v "$pasta:/b" postgres:17 "$@"; }
  pasta_dump="/b/backup.dump"
fi
arq="${pasta_dump:-$pasta/backup.dump}"

pg psql "$alvo" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin; exception when duplicate_object then null; end $$;
create schema if not exists extensions;
create extension if not exists "uuid-ossp" schema extensions;
create extension if not exists pgcrypto schema extensions;
create extension if not exists unaccent schema extensions;
create extension if not exists moddatetime schema extensions;
create extension if not exists vector schema extensions;
SQL

# Erros esperados num Postgres comum (pg_cron, pg_net, vault, `public` já existir) não param a
# restauração; o que importa é conferir as contagens depois (docs/BACKUP.md).
erros="$(pg pg_restore --no-owner --no-privileges -d "$alvo" "$arq" 2>&1 | grep -c '^pg_restore: error' || true)"
echo "restaurado em ${alvo##*@} — erros de pg_restore: ${erros} (veja docs/BACKUP.md para os esperados)"
