#!/usr/bin/env bash
# Derruba o ambiente do E2E do painel: agente (porta 8095) e Supabase local do projeto proops-e2e.
# Os dados ficam no volume Docker (a próxima subida reaproveita); com --purge apaga o volume também.
set -uo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$RAIZ/scripts/e2e/run"
if [ -f "$RUN/agente.pid" ]; then kill "$(cat "$RUN/agente.pid")" 2>/dev/null; fi
rm -f "$RUN/agente.pid"
lsof -ti tcp:8095 2>/dev/null | xargs kill 2>/dev/null
cd "$RAIZ/scripts/e2e" && npx supabase stop --workdir . ${1:+--no-backup} </dev/null
echo "ambiente do E2E derrubado."
