#!/usr/bin/env bash
#
# Atalho de endereço do painel: admin.proops.com.br e admin-staging.proops.com.br REDIRECIONAM para o
# painel no run.app (docs/PAINEL-ADMIN.md). Firebase Hosting, só redirecionamento (302): nada fica entre
# o navegador e o painel, o login do Google (IAP) acontece no run.app como antes, e não há custo fixo.
#
#   CLOUDSDK_CORE_ACCOUNT=gestao.proops@gmail.com ./scripts/atalho-painel.sh          # cria/atualiza
#   CLOUDSDK_CORE_ACCOUNT=gestao.proops@gmail.com ./scripts/atalho-painel.sh status   # DNS pedido e certificado
#
# Idempotente. Usa a API do Firebase Hosting com o token do gcloud (não precisa de `firebase login`).
# 302 e não 301: o navegador guarda 301 para sempre, e o destino pode mudar (um dia, domínio próprio).
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-personal-proops-agent}"
API="https://firebasehosting.googleapis.com/v1beta1"
# site do Firebase | domínio | destino
ATALHOS=(
  "proops-painel|admin.proops.com.br|https://painel-wwm7xruoyq-rj.a.run.app/admin"
  "proops-painel-staging|admin-staging.proops.com.br|https://painel-staging-wwm7xruoyq-rj.a.run.app/admin"
)

log() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
err() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; }

TOKEN="$(gcloud auth print-access-token)"
chamar() {  # método url [corpo] — sai com erro em HTTP >= 400, menos 409 (já existe)
  local metodo="$1" url="$2" corpo="${3:-}" saida codigo
  saida="$(mktemp)"
  codigo="$(curl -sS -o "$saida" -w '%{http_code}' -X "$metodo" "$url" \
    -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT_ID" \
    -H 'Content-Type: application/json' ${corpo:+--data "$corpo"})"
  if [[ "$codigo" -ge 400 && "$codigo" != 409 ]]; then
    err "$metodo $url → $codigo"; cat "$saida" >&2; rm -f "$saida"; exit 1
  fi
  cat "$saida"; rm -f "$saida"
}
existe() {  # url → 0 se 200
  [[ "$(curl -sS -o /dev/null -w '%{http_code}' "$1" -H "Authorization: Bearer $TOKEN" \
        -H "x-goog-user-project: $PROJECT_ID")" == 200 ]]
}
campo() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }

status() {
  for a in "${ATALHOS[@]}"; do
    IFS='|' read -r site dominio _ <<<"$a"
    log "$dominio"
    chamar GET "$API/projects/$PROJECT_ID/sites/$site/customDomains/$dominio" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print("  dono do domínio:", d.get("ownershipState"), "| hospedagem:", d.get("hostState"), "| certificado:", (d.get("cert") or {}).get("state"))
for grupo in ((d.get("requiredDnsUpdates") or {}).get("desired") or []):
    for r in grupo.get("records") or []:
        print("  criar no Registro.br:", r.get("type"), r.get("domainName"), "→", r.get("rdata"))
for grupo in ((d.get("requiredDnsUpdates") or {}).get("discovered") or []):
    for r in grupo.get("records") or []:
        if r.get("requiredAction") == "REMOVE":
            print("  apagar no Registro.br:", r.get("type"), r.get("domainName"), "→", r.get("rdata"))'
  done
}

if [[ "${1:-}" == status ]]; then status; exit 0; fi

log "APIs e Firebase no projeto $PROJECT_ID"
gcloud services enable firebase.googleapis.com firebasehosting.googleapis.com --project "$PROJECT_ID" >/dev/null
if ! existe "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID"; then
  operacao="$(chamar POST "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID:addFirebase" '{}' | campo "d['name']")"
  for _ in $(seq 1 30); do
    feito="$(chamar GET "https://firebase.googleapis.com/v1beta1/$operacao" | campo "d.get('done', False)")"
    [[ "$feito" == True ]] && break; sleep 2
  done
fi
ok "Firebase ativo no projeto"

for a in "${ATALHOS[@]}"; do
  IFS='|' read -r site dominio destino <<<"$a"
  log "$dominio → $destino"
  chamar POST "$API/projects/$PROJECT_ID/sites?siteId=$site" '{}' >/dev/null
  ok "site $site"
  # Versão só com configuração (nenhum arquivo): todo caminho redireciona para o painel.
  config="$(printf '{"config":{"redirects":[{"glob":"**","location":"%s","statusCode":302}]}}' "$destino")"
  versao="$(chamar POST "$API/sites/$site/versions" "$config" | campo "d['name']")"
  chamar PATCH "$API/$versao?update_mask=status" '{"status":"FINALIZED"}' >/dev/null
  chamar POST "$API/sites/$site/releases?versionName=$versao" '{}' >/dev/null
  ok "redirecionamento publicado (https://$site.web.app)"
  chamar POST "$API/projects/$PROJECT_ID/sites/$site/customDomains?customDomainId=$dominio" '{}' >/dev/null
  ok "domínio $dominio pedido"
done

status
printf '\n  Crie os registros acima no Registro.br e rode "%s status" até o certificado ficar ativo.\n\n' "$0"
