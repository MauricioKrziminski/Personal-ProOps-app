#!/usr/bin/env bash
# Backup do Postgres do Supabase. Roda DENTRO do Cloud Run Job (imagem postgres:17, comando
# `bash -c "$(cat este arquivo)"`) e também à mão para provar o backup:
#   docker run --rm -e DATABASE_URL -e BACKUP_DIR=/out -v "$PWD/out:/out" postgres:17 \
#     bash -c "$(cat scripts/backup-banco.sh)"
# Entradas: DATABASE_URL (obrigatória), BACKUP_DIR (pasta do bucket montado), NOME (prefixo do arquivo).
# Sai != 0 em QUALQUER falha: é o que faz o Cloud Run Job marcar a execução como falha.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL ausente}" "${BACKUP_DIR:?BACKUP_DIR ausente}"
NOME="${NOME:-proops}"
agora="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="/tmp/${NOME}-${agora}.dump"

# Schemas: public/private (o produto), auth (identidade), storage (metadados),
# supabase_migrations (qual migration está aplicada). `langgraph` (conversas do agente) fica de fora.
pg_dump "$DATABASE_URL" -Fc --no-owner --no-privileges \
  -n public -n private -n auth -n storage -n supabase_migrations -f "$tmp"

# Dump legível? (lê o índice inteiro) e não vazio — antes de gastar o upload.
n="$(pg_restore -l "$tmp" | grep -c .)"
tam="$(stat -c %s "$tmp")"
[[ "$tam" -gt 10000 && "$n" -gt 50 ]] || { echo "dump suspeito: ${tam} bytes, ${n} entradas" >&2; exit 1; }

mkdir -p "$BACKUP_DIR/diario"
cp "$tmp" "$BACKUP_DIR/diario/${NOME}-${agora}.dump"
# Domingo: cópia semanal (o bucket guarda diario/ 30 dias e semanal/ 90 dias).
if [[ "$(date -u +%u)" == 7 ]]; then
  mkdir -p "$BACKUP_DIR/semanal"
  cp "$tmp" "$BACKUP_DIR/semanal/${NOME}-${agora}.dump"
fi
[[ "$(stat -c %s "$BACKUP_DIR/diario/${NOME}-${agora}.dump")" == "$tam" ]] || { echo "upload truncado" >&2; exit 1; }
echo "ok ${NOME}-${agora}.dump ${tam} bytes ${n} entradas"
