#!/usr/bin/env bash
# `criar_backup` monta bucket privado com retenção, job do postgres:17 e agendamento diário, e é
# idempotente. `./scripts/setup-gcp-backup.test.sh` — `gcloud` dublado, nada toca a nuvem.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
chamadas="$tmp/chamadas.txt"
sed -n '/^criar_backup() {/,/^}/p' scripts/setup-gcp.sh > "$tmp/fn.sh"
[[ -s "$tmp/fn.sh" ]] || { echo "✗ não achei criar_backup em setup-gcp.sh"; exit 1; }

roda() { # $1 = existe|nao_existe  $2 = sufixo de segredo
  : > "$chamadas"
  cat > "$tmp/gcloud" <<FIM
#!/usr/bin/env bash
echo "\$*" >> "$chamadas"
for a in "\$@"; do [[ -f "\$a" ]] && cat "\$a" >> "$chamadas"; done
case "\$1 \$2 \$3" in
  "secrets describe "*) exit 0 ;;
  "storage buckets describe"|"scheduler jobs describe") [[ "$1" == existe ]] || exit 1 ;;
esac
exit 0
FIM
  chmod +x "$tmp/gcloud"
  echo 'echo "a,b"' > "$tmp/b.sh"
  PATH="$tmp:$PATH" BACKUP_SCRIPT="$tmp/b.sh" PROJECT_ID=p REGION=r SA_EMAIL=sa@p SECRET_SUFFIX="$2" \
    bash -c "log(){ :; }; ok(){ :; }; err(){ echo \"\$*\" >&2; }; source '$tmp/fn.sh'; criar_backup" >/dev/null
}
falhas=0
verifica() { # rótulo esperado(sim|nao) padrão
  local achou=nao; grep -q -e "$3" "$chamadas" && achou=sim
  if [[ "$achou" == "$2" ]]; then printf '  ✓ %s\n' "$1"; else printf '  ✗ %s — esperava %s\n' "$1" "$2"; falhas=$((falhas+1)); fi
}

echo "produção, tudo novo"
roda nao_existe ""
verifica "cria o bucket privado, acesso uniforme" sim "buckets create gs://p-backups .*--uniform-bucket-level-access --public-access-prevention"
verifica "diario/ apaga em 30 dias"      sim '"age": 30, "matchesPrefix": \["diario/"\]'
verifica "semanal/ apaga em 90 dias"     sim '"age": 90, "matchesPrefix": \["semanal/"\]'
verifica "job com postgres:17"           sim "jobs deploy backup-banco .*--image docker.io/library/postgres:17"
verifica "banco do segredo de produção"  sim "DATABASE_URL=database-url:latest"
verifica "monta o bucket"                sim "bucket=p-backups"
verifica "script entra como argumento"   sim '\^@\^-c@echo "a,b"'
verifica "cria o agendamento diário"     sim "scheduler jobs create http backup-banco .*--schedule 30 3 \* \* \*"
verifica "dispara o :run do job"         sim "jobs/backup-banco:run"

echo "bucket e agendamento que já existem — atualiza, não recria"
roda existe ""
verifica "não recria o bucket"           nao "buckets create"
verifica "atualiza o agendamento"        sim "scheduler jobs update http"

echo "staging — tudo com sufixo, nunca o de produção"
roda nao_existe "-staging"
verifica "bucket de staging"             sim "gs://p-backups-staging"
verifica "segredo de staging"            sim "DATABASE_URL=database-url-staging:latest"
verifica "job de staging"                sim "jobs deploy backup-banco-staging"

[[ $falhas -eq 0 ]] && echo ok || echo "$falhas falha(s)"
exit "$falhas"
