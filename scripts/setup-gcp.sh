#!/usr/bin/env bash
#
# Provisiona o projeto GCP do agente do ProOps.
#
# Idempotente: rodar de novo não quebra nada — cada etapa checa antes de criar.
# Nada aqui destrói recurso. Deletar é sempre manual e consciente.
#
#   ./scripts/setup-gcp.sh              # cria/configura tudo
#   ./scripts/setup-gcp.sh preflight    # só confere conta/componente, não cria nada
#   ./scripts/setup-gcp.sh deploy       # só o deploy do Cloud Run
#   ./scripts/setup-gcp.sh staging      # serviço/fila/segredos de STAGING (sem crons)
#   ./scripts/setup-gcp.sh painel       # painel /admin de PRODUÇÃO: serviço próprio, atrás do IAP
#   ./scripts/setup-gcp.sh painel-staging  # o mesmo, para o staging
#   ./scripts/setup-gcp.sh sa           # contas de serviço e permissões mínimas do ambiente
#   ./scripts/setup-gcp.sh iap-oauth    # cliente OAuth do IAP para os dois painéis (uma vez; docs/PAINEL-ADMIN.md)
#   ./scripts/setup-gcp.sh secrets      # só (re)grava os segredos
#   ./scripts/setup-gcp.sh backup       # backup diário do banco de PRODUÇÃO (bucket + Cloud Run Job + Scheduler)
#   ./scripts/setup-gcp.sh backup-staging  # o mesmo, para o banco de staging (docs/BACKUP.md)
#   ./scripts/setup-gcp.sh alertas      # métricas de log, políticas (ALERT_EMAIL) e orçamento
#                                       # (BILLING_ACCOUNT + BUDGET_AMOUNT, na moeda da conta); sem as variáveis, pula
#
set -euo pipefail

# Os defaults de staging precisam vir ANTES dos de produção, logo abaixo: quando
# `main()` roda, SERVICE já vale "agente" e um `${SERVICE:-agente-staging}` lá
# embaixo nunca dispararia — o "staging" faria deploy EM CIMA da produção.
if [[ "${1:-}" == staging || "${1:-}" == backup-staging || "${1:-}" == painel-staging || "${1:-}" == sa-staging ]]; then
  : "${SERVICE:=agente-staging}"
  : "${QUEUE:=whatsapp-debounce-staging}"
  : "${ENV_FILE:=agent/.env}"
  : "${SECRET_SUFFIX:=-staging}"
  : "${SA_NAME:=agente-staging-runner}"
fi

PROJECT_ID="${PROJECT_ID:-personal-proops-agent}"
REGION="${REGION:-southamerica-east1}"   # São Paulo: perto do Supabase e dos usuários
SERVICE="${SERVICE:-agente}"
QUEUE="${QUEUE:-whatsapp-debounce}"
# UMA conta de serviço POR AMBIENTE (13/10/2026). Antes staging e produção rodavam com a mesma
# `agente-runner`, que tinha no PROJETO inteiro: ler qualquer segredo, invocar qualquer serviço e
# enfileirar em qualquer fila. Comprometer o staging era ler a `database-url` de PRODUÇÃO e chamar o
# worker de produção. Hoje cada conta só alcança o que é do seu ambiente (`restringir_sa`).
SA_NAME="${SA_NAME:-agente-runner}"
# Nasce DENTRO da organização. Diferente do ERP, aqui não há chave de service
# account para conflitar com as políticas seguras-por-padrão da org — o Cloud
# Run usa a identidade da SA diretamente, sem chave em lugar nenhum.
ORGANIZATION="${ORGANIZATION:-76291957852}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Segredos lidos de um .env do agente (NUNCA commitado). O script grava no
# Secret Manager; o Cloud Run recebe por referência, e o valor nunca vira env
# var em texto no console nem no histórico de deploy.
#
# O default é `.env.production` e o `staging` acima já trocou para `.env`. A
# assimetria é intencional: `.env` é o que TUDO que não escolhe acaba lendo
# (docker compose, pydantic, `source`), então ele é o staging; produção tem
# nome próprio e só chega aqui por este caminho.
ENV_FILE="${ENV_FILE:-agent/.env.production}"

# Sufixo dos IDs no Secret Manager. Os segredos são POR PROJETO GCP, e staging e
# produção dividem o mesmo projeto — sem sufixo, o serviço de staging receberia
# o `database-url` de PRODUÇÃO e escreveria no banco real, que é exatamente o
# que staging existe para impedir. O nome da env var no container não muda:
#   --set-secrets DATABASE_URL=database-url-staging:latest
SECRET_SUFFIX="${SECRET_SUFFIX:-}"

# O painel /admin mora num serviço próprio, atrás do IAP, com a sua conta: ela só lê a URL do banco.
PAINEL_SERVICE="${PAINEL_SERVICE:-painel${SECRET_SUFFIX}}"
PAINEL_SA_EMAIL="painel${SECRET_SUFFIX}-runner@${PROJECT_ID}.iam.gserviceaccount.com"

SEGREDOS=(
  DATABASE_URL GEMINI_API_KEY ANTHROPIC_API_KEY GROQ_API_KEY
  WHATSAPP_TOKEN WHATSAPP_APP_SECRET WHATSAPP_VERIFY_TOKEN WHATSAPP_PHONE_NUMBER_ID
  THREAD_SALT SEND_SMS_HOOK_SECRET REVENUECAT_WEBHOOK_SECRET SUPABASE_JWT_SECRET
  LANGFUSE_PUBLIC_KEY LANGFUSE_SECRET_KEY INTERNAL_SECRET
)

# Sem estes o agente sobe quebrado (o deploy pularia o segredo ausente em silêncio): o deploy falha.
SEGREDOS_OBRIGATORIOS=(DATABASE_URL GEMINI_API_KEY ANTHROPIC_API_KEY)

# Lê UMA variável do $ENV_FILE sem dar `source` (o arquivo tem comentários, e
# source executaria conteúdo). Corta comentário de fim de linha e espaço.
ler_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- \
  | sed 's/[[:space:]]*#.*$//' | xargs || true; }

log()  { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
skip() { printf '  · %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; }

# Conta de serviço recém-criada leva alguns segundos para o IAM dos OUTROS recursos (segredo, fila,
# serviço) a enxergar: o `describe` já responde e o binding ainda volta 400 "does not exist" (13/10/2026,
# painel-runner em produção). Repete SÓ esse erro, por até ~2 min; qualquer outro falha na hora.
com_propagacao() {
  local saida tentativa
  for tentativa in $(seq 1 24); do
    if saida="$("$@" 2>&1)"; then return 0; fi
    grep -q "does not exist" <<<"$saida" || { printf '%s\n' "$saida" >&2; return 1; }
    sleep 5
  done
  printf '%s\n' "$saida" >&2; return 1
}

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

  # ⚠️ "não consegui ver o projeto" NÃO é "o projeto não existe".
  #
  # O `describe` abaixo mandava tudo para /dev/null, então um PERMISSION_DENIED — a conta ativa
  # do gcloud sendo outra, o que é comum em quem trabalha para mais de um lugar — caía no `else`
  # e ia CRIAR o projeto. Em 10/09/2026 isso parou por um segundo acaso: a conta também não
  # tinha permissão de criar. Se tivesse, teria nascido um `personal-proops-agent` paralelo na
  # organização errada, e o deploy seguinte publicaria o agente num projeto vazio.
  #
  # A checagem certa separa os dois casos pelo texto do erro, e um erro de acesso PARA.
  local erro
  if ! erro="$(gcloud projects describe "$PROJECT_ID" 2>&1 >/dev/null)"; then
    if grep -qi "permission\|denied\|not authorized" <<<"$erro"; then
      err "sem acesso ao projeto $PROJECT_ID com a conta ativa do gcloud:"
      err "  $(gcloud config get-value account 2>/dev/null)"
      err ""
      err "Troque para a conta deste projeto e rode de novo:"
      err "  gcloud config set account <a-conta-do-projeto>"
      err "  gcloud auth list   # para ver as disponíveis"
      exit 1
    fi
  fi

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
    gcloud projects create "$PROJECT_ID" --name="ProOps agente" \
      --organization="$ORGANIZATION"
  else
    gcloud projects create "$PROJECT_ID" --name="ProOps agente"
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
      --display-name="Agente do ProOps" --project "$PROJECT_ID"
  fi

  # Ela é a identidade do CONTAINER (lê segredos, cria tasks) e também a que ASSINA o OIDC das
  # tasks e dos crons, sem chave exportada em lugar nenhum. As permissões NÃO são dadas no projeto:
  # `restringir_sa` as dá recurso a recurso (os segredos do ambiente, a fila, o próprio serviço).

  # ...e serviceAccountUser SOBRE SI MESMA. Para criar uma task com token OIDC
  # assinado como esta SA, o Cloud Tasks exige `iam.serviceAccounts.actAs` do
  # CHAMADOR sobre a SA do token — e aqui os dois são a mesma conta. Sem isso o
  # `create_task` devolve 403 e o debounce nunca é agendado: a mensagem entra na
  # messages_queue e fica lá. O código degrada para o /worker/sweep e responde
  # 200 ("o sweep recupera"), mas o sweep vive no cron de lembretes, que nasce
  # PAUSADO — então o efeito real é mensagem enfileirada e nunca processada.
  # A org desliga os grants automáticos, então este binding não vem de graça.
  com_propagacao gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
    --member="serviceAccount:${SA_EMAIL}" --role=roles/iam.serviceAccountUser \
    --project "$PROJECT_ID" --quiet
  ok "actAs sobre si mesma (Cloud Tasks assina o OIDC com esta SA)"

  # Os segredos do AMBIENTE, um a um, ANTES do deploy (a revisão nova não sobe sem ler cada um).
  local nome id
  for nome in "${SEGREDOS[@]}"; do
    id="$(id_do_segredo "$nome")"
    gcloud secrets describe "$id" --project "$PROJECT_ID" &>/dev/null || continue
    com_propagacao gcloud secrets add-iam-policy-binding "$id" --project "$PROJECT_ID" \
      --member="serviceAccount:${SA_EMAIL}" --role=roles/secretmanager.secretAccessor \
      --condition=None --quiet
  done
  ok "lê só os segredos ${SECRET_SUFFIX:-de produção}"
}

# Id do Secret Manager de uma variável, no ambiente corrente (DATABASE_URL → database-url-staging).
id_do_segredo() { local id="${1//_/-}"; echo "$(echo "$id" | tr '[:upper:]' '[:lower:]')${SECRET_SUFFIX}"; }

# Permissões mínimas da conta do ambiente, recurso a recurso, e SÓ DEPOIS a retirada dos papéis
# amplos do projeto — nessa ordem não existe janela em que o serviço perde acesso.
restringir_sa() {
  log "Permissões mínimas de $SA_EMAIL"
  if gcloud tasks queues describe "$QUEUE" --location "$REGION" --project "$PROJECT_ID" &>/dev/null; then
    gcloud tasks queues add-iam-policy-binding "$QUEUE" --location "$REGION" --project "$PROJECT_ID" \
      --member="serviceAccount:${SA_EMAIL}" --role=roles/cloudtasks.enqueuer --quiet >/dev/null
    ok "enfileira só em $QUEUE"
  else
    warn "fila $QUEUE ainda não existe: sem a permissão de enfileirar (rode de novo depois de criá-la)"
  fi
  # As tasks e os crons chamam o PRÓPRIO serviço com OIDC assinado por esta conta.
  if gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT_ID" &>/dev/null; then
    gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" --project "$PROJECT_ID" \
      --member="serviceAccount:${SA_EMAIL}" --role=roles/run.invoker --quiet >/dev/null
    ok "invoca só $SERVICE"
  else
    warn "serviço $SERVICE ainda não existe: sem a permissão de invocar (rode de novo depois do deploy)"
    return
  fi
  # O backup do ambiente é disparado pelo Scheduler com esta conta: invocar SÓ o job dele.
  local job="backup-banco${SECRET_SUFFIX}"
  if gcloud run jobs describe "$job" --region "$REGION" --project "$PROJECT_ID" &>/dev/null; then
    gcloud run jobs add-iam-policy-binding "$job" --region "$REGION" --project "$PROJECT_ID" \
      --member="serviceAccount:${SA_EMAIL}" --role=roles/run.invoker --quiet >/dev/null
    ok "invoca só o job $job"
  fi
  local papel amplos=()
  for papel in roles/secretmanager.secretAccessor roles/cloudtasks.enqueuer roles/run.invoker; do
    if gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' \
         --filter="bindings.role=${papel} AND bindings.members=serviceAccount:${SA_EMAIL}" \
         --format='value(bindings.role)' 2>/dev/null | grep -q .; then
      amplos+=("$papel")
    fi
  done
  [[ ${#amplos[@]} -gt 0 ]] || return 0
  # Outro serviço ou job ainda rodando com ESTA conta (ex.: o staging antes de ganhar a dele) perderia o
  # acesso junto. Nesse caso não retira nada e diz quem está usando.
  local outros
  outros="$( { gcloud run services list --project "$PROJECT_ID" --region "$REGION" \
                 --format='value(metadata.name,spec.template.spec.serviceAccountName)' 2>/dev/null
               gcloud run jobs list --project "$PROJECT_ID" --region "$REGION" \
                 --format='value(metadata.name,spec.template.spec.template.spec.serviceAccountName)' 2>/dev/null
             } | awk -v sa="$SA_EMAIL" -v svc="$SERVICE" -v job="$job" '$2==sa && $1!=svc && $1!=job {print $1}')"
  if [[ -n "$outros" ]]; then
    warn "NÃO retirei os papéis amplos: ainda rodam com $SA_EMAIL: $(echo $outros)"
    warn "  rode o ambiente deles antes (ex.: '$0 staging' e '$0 backup-staging') e depois '$0 sa'"
    return 0
  fi
  # O IAM leva minutos para propagar (medido no staging em 13/10/2026: o `create_task` foi recusado
  # logo depois da permissão na fila, e passou depois). Tirar o papel amplo antes disso abriria uma
  # janela de mensagens sem debounce. Espera, e só então retira.
  warn "esperando ${IAM_PROPAGACAO_S:-180}s a propagação das permissões novas antes de tirar as amplas"
  sleep "${IAM_PROPAGACAO_S:-180}"
  for papel in "${amplos[@]}"; do
    gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
      --member="serviceAccount:${SA_EMAIL}" --role="$papel" --condition=None --quiet >/dev/null
    ok "retirado do projeto inteiro: $papel"
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
    local valor
    valor="$(ler_env "$nome")"
    if [[ -z "$valor" ]]; then
      skip "$nome vazio no .env — pulando"
      continue
    fi
    local id="${nome//_/-}"; id="$(echo "$id" | tr '[:upper:]' '[:lower:]')""${SECRET_SUFFIX}"
    if ! gcloud secrets describe "$id" --project "$PROJECT_ID" &>/dev/null; then
      gcloud secrets create "$id" --replication-policy=automatic --project "$PROJECT_ID" >/dev/null
    fi
    # sempre uma versão nova: rotacionar é rodar de novo com o .env atualizado
    printf '%s' "$valor" | gcloud secrets versions add "$id" --data-file=- \
      --project "$PROJECT_ID" >/dev/null

    # Desativa as anteriores. Versão antiga fica ATIVA e cobrando (US$ 0,06 por
    # versão/mês, 6 grátis) — rodar o script 3 vezes já triplicaria a conta sem
    # que nada mudasse. E versão velha ativa é credencial velha ainda válida.
    # ⚠️ Ordenar por `~name` era um BUG e ele só aparece na 10ª versão: `name` é
    # STRING, então "9" > "11" e o script destruía a versão que acabara de criar.
    # O Cloud Run referencia `:latest`, então a revisão nova subia apontando para
    # uma versão DESTROYED e nem iniciava — o tráfego ficava na revisão velha e o
    # deploy "passava" com exit 0. Ordenar por createTime não tem esse problema.
    local destruidas=0
    for v in $(gcloud secrets versions list "$id" --project "$PROJECT_ID" \
                 --filter='state:ENABLED' --format='value(name)' --sort-by='~createTime' \
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
  # --concurrency 10: o trabalho é I/O e o event loop aguentaria mais, mas cada
  # turno disputa o pool de dados (DB_POOL_MAX=5) e o do checkpointer
  # (DB_GRAPH_POOL_MAX=3). Com 80, o pool esgotava, o PoolTimeout virava retry e a
  # chamada ao LLM era paga de novo.
  #
  # --max-instances 4: o banco é o pooler do Supabase em modo SESSÃO, em que cada
  # conexão aberta aqui segura uma do servidor. 4 × (5+3) = 32 no pior caso; 10
  # instâncias dariam 80 e estourariam o teto do plano antes de faltar vazão
  # (40 turnos simultâneos é muito mais do que o produto tem).
  #
  # --min-instances 0 é o scale-to-zero pedido. Ele só é possível porque o
  # debounce mora no Cloud Tasks e não em timer de memória.
  local secrets=""
  for nome in "${SEGREDOS[@]}"; do
    local id="${nome//_/-}"; id="$(echo "$id" | tr '[:upper:]' '[:lower:]')""${SECRET_SUFFIX}"
    if ! gcloud secrets describe "$id" --project "$PROJECT_ID" &>/dev/null; then
      for obrig in "${SEGREDOS_OBRIGATORIOS[@]}"; do
        if [ "$nome" = "$obrig" ]; then
          err "segredo obrigatório ausente no Secret Manager: $id ($nome). Rode '$0 secrets' (com $nome no $ENV_FILE) e repita o deploy."
          exit 1
        fi
      done
      continue
    fi
    secrets+="${nome}=${id}:latest,"
  done
  secrets="${secrets%,}"

  # Ovo e galinha: o boot recusa subir sem WORKER_URL, e WORKER_URL é a URL do
  # próprio serviço — que só existiria depois de um deploy saudável. A saída é
  # que a URL do Cloud Run é DETERMINÍSTICA a partir do número do projeto, então
  # dá para passá-la já no primeiro deploy. Confirmada contra a real logo abaixo.
  # SUPABASE_URL não é segredo (é URL pública), mas SEM ela `current_user()`
  # devolve 401 em toda rota autenticada do app — dela sai o JWKS que valida o
  # JWT. Ficou de fora do primeiro deploy e a rota /internal/import-statement
  # respondia 401 achando que era permissão.
  local supabase_url wa_alert_template
  supabase_url="$(ler_env SUPABASE_URL)"
  [[ -n "$supabase_url" ]] || warn "SUPABASE_URL vazio em $ENV_FILE — /internal/* vai devolver 401"
  wa_alert_template="$(ler_env WA_ALERT_TEMPLATE)"
  wa_alert_template="${wa_alert_template:-personal_proops_alert}"

  local numero url_prevista
  numero="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  url_prevista="https://${SERVICE}-${numero}.${REGION}.run.app"
  printf '  URL prevista: %s\n' "$url_prevista"

  # Flags do agente (`agent/.env.example`) vêm do SHELL de quem roda o deploy, ex.:
  # `AGENTE_RLS=true ./scripts/setup-gcp.sh staging`. `--set-env-vars` SUBSTITUI todas as
  # variáveis: uma flag ligada à mão no console sumiria no deploy seguinte, em silêncio.
  local flags="" v
  # Langfuse: produção amostra 10% dos traces (CUSTOS-E-PRECOS §8); staging 100%.
  if [[ -z "${LANGFUSE_SAMPLE_RATE:-}" ]]; then
    if [[ "$SERVICE" == *staging* ]]; then LANGFUSE_SAMPLE_RATE=1.0; else LANGFUSE_SAMPLE_RATE=0.1; fi
  fi
  # Consentimento de IA: o staging exige (testa a tela nova); produção só liga quando o app com a
  # tela estiver na loja — o app em campo não consegue consentir, e ligar antes cala o assistente.
  if [[ -z "${AI_CONSENT_REQUIRED:-}" ]]; then
    if [[ "$SERVICE" == *staging* ]]; then AI_CONSENT_REQUIRED=true; else AI_CONSENT_REQUIRED=false; fi
  fi
  for v in LANGFUSE_SAMPLE_RATE AI_CONSENT_REQUIRED AGENTE_RLS AGENT_PROMPT_V2 IA_RACIOCINIO_GATE IA_SOMBRA_PARSE IA_SOMBRA_GATE \
           TURNO_LENTO_SECONDS CUSTO_DIARIO_ALERTA_USD WHATSAPP_TYPING_INDICATOR; do
    if [[ -n "${!v:-}" ]]; then flags+=",${v}=${!v}"; fi
  done
  if [[ -n "$flags" ]]; then printf '  flags: %s\n' "${flags#,}"; fi

  # O painel /admin NÃO mora aqui (13/10/2026): este serviço é público (a Meta não manda token) e
  # sobe com `SERVICO=agente`, em que toda rota do painel responde 404. O painel é `$0 painel`.
  # A anon key (pública) segue: o reset de senha e a configuração do app a usam.
  local anon_key
  anon_key="$(ler_env SUPABASE_ANON_KEY)"
  local base="GCP_PROJECT=${PROJECT_ID},GCP_LOCATION=${REGION},TASKS_QUEUE=${QUEUE},TASKS_SA_EMAIL=${SA_EMAIL},DEBOUNCE_BACKEND=cloud_tasks,DEBOUNCE_SECONDS=3,WORKER_URL=${url_prevista}/worker/process-thread,OIDC_AUDIENCE=${url_prevista},SUPABASE_URL=${supabase_url},WA_ALERT_TEMPLATE=${wa_alert_template}${flags}"
  # Compra de teste: staging liga BILLING_ALLOW_SANDBOX=true; produção deixa vazio e só lista o id da
  # conta da revisão da Apple em BILLING_SANDBOX_USER_IDS (docs/IN-APP-PURCHASE.md, Fase 5).
  local allow_sandbox sandbox_ids
  allow_sandbox="$(ler_env BILLING_ALLOW_SANDBOX)"
  sandbox_ids="$(ler_env BILLING_SANDBOX_USER_IDS)"
  local captura_teste
  captura_teste="$(ler_env CAPTURA_ACEITA_TESTE)"
  # Captura aceita notificação de teste só no staging; produção aceita vazio ou 'false' (o pydantic
  # também lê True/1/yes/on como verdadeiro) e sempre sobe com false.
  if [[ "$SERVICE" != *staging* ]]; then
    if [[ -n "$captura_teste" && "$captura_teste" != "false" ]]; then
      err "CAPTURA_ACEITA_TESTE tem que ser vazio ou 'false' em $ENV_FILE para produção (hoje: '$captura_teste')."
      exit 1
    fi
    captura_teste=false
  fi
  local env_vars="^|^${base//,/|}|SERVICO=agente|SUPABASE_ANON_KEY=${anon_key}|CAPTURA_ACEITA_TESTE=${captura_teste:-false}|BILLING_ALLOW_SANDBOX=${allow_sandbox}|BILLING_SANDBOX_USER_IDS=${sandbox_ids}"

  gcloud run deploy "$SERVICE" \
    --source agent \
    --project "$PROJECT_ID" --region "$REGION" \
    --service-account "$SA_EMAIL" \
    --allow-unauthenticated \
    --min-instances 0 \
    --max-instances 4 \
    --concurrency 10 \
    --cpu 1 --memory 1Gi \
    --timeout 300 \
    --quiet \
    --set-secrets "$secrets" \
    --set-env-vars "$env_vars"

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
# 6b. painel /admin — serviço próprio, atrás do IAP (13/10/2026)
# ---------------------------------------------------------------------------
# Três camadas, cada uma sozinha já barra um desconhecido:
#   1. IAP (Identity-Aware Proxy): o serviço não é público. Sem login Google de um e-mail da política
#      do IAP, a requisição nem chega ao container — nem a página de login do painel aparece.
#   2. O container confere a assinatura do IAP (`x-goog-iap-jwt-assertion`, `aud` deste serviço) e o
#      e-mail contra ADMIN_IAP_EMAILS: IAP desligado por engano não abre o painel.
#   3. Login do Supabase com TOTP (aal2) e o id em ADMIN_USER_IDS, como antes.
# A imagem é a MESMA do agente (o que estiver servindo agora): rode depois de `deploy`/`staging`.
# Domínio próprio: a região não tem domain mapping; o caminho seria um load balancer (custo fixo
# mensal), que não convive com o IAP direto. Fica na URL do run.app, que o IAP já protege.
# Cliente OAuth próprio do IAP, na REGIÃO (todo serviço do Cloud Run com IAP em $REGION herda: os dois
# painéis). Uma vez só: o segredo não volta do Google (só o hash), e o JSON baixado pode ser apagado depois.
# Lê IAP_OAUTH_CLIENT_ID / IAP_OAUTH_CLIENT_SECRET do shell (docs/PAINEL-ADMIN.md); nunca de arquivo do repo.
iap_oauth() {
  [[ -n "${IAP_OAUTH_CLIENT_ID:-}" && -n "${IAP_OAUTH_CLIENT_SECRET:-}" ]] \
    || { err "IAP_OAUTH_CLIENT_ID e IAP_OAUTH_CLIENT_SECRET no ambiente do shell (docs/PAINEL-ADMIN.md)"; exit 1; }
  gcloud services enable iap.googleapis.com --project "$PROJECT_ID" >/dev/null
  local cfg; cfg="$(mktemp)"
  chmod 600 "$cfg"
  # o arquivo tem o segredo: sai do disco mesmo se o gcloud falhar (set -e)
  trap 'rm -f "$cfg"' EXIT
  printf 'accessSettings:\n  oauthSettings:\n    clientId: %s\n    clientSecret: %s\n' \
    "$IAP_OAUTH_CLIENT_ID" "$IAP_OAUTH_CLIENT_SECRET" > "$cfg"
  gcloud iap settings set "$cfg" --resource-type=cloud-run --region="$REGION" \
    --project "$PROJECT_ID" --quiet >/dev/null
  rm -f "$cfg"; trap - EXIT
  ok "cliente OAuth próprio aplicado ao IAP de todo o Cloud Run em $REGION (os dois painéis)"
}

painel() {
  log "Painel: $PAINEL_SERVICE (IAP)"
  local numero imagem anon supabase_url admin_ids emails mfa audiencia
  numero="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  imagem="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT_ID" \
    --format='value(spec.template.spec.containers[0].image)' 2>/dev/null || true)"
  [[ -n "$imagem" ]] || { err "serviço $SERVICE não existe: faça o deploy do agente antes"; exit 1; }
  supabase_url="$(ler_env SUPABASE_URL)"
  anon="$(ler_env SUPABASE_ANON_KEY)"
  admin_ids="$(ler_env ADMIN_USER_IDS)"
  # Sem espaço e em minúsculas, como o container compara (`admin_iap_email_set`) e como o IAM devolve:
  # "a@x.com, b@y.com" faria a sincronização abaixo tirar b@y.com logo depois de adicioná-lo.
  emails="$(ler_env ADMIN_IAP_EMAILS | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  mfa="$(ler_env ADMIN_REQUIRE_MFA)"
  local faltando=()
  [[ "$supabase_url" == https://* ]] || faltando+=(SUPABASE_URL)
  [[ -n "$anon" ]] || faltando+=(SUPABASE_ANON_KEY)
  [[ -n "$admin_ids" ]] || faltando+=(ADMIN_USER_IDS)
  [[ -n "$emails" ]] || faltando+=(ADMIN_IAP_EMAILS)
  if [[ ${#faltando[@]} -gt 0 ]]; then
    err "faltando em $ENV_FILE: ${faltando[*]}"; exit 1
  fi
  # Produção NUNCA sobe o painel sem TOTP.
  if [[ "$PAINEL_SERVICE" != *staging* && "$mfa" != "true" ]]; then
    err "ADMIN_REQUIRE_MFA tem que ser 'true' em $ENV_FILE para produção (hoje: '${mfa:-vazio}')."
    exit 1
  fi
  audiencia="/projects/${numero}/locations/${REGION}/services/${PAINEL_SERVICE}"

  gcloud services enable iap.googleapis.com cloudresourcemanager.googleapis.com --project "$PROJECT_ID" >/dev/null
  local iap_sa="service-${numero}@gcp-sa-iap.iam.gserviceaccount.com"
  gcloud beta services identity create --service=iap.googleapis.com --project "$PROJECT_ID" >/dev/null 2>&1 || true

  local nome_sa="${PAINEL_SA_EMAIL%%@*}"
  gcloud iam service-accounts describe "$PAINEL_SA_EMAIL" --project "$PROJECT_ID" &>/dev/null \
    || gcloud iam service-accounts create "$nome_sa" --display-name="Painel do ProOps${SECRET_SUFFIX}" \
         --project "$PROJECT_ID" >/dev/null
  local segredo; segredo="$(id_do_segredo DATABASE_URL)"
  com_propagacao gcloud secrets add-iam-policy-binding "$segredo" --project "$PROJECT_ID" \
    --member="serviceAccount:${PAINEL_SA_EMAIL}" --role=roles/secretmanager.secretAccessor \
    --condition=None --quiet
  ok "conta $PAINEL_SA_EMAIL: lê só $segredo"

  # `^|^`: ids e e-mails são listas separadas por vírgula (ver `gcloud topic escaping`).
  local env_vars="^|^SERVICO=admin|SUPABASE_URL=${supabase_url}|SUPABASE_ANON_KEY=${anon}|ADMIN_USER_IDS=${admin_ids}|ADMIN_REQUIRE_MFA=${mfa:-false}|ADMIN_EXIGE_IAP=true|ADMIN_IAP_AUDIENCE=${audiencia}|ADMIN_IAP_EMAILS=${emails}|DB_POOL_MAX=2|DB_GRAPH_POOL_MAX=1"
  gcloud run deploy "$PAINEL_SERVICE" \
    --image "$imagem" \
    --project "$PROJECT_ID" --region "$REGION" \
    --service-account "$PAINEL_SA_EMAIL" \
    --no-allow-unauthenticated --iap --ingress all \
    --min-instances 0 --max-instances 2 --concurrency 20 \
    --cpu 1 --memory 512Mi --timeout 60 \
    --set-secrets "DATABASE_URL=${segredo}:latest" \
    --set-env-vars "$env_vars" \
    --quiet

  # O IAP chama o serviço com a identidade do agente de serviço dele.
  gcloud run services add-iam-policy-binding "$PAINEL_SERVICE" --region "$REGION" --project "$PROJECT_ID" \
    --member="serviceAccount:${iap_sa}" --role=roles/run.invoker --quiet >/dev/null

  # Quem passa pelo IAP: EXATAMENTE os e-mails de ADMIN_IAP_EMAILS (adiciona os novos, tira os velhos).
  local atuais e
  if ! atuais="$(gcloud iap web get-iam-policy --resource-type=cloud-run --service="$PAINEL_SERVICE" \
      --region="$REGION" --project "$PROJECT_ID" --flatten='bindings[].members' \
      --filter='bindings.role=roles/iap.httpsResourceAccessor' --format='value(bindings.members)')"; then
    err "não consegui ler a política do IAP: nada foi sincronizado"; exit 1
  fi
  atuais="$(echo "$atuais" | tr '[:upper:]' '[:lower:]')"
  for e in ${emails//,/ }; do
    gcloud iap web add-iam-policy-binding --resource-type=cloud-run --service="$PAINEL_SERVICE" \
      --region="$REGION" --project "$PROJECT_ID" --member="user:${e}" \
      --role=roles/iap.httpsResourceAccessor --condition=None --quiet >/dev/null
  done
  for e in $atuais; do
    if [[ ",${emails}," != *",${e#user:},"* ]]; then
      gcloud iap web remove-iam-policy-binding --resource-type=cloud-run --service="$PAINEL_SERVICE" \
        --region="$REGION" --project "$PROJECT_ID" --member="$e" \
        --role=roles/iap.httpsResourceAccessor --condition=None --quiet >/dev/null
      ok "retirado do IAP: $e"
    fi
  done
  ok "IAP: entra só ${emails}"

  # Conta Google FORA da organização (Gmail) exige um cliente OAuth próprio no IAP (`iap_oauth`). Ele vale
  # para a REGIÃO inteira, então este painel o herda se já foi aplicado; com as variáveis no shell, aplica.
  if [[ -n "${IAP_OAUTH_CLIENT_ID:-}" && -n "${IAP_OAUTH_CLIENT_SECRET:-}" ]]; then iap_oauth; fi

  local url
  url="$(gcloud run services describe "$PAINEL_SERVICE" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')"
  printf '\n  Painel: %s/admin\n\n' "$url"
}

# O painel roda a MESMA versão do agente. Sem isto ele ficaria preso numa imagem antiga, que a retenção
# do Artifact Registry (10 versões) acabaria apagando — e o próximo cold start do painel não subiria.
acompanhar_painel() {
  gcloud run services describe "$PAINEL_SERVICE" --region "$REGION" --project "$PROJECT_ID" &>/dev/null || return 0
  local imagem
  imagem="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT_ID" \
    --format='value(spec.template.spec.containers[0].image)')"
  gcloud run services update "$PAINEL_SERVICE" --image "$imagem" --region "$REGION" \
    --project "$PROJECT_ID" --quiet >/dev/null
  ok "painel $PAINEL_SERVICE na mesma imagem do agente"
}

# ---------------------------------------------------------------------------
# 7. crons
# ---------------------------------------------------------------------------
# Retenção do Artifact Registry: cada `deploy --source` empurra uma imagem para
# `cloud-run-source-deploy` e nada apaga (88 em 15/09, 169 em 07/10/2026, custo subindo a cada
# deploy). Mantém as 10 versões mais recentes e apaga o resto. Idempotente (set substitui a
# política). O repositório é COMPARTILHADO por produção e staging (mesmo projeto).
# `RETENCAO_DRY_RUN=1` só simula: o Artifact Registry registra o que apagaria sem apagar.
retencao_imagens() {
  local repo="${AR_REPO:-cloud-run-source-deploy}" politica
  politica="$(mktemp)"
  cat > "$politica" <<'JSON'
[
  {"name": "manter-10-recentes", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 10}},
  {"name": "apagar-o-resto", "action": {"type": "Delete"}, "condition": {"tagState": "any"}}
]
JSON
  if gcloud artifacts repositories set-cleanup-policies "$repo" \
       --project "$PROJECT_ID" --location "$REGION" --policy "$politica" \
       ${RETENCAO_DRY_RUN:+--dry-run} --quiet; then
    ok "retenção de imagens em $repo: últimas 10${RETENCAO_DRY_RUN:+ (SIMULAÇÃO, nada é apagado)}"
  else
    warn "não apliquei a retenção em $repo (repositório ausente ou sem permissão)"
  fi
  rm -f "$politica"
}

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
  # ⚠️ **Pausa só na CRIAÇÃO.** Isto era incondicional, e por isso TODO deploy de produção
  # desligava os três crons em silêncio — o script imprimia "PAUSADO até o corte" e ninguém
  # relacionava aquela linha com o efeito. Em 09/09/2026 custou caro: a recorrência do salário
  # do dono do produto não materializava havia semanas, e o diagnóstico ("o finance-scheduler
  # está pausado") foi desfeito pelo deploy seguinte, meia hora depois de ser corrigido.
  #
  # A premissa de "nascer pausado" continua válida para um job NOVO (o fluxo Deno podia estar
  # entregando o mesmo lembrete, e lembrete não tem dedupe). Ela não vale para um job que já
  # existe: quem o ligou fez isso de propósito, e um deploy não é lugar de reverter operação.
  if [[ "$cmd" == create ]]; then
    gcloud scheduler jobs pause "$nome" --location "$REGION" --project "$PROJECT_ID" \
      --quiet >/dev/null 2>&1 || true
    printf '  ✓ %s (%s) — criado PAUSADO (ligue no corte)\n' "$nome" "$agenda"
    return
  fi
  local estado
  estado=$(gcloud scheduler jobs describe "$nome" --location "$REGION" --project "$PROJECT_ID" \
    --format='value(state)' 2>/dev/null || echo '?')
  printf '  ✓ %s (%s) — %s (estado preservado)\n' "$nome" "$agenda" "$estado"
}

# ---------------------------------------------------------------------------
# 7b. backup diário do banco (Supabase Free não guarda backup)
# ---------------------------------------------------------------------------
# Cloud Run Job (imagem oficial postgres:17 = versão do servidor, sem build) roda
# scripts/backup-banco.sh, que faz pg_dump -Fc e grava no bucket montado (gcsfuse). O Scheduler o
# dispara todo dia. O segredo é o MESMO database-url do agente (com o sufixo de staging, se for o caso).
# Idempotente: bucket, política, job e agendamento são create-or-update. Detalhes: docs/BACKUP.md.
criar_backup() {
  log "Backup diário do banco (${SECRET_SUFFIX:-produção})"
  local bucket="${PROJECT_ID}-backups${SECRET_SUFFIX}" job="backup-banco${SECRET_SUFFIX}"
  local nome=producao; [[ -n "$SECRET_SUFFIX" ]] && nome=staging
  local segredo="database-url${SECRET_SUFFIX}"
  gcloud secrets describe "$segredo" --project "$PROJECT_ID" &>/dev/null \
    || { err "segredo $segredo ausente: rode '$0 secrets' (ou staging) antes"; exit 1; }
  gcloud services enable run.googleapis.com cloudscheduler.googleapis.com --project "$PROJECT_ID" >/dev/null

  # Privado (acesso público bloqueado), acesso uniforme. diario/ vive 30 dias, semanal/ 90.
  gcloud storage buckets describe "gs://$bucket" --project "$PROJECT_ID" &>/dev/null \
    || gcloud storage buckets create "gs://$bucket" --project "$PROJECT_ID" --location "$REGION" \
         --uniform-bucket-level-access --public-access-prevention >/dev/null
  local ciclo; ciclo="$(mktemp)"
  cat > "$ciclo" <<'JSON'
{"rule": [
  {"action": {"type": "Delete"}, "condition": {"age": 30, "matchesPrefix": ["diario/"]}},
  {"action": {"type": "Delete"}, "condition": {"age": 90, "matchesPrefix": ["semanal/"]}}
]}
JSON
  gcloud storage buckets update "gs://$bucket" --lifecycle-file "$ciclo" >/dev/null
  rm -f "$ciclo"
  gcloud storage buckets add-iam-policy-binding "gs://$bucket" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/storage.objectUser >/dev/null
  ok "bucket gs://$bucket (privado, diario/ 30 dias, semanal/ 90 dias)"

  # A conta do ambiente lê o segredo ANTES do job existir (a revisão não sobe sem ele).
  gcloud secrets add-iam-policy-binding "$segredo" --project "$PROJECT_ID" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/secretmanager.secretAccessor \
    --condition=None --quiet >/dev/null
  # `^@^`: o gcloud separa --args por vírgula; o script tem vírgulas, então o delimitador vira @.
  gcloud run jobs deploy "$job" --project "$PROJECT_ID" --region "$REGION" \
    --image docker.io/library/postgres:17 \
    --service-account "$SA_EMAIL" \
    --set-secrets "DATABASE_URL=${segredo}:latest" \
    --set-env-vars "BACKUP_DIR=/backup,NOME=${nome}" \
    --add-volume "name=bk,type=cloud-storage,bucket=${bucket}" \
    --add-volume-mount "volume=bk,mount-path=/backup" \
    --cpu 1 --memory 2Gi --task-timeout 20m --max-retries 1 \
    --command bash --args "^@^-c@$(cat "${BACKUP_SCRIPT:-$(dirname "$0")/backup-banco.sh}")" --quiet >/dev/null
  ok "job $job"
  # O Scheduler dispara o job com esta conta: invocar SÓ este job (não o projeto inteiro).
  gcloud run jobs add-iam-policy-binding "$job" --project "$PROJECT_ID" --region "$REGION" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/run.invoker --quiet >/dev/null

  local cmd=create
  gcloud scheduler jobs describe "$job" --location "$REGION" --project "$PROJECT_ID" &>/dev/null && cmd=update
  gcloud scheduler jobs "$cmd" http "$job" --location "$REGION" --project "$PROJECT_ID" \
    --schedule "30 3 * * *" --time-zone "America/Sao_Paulo" \
    --uri "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${job}:run" \
    --http-method POST --oauth-service-account-email "$SA_EMAIL" --quiet >/dev/null
  ok "agendado todo dia 03:30 (America/Sao_Paulo)"
}

# ---------------------------------------------------------------------------
# 8. alertas e orçamento
# ---------------------------------------------------------------------------
# Métrica baseada em log: cria ou atualiza (idempotente).
criar_metrica() {
  local nome="$1" filtro="$2" desc="$3" cmd=create
  gcloud logging metrics describe "$nome" --project "$PROJECT_ID" &>/dev/null && cmd=update
  gcloud logging metrics "$cmd" "$nome" --project "$PROJECT_ID" \
    --description "$desc" --log-filter "$filtro" --quiet >/dev/null
  printf '  ✓ métrica %s\n' "$nome"
}

# Política: dispara quando a métrica passa de zero numa janela de 5 min. Não recria se o
# nome de exibição já existe (descrever por filtro, porque o ID da política é gerado).
criar_politica() {
  local metrica="$1" titulo="$2" canal="$3"
  if gcloud alpha monitoring policies list --project "$PROJECT_ID" \
       --filter "displayName=\"$titulo\"" --format='value(name)' 2>/dev/null | grep -q .; then
    skip "política '$titulo' já existe"
    return
  fi
  local arq
  arq="$(mktemp)"
  cat >"$arq" <<JSON
{
  "displayName": "$titulo",
  "combiner": "OR",
  "notificationChannels": ["$canal"],
  "conditions": [{
    "displayName": "$titulo",
    "conditionThreshold": {
      "filter": "metric.type=\"logging.googleapis.com/user/$metrica\" AND resource.type=\"cloud_run_revision\"",
      "comparison": "COMPARISON_GT",
      "thresholdValue": 0,
      "duration": "0s",
      "aggregations": [{"alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_SUM"}]
    }
  }]
}
JSON
  gcloud alpha monitoring policies create --project "$PROJECT_ID" \
    --policy-from-file "$arq" --quiet >/dev/null
  rm -f "$arq"
  ok "política '$titulo'"
}

criar_alertas() {
  log "Alertas e orçamento ($SERVICE)"
  # Métricas/políticas e orçamento usam APIs que o `ativar_apis` não liga (idempotente, sem custo).
  gcloud services enable monitoring.googleapis.com billingbudgets.googleapis.com \
    --project "$PROJECT_ID" >/dev/null
  local base='resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE"'"'
  criar_metrica "${SERVICE}-fila-parada" \
    "$base AND jsonPayload.alerta=\"fila_parada\"" "Mensagens pending há mais de 5 min"
  criar_metrica "${SERVICE}-falhas-definitivas" \
    "$base AND jsonPayload.alerta=\"falhas_definitivas\"" "Mensagens failed na última hora"
  criar_metrica "${SERVICE}-turno-lento" \
    "$base AND jsonPayload.alerta=\"turno_lento\"" "Turnos do WhatsApp acima de TURNO_LENTO_SECONDS"
  criar_metrica "${SERVICE}-custo-diario" \
    "$base AND jsonPayload.alerta=\"custo_diario\"" "Custo de IA em 24 h acima de CUSTO_DIARIO_ALERTA_USD"
  criar_metrica "${SERVICE}-erros-5xx" \
    'resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE"'" AND httpRequest.status>=500' \
    "Respostas 5xx do serviço"

  # Sem e-mail não há canal, e não se inventa um: o passo é pulado.
  if [[ -z "${ALERT_EMAIL:-}" ]]; then
    warn "ALERT_EMAIL ausente — métricas criadas, políticas de alerta PULADAS"
  else
    local canal
    canal="$(gcloud alpha monitoring channels list --project "$PROJECT_ID" \
      --filter "type=\"email\" AND labels.email_address=\"$ALERT_EMAIL\"" --format='value(name)' | head -1)"
    if [[ -z "$canal" ]]; then
      canal="$(gcloud alpha monitoring channels create --project "$PROJECT_ID" \
        --display-name "ProOps alertas" --type email \
        --channel-labels "email_address=$ALERT_EMAIL" --format='value(name)')"
    fi
    criar_politica "${SERVICE}-fila-parada"       "ProOps ${SERVICE}: fila parada"       "$canal"
    criar_politica "${SERVICE}-falhas-definitivas" "ProOps ${SERVICE}: falhas definitivas" "$canal"
    criar_politica "${SERVICE}-erros-5xx"         "ProOps ${SERVICE}: erros 5xx"         "$canal"
    criar_politica "${SERVICE}-turno-lento"       "ProOps ${SERVICE}: turno lento"       "$canal"
    criar_politica "${SERVICE}-custo-diario"      "ProOps ${SERVICE}: custo de IA"       "$canal"
  fi

  # Orçamento de faturamento: avisa a 50%, 90% e 100% de BUDGET_AMOUNT. Sem a conta ou o valor, pula.
  # O valor vai na MOEDA DA CONTA (BRL aqui): outra moeda volta INVALID_ARGUMENT sem detalhe.
  if [[ -z "${BILLING_ACCOUNT:-}" || -z "${BUDGET_AMOUNT:-}" ]]; then
    warn "BILLING_ACCOUNT/BUDGET_AMOUNT ausentes — orçamento de faturamento PULADO"
  elif gcloud billing budgets list --billing-account "$BILLING_ACCOUNT" \
         --filter "displayName=\"ProOps $PROJECT_ID\"" --format='value(name)' 2>/dev/null | grep -q .; then
    skip "orçamento 'ProOps $PROJECT_ID' já existe"
  else
    local moeda
    moeda="$(gcloud billing accounts describe "$BILLING_ACCOUNT" --format='value(currencyCode)')"
    gcloud billing budgets create --billing-account "$BILLING_ACCOUNT" \
      --display-name "ProOps $PROJECT_ID" \
      --filter-projects "projects/$PROJECT_ID" \
      --budget-amount "${BUDGET_AMOUNT}${moeda}" \
      --threshold-rule percent=0.5 --threshold-rule percent=0.9 --threshold-rule percent=1.0 \
      --quiet >/dev/null
    ok "orçamento de ${BUDGET_AMOUNT} ${moeda} (50/90/100%)"
  fi
}

# ---------------------------------------------------------------------------
main() {
  case "${1:-tudo}" in
    deploy)  criar_projeto; criar_sa; deploy; restringir_sa; acompanhar_painel; criar_crons; retencao_imagens ;;
    retencao) criar_projeto; retencao_imagens ;;
    # Staging: mesmo projeto GCP, tudo o mais separado. Sem `criar_crons` DE
    # PROPÓSITO — os jobs do Scheduler têm nome fixo (reminders, finance-scheduler,
    # alerts) e `criar_cron` faz `update` quando já existem: rodar staging
    # repontaria os crons de PRODUÇÃO para a URL de staging, em silêncio.
    staging) criar_projeto; gravar_segredos; criar_sa; criar_fila; deploy; restringir_sa; acompanhar_painel ;;
    painel|painel-staging) criar_projeto; painel ;;
    iap-oauth) criar_projeto; iap_oauth ;;
    preflight) preflight ;;
    alertas) criar_projeto; criar_alertas ;;
    backup|backup-staging) criar_projeto; criar_sa; criar_backup ;;
    build-iam) criar_projeto; permitir_build ;;
    sa|sa-staging) criar_projeto; criar_sa; restringir_sa ;;
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
      restringir_sa
      acompanhar_painel
      criar_crons
      retencao_imagens
      criar_backup
      log "Pronto. Aponte o webhook da Meta para a URL acima."
      ;;
    *) echo "uso: $0 [tudo|deploy|staging|painel|painel-staging|iap-oauth|secrets|preflight|build-iam|sa|sa-staging|alertas|retencao|backup|backup-staging]" >&2; exit 1 ;;
  esac
}
# ── Trava de produção ──────────────────────────────────────────────────────
# Mesma convenção do hook do Supabase (`scripts/supabase-target.sh`): produção é
# pedido explícito, e a saída de emergência é a MESMA variável, para não existir
# uma segunda coisa para lembrar. Sem isto, `./scripts/setup-gcp.sh` sozinho
# (subcomando default `tudo`) faz deploy em produção sem perguntar nada.
prod_gate() {
  local cmd="${1:-tudo}"
  # Quem decide o ALVO é o subcomando, não o $ENV_FILE: `SERVICE` e
  # `SECRET_SUFFIX` saem daqui, e só o `staging` os troca. Uma versão anterior
  # desta trava perguntava só quando o arquivo era `.env.production`, e então
  # `ENV_FILE=agent/.env ./setup-gcp.sh deploy` passava batido — gravando valor
  # de STAGING nos segredos de PRODUÇÃO, sem prompt. Gate por subcomando é mais
  # estrito e é uma linha a menos.
  case "$cmd" in
    tudo|deploy|secrets|sa|build-iam|alertas|retencao|backup|painel|iap-oauth) ;;   # escrevem em produção
    *) return 0 ;;                         # staging, preflight: passam direto
  esac

  if [[ -n "${PROOPS_PROD_OK:-}" ]]; then
    warn "PROOPS_PROD_OK=1 — seguindo em PRODUÇÃO ($SERVICE)"
    return 0
  fi
  echo
  echo "  ⚠️  ALVO: PRODUÇÃO — serviço '$SERVICE', segredos de $ENV_FILE"
  echo "     (staging é: $0 staging)"
  if [[ ! -t 0 ]]; then
    echo "  ✗ sem terminal para confirmar. Use PROOPS_PROD_OK=1 se é de propósito." >&2
    exit 1
  fi
  read -r -p "  Digite PRODUCAO para continuar: " r
  [[ "$r" == "PRODUCAO" ]] || { echo "  abortado."; exit 1; }
}

[[ -f "$ENV_FILE" ]] || { echo "✗ $ENV_FILE não existe (staging = $0 staging)" >&2; exit 1; }
prod_gate "${1:-tudo}"
main "$@"
