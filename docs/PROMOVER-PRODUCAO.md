# Promover produção — runbook

> Escrito em 04/09/2026, com staging já no ar e provado. **Nada aqui foi executado.**
> Produção continua na `0048`, na revisão `agente-00017-m8j`.
>
> Este documento existe porque a sequência que a `0055` documenta **não funciona** —
> ver §1. Não siga o cabeçalho da migration; siga isto.

---

## 1. O defeito da ordem documentada

A `0055` diz, no próprio cabeçalho:

```
0055  →  deploy do agente  →  0056
```

**Isso não fecha.** A `0056` é quem renomeia `executed_actions.wa_message_id` para
`source_message_id` (linha 69). O agente **novo** grava `source_message_id`
(`agent/app/db.py`, `reserve_execution`). Então:

| momento | agente antigo | agente novo |
|---|---|---|
| depois da `0055`, antes do deploy | ✅ funciona | — |
| depois do deploy, antes da `0056` | — | ❌ **coluna não existe** |
| depois da `0056` | ❌ coluna sumiu | ✅ funciona |

Não existe estado do schema em que os dois funcionem. A janela expand/contract é real
para `pending_actions`/`draft_actions` (lá a `0055` de fato acrescenta `session_id`
anulável), mas **não** para o rename de `executed_actions` — para um rename, expand teria
que ADICIONAR a coluna nova ao lado da antiga, e ela não faz isso.

### A correção: pausar a fila em vez de procurar uma janela que não existe

Não há como manter os dois vivos, então a resposta certa é **não ter nenhum worker rodando**
durante a troca. Pausando `whatsapp-debounce`, nenhuma task é entregue; as mensagens ficam
em `messages_queue` como `pending` e são processadas depois que a fila voltar.

Por que isso importa: sem pausar, uma mensagem que chegasse no meio viraria `mark_retry`, e
**na 3ª tentativa fica `failed` para sempre**. Com o retry do Cloud Tasks, três tentativas
queimam em minutos — não é atraso, é mensagem perdida. É o risco que a própria `0055`
descreve, com o precedente `0043` → `0044`.

Os três crons (`reminders`, `finance-scheduler`, `alerts`) **já estão PAUSED** em produção
hoje, então o sweep de 1 minuto não vai atrapalhar. Confira mesmo assim no passo 2 — se
alguém tiver religado, pause de novo.

---

## 2. Antes de começar

```bash
export CLOUDSDK_CORE_ACCOUNT=gestao.proops@gmail.com   # a conta ativa costuma ser de OUTRA empresa
gcloud config list account
```

⚠️ **A conta ativa do `gcloud` nesta máquina não é a do projeto** e volta sozinha para a
outra. Sem esta variável, todo comando abaixo devolve `PERMISSION_DENIED` falando em criar
projeto — que é um erro de conta, não de permissão.

```bash
# 1. Estado de partida (anote os números; o rollback depende deles)
gcloud run services describe agente --project personal-proops-agent \
  --region southamerica-east1 --format='value(status.latestReadyRevisionName)'
gcloud tasks queues describe whatsapp-debounce --location southamerica-east1 \
  --project personal-proops-agent --format='value(state)'
gcloud scheduler jobs list --project personal-proops-agent \
  --location southamerica-east1 --format='value(name.basename(),state)'

# 2. Head REAL de produção — sem relinkar o CLI do Supabase
psql "$(grep '^DATABASE_URL=' agent/.env.production | cut -d= -f2- | sed 's/[[:space:]]*#.*$//')" \
  -c "select version from supabase_migrations.schema_migrations order by 1 desc limit 3"
```

**Se o head não for `0048`, PARE** e releia este documento — a lista de migrations abaixo
muda.

### Backup

O plano gratuito do Supabase faz backup diário automático. **Antes de aplicar, tire um
snapshot manual pelo dashboard** (Database → Backups). Migration não tem `down`: o rollback
de schema é restore, e restore custa o que foi escrito depois do ponto.

---

## 3. A sequência

```bash
export CLOUDSDK_CORE_ACCOUNT=gestao.proops@gmail.com
cd ~/Documents/Empresas/ProOps/DEV/Personal-ProOps-app
```

**Passo 1 — parar o processamento.**

```bash
gcloud tasks queues pause whatsapp-debounce \
  --location southamerica-east1 --project personal-proops-agent
# os crons já estão PAUSED; se algum estiver ENABLED:
#   gcloud scheduler jobs pause <nome> --location southamerica-east1 --project personal-proops-agent
```

A partir daqui o webhook continua respondendo 200 e **gravando** em `messages_queue` — nada
é recusado nem perdido, só não é processado.

**Passo 2 — apontar o CLI do Supabase para produção.**

```bash
npx supabase link --project-ref kwriuifcwyvdrxtspjiz
scripts/supabase-target.sh          # tem que dizer PRODUÇÃO nas duas linhas
SUPABASE_TELEMETRY_DISABLED=1 npx supabase db push --dry-run
```

Esperado: `0049` a `0056`, oito migrations, nessa ordem. **Se aparecer qualquer outra, pare.**

**Passo 3 — aplicar.**

```bash
PROOPS_PROD_OK=1 SUPABASE_TELEMETRY_DISABLED=1 npx supabase db push
```

O hook `PreToolUse` bloqueia escrita em produção sem `PROOPS_PROD_OK=1`. É de propósito:
esta é a linha em que você afirma que é produção mesmo.

Aplique as **oito de uma vez**. Não tente parar na `0055`: o único ganho seria manter o
agente antigo vivo, e o passo seguinte o substitui em minutos com a fila parada.

**Passo 4 — deploy do agente.**

```bash
./scripts/setup-gcp.sh deploy     # vai pedir: digite PRODUCAO
```

⚠️ Ele lê `agent/.env.production`. Esse arquivo foi **reconciliado em 04/09/2026** com o que
estava de fato no Cloud Run — ele dizia `TASKS_QUEUE=wa-debounce`, fila que não existe (a
real é `whatsapp-debounce`), e tinha `GCP_PROJECT`, `TASKS_SA_EMAIL`, `WORKER_URL` e
`OIDC_AUDIENCE` vazios. Se alguém restaurar uma cópia antiga desse arquivo, o deploy escreve
o nome de fila errado no container e **o debounce para de agendar para toda mensagem, sem
erro visível**.

**Passo 5 — provar antes de religar.**

```bash
U=https://agente-wwm7xruoyq-rj.a.run.app
curl -s -o /dev/null -w '%{http_code}\n' $U/internal/chat/conversations   # 401, NUNCA 404
```

`404` quer dizer que a revisão nova não subiu — volte ao passo 4 antes de religar a fila.

**Passo 6 — religar.**

```bash
gcloud tasks queues resume whatsapp-debounce \
  --location southamerica-east1 --project personal-proops-agent
```

As mensagens que chegaram durante a janela são pegas pelo sweep. **O sweep vive dentro de
`/cron/reminders`, que está PAUSED** — então religue os crons também, ou nada sai da fila:

```bash
for j in reminders finance-scheduler alerts; do
  gcloud scheduler jobs resume $j --location southamerica-east1 --project personal-proops-agent
done
```

**Passo 7 — ligar a aba Agente do app de produção.**

```bash
npx eas-cli env:create --environment production --name EXPO_PUBLIC_AGENT_URL \
  --value https://agente-wwm7xruoyq-rj.a.run.app --visibility plaintext \
  --scope project --non-interactive --force
npx eas-cli build --platform android --profile distribution --no-wait
```

Só depois do passo 5 passar. Enquanto a variável não existir, a aba diz "não configurado" —
que é honesto; com ela apontando para a revisão velha, seriam 404 na cara do usuário.

**Passo 8 — voltar o CLI para o staging.** Fácil de esquecer, e é como a próxima tarefa
escreve no lugar errado:

```bash
npx supabase link --project-ref utkqoiigimqzeenxkxdl
scripts/supabase-target.sh
```

---

## 4. Se der errado

| sintoma | causa provável | o que fazer |
|---|---|---|
| `db push` para no meio | uma migration falhou | fila continua pausada. Leia o erro, corrija, rode de novo. Migrations são idempotentes onde dá. |
| `/internal/chat/*` devolve 404 | revisão nova não subiu | `gcloud run services update-traffic agente --to-revisions=agente-00017-m8j=100` e **não** aplique a `0056` de novo — o agente antigo já está quebrado pelo rename; o caminho é fazer o deploy funcionar. |
| WhatsApp mudo depois de religar | `TASKS_QUEUE` errado no container | `gcloud run services describe agente ... | grep TASKS_QUEUE` → tem que ser `whatsapp-debounce`. |
| mensagens presas em `pending` | crons ainda pausados | o sweep mora em `/cron/reminders`. Passo 6. |
| precisa desfazer o schema | não existe `down` | restore do snapshot do passo 2. É por isso que o snapshot é obrigatório. |

**Rollback de código é barato, rollback de schema não é.** A revisão antiga volta em um
comando; a `0056` não. Se a dúvida for sobre o schema, pare antes do passo 3.

---

## 5. O que este runbook NÃO cobre

- **Testar produção de verdade.** O WhatsApp de produção usa as mesmas credenciais da Meta
  que o staging (`agent/.env.production` e `agent/.env` compartilham `WHATSAPP_TOKEN` e
  `WHATSAPP_PHONE_NUMBER_ID`, de propósito — ver `AGENTE-CUTOVER.md`). Com um número só, os
  dois ambientes disputam o mesmo webhook, e quem decide para onde vai é
  `agent_routing.use_python_agent`. **Enquanto não houver um segundo número, produção e
  staging não podem receber WhatsApp ao mesmo tempo.**
- **O corte Strangler.** `agent_routing` continua sendo o interruptor; promover o schema não
  liga ninguém.
- **`WA_ALERT_TEMPLATE`** (Fase 8) continua sem configurar.
