#!/usr/bin/env bash
#
# Aposenta a anon key que vazou no histórico do git (migration 0003).
#
#   ⚠️ LEIA ISTO ANTES DE RODAR ⚠️
#
# 1. **Não existe mais "rotacionar a anon key".** O Supabase encerrou a rotação
#    das chaves legadas (anon/service_role/JWT secret). O caminho é MIGRAR para o
#    par novo — `sb_publishable_...` e `sb_secret_...` — e depois DESABILITAR as
#    legadas. Desabilitar é o que invalida a chave vazada.
#
# 2. **Severidade real: baixa.** A anon key é pública POR DESIGN — ela já está
#    dentro de todo binário do app publicado. O que ela permite é exatamente o
#    que a RLS permite ao papel `anon`. O problema de estar no git é higiene e
#    auditoria, não um segredo exposto.
#
# 3. **O passo final QUEBRA todo app já instalado.** `EXPO_PUBLIC_SUPABASE_ANON_KEY`
#    é embutida no bundle em tempo de build. Desabilitar as chaves legadas derruba
#    o login e as consultas de quem não atualizou. Por isso o script se recusa a
#    fazer esse passo sozinho.
#
# Ordem correta (as etapas 1-3 são seguras e reversíveis; a 4 não é):
#
#   ./scripts/retire-legacy-keys.sh check     # o que ainda usa a chave legada
#   ./scripts/retire-legacy-keys.sh vault     # tira a cópia do Vault (pg_cron)
#   ./scripts/retire-legacy-keys.sh app       # troca a chave do app pelo .env
#   (publicar build, esperar adoção)
#   ./scripts/retire-legacy-keys.sh disable   # exige confirmação digitada
#
set -euo pipefail

DB_URL="${SUPABASE_DB_URL:-}"
ENV_FILE="${ENV_FILE:-.env}"

log()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
warn() { printf '  \033[33m! %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$*"; }

precisa_db() {
  [[ -n "$DB_URL" ]] || {
    echo "  ✗ defina SUPABASE_DB_URL (Dashboard → Settings → Database → Connection string)" >&2
    exit 1
  }
}

# ---------------------------------------------------------------------------
check() {
  log "Quem ainda depende da chave legada"

  printf '\n  1) App mobile — src/lib/supabase.ts\n'
  if grep -q "EXPO_PUBLIC_SUPABASE_ANON_KEY" src/lib/supabase.ts 2>/dev/null; then
    local valor
    valor="$(grep -E '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
    case "$valor" in
      sb_publishable_*) ok "já usa chave publishable" ;;
      "")               warn "não achei o valor em $ENV_FILE" ;;
      *)                warn "ainda usa a chave LEGADA — troque e publique um build" ;;
    esac
  fi

  printf '\n  2) pg_cron via Vault — migrations 0008/0016/0025\n'
  if [[ -n "$DB_URL" ]]; then
    if psql "$DB_URL" -tAc "select 1 from vault.decrypted_secrets where name='anon_key'" | grep -q 1; then
      warn "o segredo 'anon_key' ainda existe no Vault"
      psql "$DB_URL" -tAc "select '     cron ativo: '||jobname from cron.job" || true
    else
      ok "sem cópia da chave no Vault"
    fi
  else
    warn "SUPABASE_DB_URL não definida — pulei a checagem do Vault"
  fi

  printf '\n  3) Agente Python\n'
  ok "não usa a anon key (conecta por DATABASE_URL); nada a fazer"

  printf '\n  4) Edge Functions\n'
  ok "o webhook usa SUPABASE_SERVICE_ROLE_KEY injetada pelo runtime, não a anon"
}

# ---------------------------------------------------------------------------
# Etapa 2 — a que de fato aposenta o uso da chave vazada.
# Os crons passaram para o Cloud Scheduler (OIDC), então a cópia da chave no
# Vault e os cron.schedule do pg_cron não têm mais razão de existir.
vault() {
  precisa_db
  log "Desligando os crons do pg_cron e apagando a chave do Vault"

  warn "isto pressupõe que /cron/reminders, /cron/finance-scheduler e /cron/alerts"
  warn "já estão no Cloud Scheduler e respondendo. Confirme antes."
  read -r -p "  Os crons do Cloud Scheduler já estão no ar? [s/N] " r
  [[ "$r" =~ ^[sS]$ ]] || { echo "  abortado."; exit 0; }

  psql "$DB_URL" <<'PSQL'
do $$
declare j text;
begin
  foreach j in array array['process-jobs','send-reminders','finance-scheduler','send-alerts'] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
      raise notice 'cron % desagendado', j;
    end if;
  end loop;
end $$;

-- some com a cópia da chave. É o que tira de uso a chave que está no git.
delete from vault.secrets where name = 'anon_key';
PSQL
  ok "crons desagendados e 'anon_key' removida do Vault"
}

# ---------------------------------------------------------------------------
# Etapa 3 — troca a chave do app pela publishable.
app() {
  log "Trocando a chave do app pela publishable"
  local nova="${PUBLISHABLE_KEY:-}"
  if [[ -z "$nova" ]]; then
    echo "  Dashboard → Settings → API Keys → copie a chave sb_publishable_..."
    read -r -p "  Cole aqui: " nova
  fi
  [[ "$nova" == sb_publishable_* ]] || { echo "  ✗ não parece uma publishable key" >&2; exit 1; }

  # a publishable substitui a anon no MESMO lugar: o cliente aceita as duas
  if grep -q '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' "$ENV_FILE"; then
    local backup="${ENV_FILE}.bak.$(date +%s)"
    cp "$ENV_FILE" "$backup"
    sed -i.tmp "s|^EXPO_PUBLIC_SUPABASE_ANON_KEY=.*|EXPO_PUBLIC_SUPABASE_ANON_KEY=${nova}|" "$ENV_FILE"
    rm -f "${ENV_FILE}.tmp"
    ok "$ENV_FILE atualizado (backup em $backup)"
  else
    echo "EXPO_PUBLIC_SUPABASE_ANON_KEY=${nova}" >> "$ENV_FILE"
    ok "$ENV_FILE recebeu a chave"
  fi

  warn "agora: eas build + publicar nas lojas, e ESPERAR a adoção."
  warn "só depois disso rode 'disable' — antes, você derruba quem não atualizou."
}

# ---------------------------------------------------------------------------
# Etapa 4 — irreversível para binários antigos.
disable() {
  log "Desabilitar as chaves legadas"
  cat <<'TXT'

  Este passo é feito NO DASHBOARD (não há CLI para ele):
    Settings → API Keys → JWT keys → "Disable legacy JWT secret"

  A partir dele, a chave que está no histórico do git para de funcionar — que é
  o objetivo. E TODO app instalado com a chave antiga para junto.

  Antes de fazer, confirme:
    [ ] build com a publishable key publicado nas duas lojas
    [ ] taxa de adoção aceitável (Play Console / App Store Connect)
    [ ] './scripts/retire-legacy-keys.sh check' sem nenhum aviso
    [ ] crons no Cloud Scheduler funcionando há pelo menos 24h

TXT
  read -r -p '  Digite "eu confirmei a adoção" para prosseguir: ' r
  [[ "$r" == "eu confirmei a adoção" ]] || { echo "  abortado — e essa é a resposta certa se você hesitou."; exit 0; }
  ok "vá em frente no dashboard. O script não faz isso por você de propósito."
}

case "${1:-check}" in
  check)   check ;;
  vault)   vault ;;
  app)     app ;;
  disable) disable ;;
  *) echo "uso: $0 [check|vault|app|disable]" >&2; exit 1 ;;
esac
