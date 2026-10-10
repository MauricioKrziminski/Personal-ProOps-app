#!/usr/bin/env bash
#
# E2E do painel /admin — 100% LOCAL (Supabase local + agente local + Playwright). Idempotente.
#
#   scripts/e2e-painel.sh              # sobe tudo, semeia, roda as duas fases e deixa o ambiente de pé
#   scripts/e2e-painel.sh --down       # idem e derruba tudo no fim (ou use scripts/e2e-painel-down.sh)
#   scripts/e2e-painel.sh --up         # só sobe e semeia (agente sem MFA) e sai, para rodar o Playwright à mão
#   scripts/e2e-painel.sh --up --mfa  # idem, mas com ADMIN_REQUIRE_MFA=true (fase 2)
#   scripts/e2e-painel.sh --no-build   # reaproveita o build do SPA já copiado
#   scripts/e2e-painel.sh -- -g "Auditoria" --project=desktop   # argumentos depois de -- vão ao Playwright
#
# Nunca toca em staging nem produção: Supabase do projeto `proops-e2e` (Docker), DATABASE_URL local,
# `env -i` no agente (nada do shell nem de agent/.env vaza) e HTTPS_PROXY morto, para o envio de
# WhatsApp falhar sem sair de localhost. Detalhes: docs/E2E-PAINEL.md.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E="$RAIZ/scripts/e2e"
WEB="$RAIZ/agent/admin-web"
RUN="$E2E/run"
PORTA=8095
DB=supabase_db_proops-e2e
BUILD=1; DOWN=0; UP=0; MFA=false; PW_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) BUILD=0 ;;
    --up) UP=1 ;;
    --mfa) MFA=true ;;
    --down) DOWN=1 ;;
    --) shift; PW_ARGS=("$@"); break ;;
    *) echo "argumento desconhecido: $1" >&2; exit 2 ;;
  esac
  shift
done

psqlc() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -At "$@"; }

# ── 1. Supabase local ────────────────────────────────────────────────────────────────────────────────────
command -v docker >/dev/null || { echo "docker não encontrado" >&2; exit 1; }
if ! docker ps --format '{{.Names}}' | grep -qx "$DB"; then
  echo "▸ subindo o Supabase local (projeto proops-e2e)…"
  (cd "$E2E" && npx supabase start --workdir . -x studio,imgproxy,edge-runtime,vector,logflare,supavisor,postgres-meta </dev/null >/dev/null)
fi

# ── 2. migrations (todas, uma a uma; a 0008 pede segredos no Vault) ───────────────────────────────────────
psqlc -c "create table if not exists public._e2e_migrations (name text primary key)" >/dev/null
psqlc -c "do \$\$ begin if not exists (select 1 from vault.decrypted_secrets where name='project_url') then perform vault.create_secret('http://127.0.0.1:54321','project_url'); end if; if not exists (select 1 from vault.decrypted_secrets where name='anon_key') then perform vault.create_secret('local-anon-key','anon_key'); end if; end \$\$" >/dev/null
novas=0
for f in "$RAIZ"/supabase/migrations/*.sql; do
  n="$(basename "$f")"
  if [ "$(psqlc -c "select 1 from public._e2e_migrations where name='$n'")" != "1" ]; then
    docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f - < "$f" >/dev/null || { echo "migration $n falhou" >&2; exit 1; }
    psqlc -c "insert into public._e2e_migrations values ('$n')" >/dev/null
    novas=$((novas + 1))
  fi
done
echo "▸ migrations: $novas aplicadas agora"

# ── 3. SPA buildado dentro do agente (como o Dockerfile) ─────────────────────────────────────────────────
if [ "$BUILD" = 1 ]; then
  echo "▸ build do admin-web…"
  (cd "$WEB" && { [ -d node_modules ] || npm ci; } && npm run build >/dev/null)
  rm -rf "$RAIZ/agent/app/static/admin" && mkdir -p "$RAIZ/agent/app/static/admin"
  cp -R "$WEB/dist/." "$RAIZ/agent/app/static/admin/"
fi

# ── 4. seed (contas de teste com senhas novas) ───────────────────────────────────────────────────────────
python3 "$RAIZ/scripts/e2e-seed.py"

# ── 5. agente local ─────────────────────────────────────────────────────────────────────────────────────
cfg() { python3 -c "import json,sys; d=json.load(open('$E2E/.e2e-config.json')); print(eval(sys.argv[1]))" "$1"; }
derruba_agente() {
  if [ -f "$RUN/agente.pid" ]; then kill "$(cat "$RUN/agente.pid")" 2>/dev/null || true; fi
  rm -f "$RUN/agente.pid"
  lsof -ti "tcp:$PORTA" 2>/dev/null | xargs kill 2>/dev/null || true
  sleep 1
}
sobe_agente() {  # $1 = ADMIN_REQUIRE_MFA (true|false)
  derruba_agente
  mkdir -p "$RUN"
  (
    trap '' HUP
    cd "$RUN" || exit 1
    exec env -i PATH="$PATH" HOME="$HOME" \
      NO_PROXY=127.0.0.1,localhost HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 \
      DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
      SUPABASE_URL="$(cfg "d['apiUrl']")" SUPABASE_ANON_KEY="$(cfg "d['anonKey']")" \
      ADMIN_USER_IDS="$(cfg "','.join(d['adminIds'])")" ADMIN_REQUIRE_MFA="$1" \
      DEBOUNCE_BACKEND=inline WHATSAPP_TOKEN=token-invalido-de-proposito-nao-envia \
      WHATSAPP_APP_SECRET=e2e-app-secret WHATSAPP_PHONE_NUMBER_ID=e2e WHATSAPP_VERIFY_TOKEN=e2e \
      RATE_LIMIT_PER_MINUTE=0 THREAD_SALT=e2e-salt INTERNAL_SECRET=e2e-internal-secret-0123456789 \
      "$RAIZ/agent/.venv/bin/python" -m uvicorn --app-dir "$RAIZ/agent" app.main:app \
        --host 127.0.0.1 --port "$PORTA" --workers 1
  ) >"$RUN/agente.log" 2>&1 </dev/null &
  echo $! >"$RUN/agente.pid"
  for _ in $(seq 1 60); do curl -fs "http://127.0.0.1:$PORTA/health" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "agente não subiu; veja $RUN/agente.log" >&2; tail -20 "$RUN/agente.log" >&2; exit 1
}

if [ "$UP" = 1 ]; then sobe_agente "$MFA"; echo "▸ ambiente de pé (ADMIN_REQUIRE_MFA=$MFA) em http://127.0.0.1:$PORTA/admin/ — rode: cd agent/admin-web && npx playwright test"; exit 0; fi

# ── 6. testes: fase 1 (sem MFA) e fase 2 (ADMIN_REQUIRE_MFA=true) ────────────────────────────────────────
status=0
cd "$WEB"
echo "▸ fase 1: painel sem MFA"
sobe_agente false
E2E_PHASE=1 npx playwright test --grep-invert @mfa "${PW_ARGS[@]+"${PW_ARGS[@]}"}" || status=$?
echo "▸ fase 2: ADMIN_REQUIRE_MFA=true"
sobe_agente true
E2E_PHASE=2 npx playwright test --grep @mfa "${PW_ARGS[@]+"${PW_ARGS[@]}"}" || status=$?

if [ "$DOWN" = 1 ]; then "$RAIZ/scripts/e2e-painel-down.sh"; fi
echo "▸ relatório: cd agent/admin-web && npx playwright show-report e2e/.report   (artefatos em agent/admin-web/e2e/.artifacts)"
exit $status
