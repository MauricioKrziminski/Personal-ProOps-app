#!/usr/bin/env bash
# O guard de produção, exercitado. `./scripts/supabase-target.test.sh`
#
# Os refs são LIDOS do próprio guard, nunca escritos aqui: um teste que contém o ref de produção
# junto de `--db-url` é bloqueado pelo próprio hook quando o agente tenta rodá-lo.
set -euo pipefail
cd "$(dirname "$0")/.."

P=$(sed -nE 's/^PROD_REF=["'"'"']?([a-z0-9]+).*/\1/p' scripts/supabase-target.sh | head -1)
S=$(sed -nE 's/^STAGING_REF=["'"'"']?([a-z0-9]+).*/\1/p' scripts/supabase-target.sh | head -1)
U="--db-url"
falhas=0

decide() {
  # Deixar passar é NÃO imprimir nada (exit 0 mudo), então a saída vazia é uma resposta, não um erro.
  local out
  out="$(printf '%s' "$1" | jq -Rc '{tool_input:{command:.}}' \
         | ./scripts/supabase-target.sh | jq -r '.hookSpecificOutput.permissionDecision // empty')"
  printf '%s' "${out:-passa}"
}
espera() { # <esperado> <descrição> <comando>
  local got; got="$(decide "$3")"
  if [ "$got" = "$1" ]; then printf '  ok   %s\n' "$2"
  else printf '  FALHOU %s: esperava %s, veio %s\n' "$2" "$1" "$got"; falhas=$((falhas+1)); fi
}

# `--db-url` ignora o link do CLI. Sem tratá-lo, `db push --db-url <prod>` linkado no staging
# passava batido — o buraco encontrado em 09/09/2026.
espera deny  "--db-url apontando para produção"        "npx supabase db push $U postgresql://postgres.$P:x@h:5432/postgres"
espera ask   "--db-url montada em tempo de execução"   "npx supabase db push $U \"\$(cat agent/.env.production)\""
espera passa "--db-url apontando para staging"         "npx supabase db push $U postgresql://postgres.$S:x@h:5432/postgres"
espera deny  "--project-ref de produção"               "npx supabase db push --project-ref $P"
espera passa "db push normal (linkado no staging)"     "npx supabase db push"
espera passa "gen types é leitura, não escrita"        "npx supabase gen types typescript --project-ref $P"
espera deny  "migration up em produção"                "npx supabase migration up --project-ref $P"

[ "$falhas" -eq 0 ] || { echo "$falhas caso(s) falharam"; exit 1; }
echo "guard de produção: todos os casos passaram"
