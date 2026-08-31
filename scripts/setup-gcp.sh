#!/usr/bin/env bash
#
# Provisiona o projeto GCP do agente do Personal ProOps app.
#
# Idempotente: rodar de novo não quebra nada — cada etapa checa antes de criar.
# Nada aqui destrói recurso. Deletar é sempre manual e consciente.
#
#   ./scripts/setup-gcp.sh              # cria/configura tudo
#   ./scripts/setup-gcp.sh preflight    # só confere conta/componente, não cria nada
#   ./scripts/setup-gcp.sh deploy       # só o deploy do Cloud Run
#   ./scripts/setup-gcp.sh secrets      # só (re)grava os segredos
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-personal-proops-agent}"
REGION="${REGION:-southamerica-east1}"   # São Paulo: perto do Supabase e dos usuários
SERVICE="${SERVICE:-agente}"
QUEUE="${QUEUE:-whatsapp-debounce}"
SA_NAME="${SA_NAME:-agente-runner}"
# Nasce DENTRO da organização. Diferente do ERP, aqui não há chave de service
# account para conflitar com as políticas seguras-por-padrão da org — o Cloud
# Run usa a identidade da SA diretamente, sem chave em lugar nenhum.
ORGANIZATION="${ORGANIZATION:-76291957852}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Segredos lidos de agent/.env (NUNCA commitado). O script grava no Secret
# Manager; o Cloud Run recebe por referência, e o valor nunca vira env var em
# texto no console nem no histórico de deploy.
ENV_FILE="${ENV_FILE:-agent/.env}"

SEGREDOS=(
  DATABASE_URL GEMINI_API_KEY GROQ_API_KEY
  WHATSAPP_TOKEN WHATSAPP_APP_SECRET WHATSAPP_VERIFY_TOKEN WHATSAPP_PHONE_NUMBER_ID
  THREAD_SALT SEND_SMS_HOOK_SECRET REVENUECAT_WEBHOOK_SECRET SUPABASE_JWT_SECRET
  LANGFUSE_PUBLIC_KEY LANGFUSE_SECRET_KEY INTERNAL_SECRET
)

log()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
skip() { printf '  · %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

# ---------------------------------------------------------------------------
# 0. preflight — conta certa, componente certo
# ---------------------------------------------------------------------------
# Este script CRIA um projeto e vincula faturamento. Ele faz isso na conta que
# estiver ativa no gcloud, que não é necessariamente a que você quer. Criar o
# projeto na conta errada é chato de desfazer (projeto novo, IAM novo, e o
# faturamento fica pendurado em quem não devia).
preflight() {
  log "Verificações antes de criar qualquer coisa"

  if ! gcloud beta billing accounts list &>/dev/null; then
    echo "  ✗ o componente 'beta' do gcloud não está instalado (o script usa" >&2
    echo "    'gcloud beta billing'). Rode:  gcloud components install beta" >&2
    exit 1
  fi

  local conta
  conta="$(gcloud config get-value account 2>/dev/null)"
  printf '  conta gcloud ativa : %s\n' "${conta:-<nenhuma>}"
  printf '  projeto a criar    : %s\n' "$PROJECT_ID"
  printf '  organização        : %s\n' "${ORGANIZATION:-<nenhuma>}"
  printf '  região             : %s\n' "$REGION"

  local billing
  billing="${BILLING_ACCOUNT:-$(gcloud beta billing accounts list \
    --filter='open=true' --format='value(name)' --limit=1 2>/dev/null)}"
  printf '  conta de cobrança  : %s\n' "${billing:-<nenhuma aberta>}"

  # Não dá para adivinhar qual conta é "a certa" — mas dá para obrigar você a
  # olhar antes. Um "sim" digitado custa 2 segundos; o projeto na conta errada
  # custa uma tarde.
  printf '\n'
  read -r -p "  É esta a conta Google onde o projeto deve nascer? [s/N] " r
  [[ "$r" =~ ^[sS]$ ]] || {
    echo "  abortado. Troque com:  gcloud auth login" >&2
    echo "  (e considere 'gcloud config configurations create <nome>' para manter" >&2
    echo "   uma configuração por conta, evitando trocar sem perceber)" >&2
    exit 1
  }
}

# ---------------------------------------------------------------------------
# 1. projeto e faturamento
# ---------------------------------------------------------------------------
criar_projeto() {
  log "Projeto $PROJECT_ID"
  if gcloud projects describe "$PROJECT_ID" &>/dev/null; then
    local pai
    pai="$(gcloud projects describe "$PROJECT_ID" --format='value(parent.id)' 2>/dev/null)"
    if [[ -n "$ORGANIZATION" && "$pai" != "$ORGANIZATION" ]]; then
      warn "já existe FORA da organização — mover com:"
      warn "  gcloud beta projects move $PROJECT_ID --organization=$ORGANIZATION"
    else
      skip "já existe na organização certa"
    fi
  elif [[ -n "$ORGANIZATION" ]]; then
    gcloud projects create "$PROJECT_ID" --name="Personal ProOps agente" \
      --organization="$ORGANIZATION"
  else
    gcloud projects create "$PROJECT_ID" --name="Personal ProOps agente"
  fi

  # A conta de faturamento é a que você já tem; o projeto é novo e ISOLADO, que é
  # o ponto: quota, IAM e logs deste agente não se misturam com nada seu.
  local billing
  billing="${BILLING_ACCOUNT:-$(gcloud beta billing accounts list \
    --filter='open=true' --format='value(name)' --limit=1)}"
  if [[ -z "$billing" ]]; then
    echo "  ✗ nenhuma conta de faturamento aberta. Defina BILLING_ACCOUNT=XXXXXX-XXXXXX" >&2
    exit 1
  fi
  if gcloud beta billing projects describe "$PROJECT_ID" \
       --format='value(billingEnabled)' 2>/dev/null | grep -q True; then
    skip "faturamento já vinculado"
  else
    gcloud beta billing projects link "$PROJECT_ID" --billing-account="$billing"
  fi

  gcloud config set project "$PROJECT_ID" --quiet
}

# ---------------------------------------------------------------------------
# 2. APIs
# ---------------------------------------------------------------------------
ativar_apis() {
  log "APIs"
  # cloudbuild e artifactregistry entram porque `run deploy --source` compila a
  # imagem no Cloud Build e a guarda no Artifact Registry.
  gcloud services enable \
    run.googleapis.com \
    cloudtasks.googleapis.com \
    secretmanager.googleapis.com \
    cloudscheduler.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    --project "$PROJECT_ID"
}

# ---------------------------------------------------------------------------
# 3. service account
# ---------------------------------------------------------------------------
criar_sa() {
  log "Service account $SA_EMAIL"
  if gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" &>/dev/null; then
    skip "já existe"
  else
    gcloud iam service-accounts create "$SA_NAME" \
      --display-name="Agente do Personal ProOps" --project "$PROJECT_ID"
  fi

  # Ela é a identidade do CONTAINER (lê segredos, cria tasks) e também a que
  # ASSINA o OIDC das tasks e dos crons. Uma SA só, dois papéis, sem chave
  # exportada em lugar nenhum.
  for papel in roles/secretmanager.secretAccessor roles/cloudtasks.enqueuer roles/run.invoker; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:${SA_EMAIL}" --role="$papel" \
      --condition=None --quiet >/dev/null
  done
}

# ---------------------------------------------------------------------------
# 3b. permissões do build
# ---------------------------------------------------------------------------
# A organização tem `iam.automaticIamGrantsForDefaultServiceAccounts` ligada, o
# que é bom: a service account padrão do Compute NÃO ganha Editor sozinha. Mas
# é ela que o `run deploy --source` usa para compilar no Cloud Build — sem papel
# explícito, o build falha com erro de permissão que não diz isso claramente.
permitir_build() {
  [[ -n "$ORGANIZATION" ]] || { skip "sem organização: grants automáticos valem"; return; }
  log "Permissões de build (a org desliga os grants automáticos)"

  local numero build_sa
  numero="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  build_sa="${numero}-compute@developer.gserviceaccount.com"

  for papel in roles/cloudbuild.builds.builder roles/logging.logWriter \
               roles/artifactregistry.writer roles/storage.objectUser; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:${build_sa}" --role="$papel" \
      --condition=None --quiet >/dev/null
  done
  ok "papéis de build concedidos a ${build_sa}"
}

# ---------------------------------------------------------------------------
# 4. segredos
# ---------------------------------------------------------------------------
gravar_segredos() {
  log "Secret Manager (fonte: $ENV_FILE)"
  [[ -f "$ENV_FILE" ]] || { echo "  ✗ $ENV_FILE não existe" >&2; exit 1; }

  for nome in "${SEGREDOS[@]}"; do
    # lê a variável do .env sem dar `source` (o arquivo tem comentários e '#'
    # dentro de valores; source executaria conteúdo)
    local valor
    valor="$(grep -E "^${nome}=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | xargs || true)"
    if [[ -z "$valor" ]]; then
      skip "$nome vazio no .env — pulando"
      continue
    fi
    local id="${nome//_/-}"; id="$(echo "$id" | tr '[:upper:]' '[:lower:]')"
    if ! gcloud secrets describe "$id" --project "$PROJECT_ID" &>/dev/null; then
      gcloud secrets create "$id" --replication-policy=automatic --project "$PROJECT_ID" >/dev/null
    fi
    # sempre uma versão nova: rotacionar é rodar de novo com o .env atualizado
    printf '%s' "$valor" | gcloud secrets versions add "$id" --data-file=- \
      --project "$PROJECT_ID" >/dev/null

    # Desativa as anteriores. Versão antiga fica ATIVA e cobrando (US$ 0,06 por
    # versão/mês, 6 grátis) — rodar o script 3 vezes já triplicaria a conta sem
    # que nada mudasse. E versão velha ativa é credencial velha ainda válida.
    local destruidas=0
    for v in $(gcloud secrets versions list "$id" --project "$PROJECT_ID" \
                 --filter='state:ENABLED' --format='value(name)' --sort-by='~name' \
                 2>/dev/null | tail -n +2); do
      gcloud secrets versions destroy "$v" --secret="$id" --project "$PROJECT_ID" \
        --quiet >/dev/null 2>&1 && destruidas=$((destruidas+1))
    done
    if [[ $destruidas -gt 0 ]]; then
      printf '  ✓ %s (%s versão(ões) antiga(s) destruída(s))\n' "$id" "$destruidas"
    else
      printf '  ✓ %s\n' "$id"
    fi
  done
}

# ---------------------------------------------------------------------------
# 5. fila do Cloud Tasks (o debounce)
# ---------------------------------------------------------------------------
criar_fila() {
  log "Cloud Tasks: $QUEUE"
  if gcloud tasks queues describe "$QUEUE" --location "$REGION" --project "$PROJECT_ID" &>/dev/null; then
    skip "já existe — atualizando limites"
    local cmd=update
  else
    local cmd=create
  fi

  # max-attempts 3 e backoff exponencial: é a segunda camada de retry (a primeira
  # é o retry_count na fila do Postgres, para falha lógica).
  #
  # max-concurrent-dispatches 20: teto de conversas processando ao mesmo tempo.
  # Serve de freio no custo do Gemini — uma rajada de 500 mensagens não vira 500
  # chamadas simultâneas, vira uma fila que anda.
  gcloud tasks queues "$cmd" "$QUEUE" \
    --location "$REGION" --project "$PROJECT_ID" \
    --max-attempts=3 \
    --min-backoff=2s \
    --max-backoff=60s \
    --max-doublings=3 \
    --max-concurrent-dispatches=20 \
    --max-dispatches-per-second=10
}

# ---------------------------------------------------------------------------
# 6. deploy do Cloud Run
# ---------------------------------------------------------------------------
deploy() {
  log "Cloud Run: $SERVICE"

  # --allow-unauthenticated é OBRIGATÓRIO: a Meta não manda token OIDC. Por isso
  # CADA rota carrega a própria autenticação — HMAC no webhook, OIDC verificado
  # em /worker e /cron, standardwebhooks no OTP. Ver agent/app/security.py.
  #
  # --concurrency 80: o trabalho é I/O (Postgres, Gemini, Graph API) e o event
  # loop do asyncio aguenta bem. Menos que isso multiplicaria container (e
  # conexão de banco) à toa; muito mais estrangularia o pool de 4 conexões.
  #
  # --min-instances 0 é o scale-to-zero pedido. Ele só é possível porque o
  # debounce mora no Cloud Tasks e não em timer de memória.
  local secrets=""
  for nome in "${SEGREDOS[@]}"; do
    local id="${nome//_/-}"; id="$(echo "$id" | tr '[:upper:]' '[:lower:]')"
    gcloud secrets describe "$id" --project "$PROJECT_ID" &>/dev/null || continue
    secrets+="${nome}=${id}:latest,"
  done
  secrets="${secrets%,}"

  # Ovo e galinha: o boot recusa subir sem WORKER_URL, e WORKER_URL é a URL do
  # próprio serviço — que só existiria depois de um deploy saudável. A saída é
  # que a URL do Cloud Run é DETERMINÍSTICA a partir do número do projeto, então
  # dá para passá-la já no primeiro deploy. Confirmada contra a real logo abaixo.
  local numero url_prevista
  numero="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  url_prevista="https://${SERVICE}-${numero}.${REGION}.run.app"
  printf '  URL prevista: %s\n' "$url_prevista"

  gcloud run deploy "$SERVICE" \
    --source agent \
    --project "$PROJECT_ID" --region "$REGION" \
    --service-account "$SA_EMAIL" \
    --allow-unauthenticated \
    --min-instances 0 \
    --max-instances 10 \
    --concurrency 80 \
    --cpu 1 --memory 1Gi \
    --timeout 300 \
    --quiet \
    --set-secrets "$secrets" \
    --set-env-vars "GCP_PROJECT=${PROJECT_ID},GCP_LOCATION=${REGION},TASKS_QUEUE=${QUEUE},TASKS_SA_EMAIL=${SA_EMAIL},DEBOUNCE_BACKEND=cloud_tasks,DEBOUNCE_SECONDS=3,WORKER_URL=${url_prevista}/worker/process-thread,OIDC_AUDIENCE=${url_prevista}"

  URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" \
          --region "$REGION" --format='value(status.url)')"

  if [[ "$URL" != "$url_prevista" ]]; then
    warn "a URL real difere da prevista — corrigindo"
    warn "  prevista: $url_prevista"
    warn "  real    : $URL"
    gcloud run services update "$SERVICE" \
      --project "$PROJECT_ID" --region "$REGION" \
      --update-env-vars "WORKER_URL=${URL}/worker/process-thread,OIDC_AUDIENCE=${URL}" \
      --quiet
  else
    ok "URL bateu com a prevista"
  fi

  printf '\n  Webhook da Meta:  %s/whatsapp-inbound\n' "$URL"
  printf '  Hook de OTP:      %s/hooks/otp\n' "$URL"
  printf '  Webhook billing:  %s/hooks/billing\n\n' "$URL"
}

# ---------------------------------------------------------------------------
# 7. crons
# ---------------------------------------------------------------------------
criar_crons() {
  log "Cloud Scheduler"
  local url
  url="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" \
          --region "$REGION" --format='value(status.url)')"

  # reminders roda a cada minuto e leva junto o sweep da fila. É rede de
  # segurança: se o agendamento no Cloud Tasks falhar, a mensagem ficaria parada
  # para sempre — a perda silenciosa que esta arquitetura existe para matar.
  criar_cron reminders          "* * * * *"   "$url/cron/reminders"
  criar_cron finance-scheduler  "0 * * * *"   "$url/cron/finance-scheduler"
  criar_cron alerts             "0 12 * * *"  "$url/cron/alerts"
}

# Os jobs nascem PAUSADOS de propósito. O pg_cron do Supabase continua fazendo
# esse trabalho até o corte; os dois rodando ao mesmo tempo entregariam lembrete
# em duplicado (lembrete não tem dedupe, diferente de alerta e recorrente).
# Ligar é decisão explícita, no cutover:
#   gcloud scheduler jobs resume <nome> --location <regiao> --project <projeto>
criar_cron() {
  local nome="$1" agenda="$2" alvo="$3"
  local cmd=create
  gcloud scheduler jobs describe "$nome" --location "$REGION" --project "$PROJECT_ID" &>/dev/null \
    && cmd=update
  gcloud scheduler jobs "$cmd" http "$nome" \
    --location "$REGION" --project "$PROJECT_ID" \
    --schedule "$agenda" --time-zone "America/Sao_Paulo" \
    --uri "$alvo" --http-method POST \
    --oidc-service-account-email "$SA_EMAIL" \
    --oidc-token-audience "${alvo%/cron/*}" \
    --attempt-deadline 300s \
    --quiet >/dev/null
  gcloud scheduler jobs pause "$nome" --location "$REGION" --project "$PROJECT_ID" \
    --quiet >/dev/null 2>&1 || true
  printf '  ✓ %s (%s) — PAUSADO até o corte\n' "$nome" "$agenda"
}

# ---------------------------------------------------------------------------
main() {
  case "${1:-tudo}" in
    deploy)  criar_projeto; deploy; criar_crons ;;
    preflight) preflight ;;
    build-iam) criar_projeto; permitir_build ;;
    secrets) criar_projeto; gravar_segredos ;;
    tudo)
      preflight
      criar_projeto
      ativar_apis
      criar_sa
      permitir_build
      gravar_segredos
      criar_fila
      deploy
      criar_crons
      log "Pronto. Aponte o webhook da Meta para a URL acima."
      ;;
    *) echo "uso: $0 [tudo|deploy|secrets|preflight|build-iam]" >&2; exit 1 ;;
  esac
}
main "$@"
