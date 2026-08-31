# Agente Python — staging e corte para produção

> Estado em 31/08/2026. O agente está **no ar e inerte**: o Cloud Run responde, o
> banco tem as tabelas, e nenhum telefone está roteado para ele. Este documento
> é o que falta para ele receber a primeira mensagem de verdade.
>
> Contexto arquitetural em `CLAUDE.md` e `.claude/rules/agent.md`.
> Plano completo da migração em `~/.claude/plans/voc-um-engenheiro-glittery-pike.md`.

## Onde o código está (leia antes de qualquer coisa)

**Tudo vive na branch `gabriel/agente-python`, já enviada para o remoto e NÃO
mesclada.** Na `main` o diretório `agent/` não existe — um `git checkout main`
remove os 64 arquivos do serviço, e eles voltam ao trocar de volta.

```bash
git checkout gabriel/agente-python   # obrigatório para mexer no agente
cd agent && .venv/bin/python -m pytest -q   # 64 verdes
```

O `.venv` e o `.env` não são versionados e sobrevivem à troca de branch. As
regras que ignoram bytecode do Python estão no `.gitignore` **da branch** e
também em `.git/info/exclude` (local) — sem o segundo, todo `.pyc` aparecia como
arquivo novo ao voltar para a `main`.

**O contexto do ERP não está aqui.** Aquela migração (transferência de posse dos
projetos Firebase) tem runbook próprio no repositório do ERP, em
`docs/gcp-ownership-runbook.md`. São produtos diferentes; não misture.

## O que já está de pé

| | |
|---|---|
| Supabase | migrations `0040`/`0041` aplicadas · 5 tabelas com RLS sem policies · schema `langgraph` isolado de `anon`/`authenticated` |
| GCP | projeto `personal-proops-agent` **dentro da org** `76291957852` · sem chave de service account |
| Cloud Run | `agente` · `min-instances=0` · `concurrency=80` · `/health` 200 tocando o banco |
| URLs | nova: `https://agente-942030719023.southamerica-east1.run.app`<br>legada (é a que está em `OIDC_AUDIENCE`): `https://agente-wwm7xruoyq-rj.a.run.app` |
| Cloud Tasks | fila `whatsapp-debounce` · 3 tentativas · backoff 2s→60s · 20 simultâneas |
| Cloud Scheduler | 3 jobs criados e **PAUSADOS** — o `pg_cron` do Supabase segue fazendo esse trabalho |
| Secret Manager | 12 segredos, 1 versão ativa cada |
| Testes | 64 verdes (`agent/.venv/bin/pytest`) |

**Os crons estão pausados de propósito.** `pg_cron` e Cloud Scheduler fariam o
mesmo trabalho contra o mesmo banco; alerta e recorrente têm dedupe, mas
**lembrete não tem** — os dois no mesmo minuto entregam duas vezes. Ligar é
decisão do corte:

```bash
for J in reminders finance-scheduler alerts; do
  gcloud scheduler jobs resume $J --location southamerica-east1 --project personal-proops-agent
done
# e, no mesmo movimento, desagendar os equivalentes no pg_cron
```

---

# Parte 1 — Staging

## Por que só o banco precisa de staging

Três camadas, três níveis de risco:

- **Agente (grafo, tools, prompts):** o `fake_meta.py` já exercita ele inteiro
  contra o Cloud Run real, com payload **assinado de verdade**. Não é mock: é
  HMAC real, fila real, Gemini real, e a resposta sai pela Graph API real.
- **Banco:** é onde um bug faz dano permanente — o agente cria transação, apaga
  nota, dá baixa em conta. **É aqui que staging vale.**
- **Canal (WhatsApp):** número separado exigiria recriar e reaprovar templates
  na WABA nova. Não compensa enquanto o único usuário é você — o roteamento
  canário isola melhor.

## Montar o Supabase de staging

O free tier permite 2 projetos por organização.

```bash
# 1. criar o projeto no dashboard (mesma região: sa-east-1)
#    nome sugerido: "Personal ProOps app — staging"

# 2. aplicar o schema inteiro nele
npx supabase link --project-ref <REF-DO-STAGING>
npx supabase db push
npx supabase link --project-ref kwriuifcwyvdrxtspjiz   # VOLTAR para produção

# 3. um .env separado, apontando para o banco de staging
cp agent/.env agent/.env.staging
# trocar DATABASE_URL e SUPABASE_URL pelos do staging;
# o resto (Gemini, WhatsApp, Langfuse) pode ser o mesmo
```

⚠️ **Reapontar o `supabase link` para produção depois do `db push`.** Esquecer
isso faz o próximo `db push` cair no lugar errado.

## Um serviço Cloud Run de staging

O `setup-gcp.sh` é parametrizado por variável de ambiente:

```bash
SERVICE=agente-staging QUEUE=whatsapp-debounce-staging \
ENV_FILE=agent/.env.staging ./scripts/setup-gcp.sh deploy
```

Mesmo projeto GCP, serviço e fila separados. Custo adicional ~zero
(`min-instances=0`).

## Como se testa: pelo WhatsApp de verdade

O caminho principal **não** é script. É conversar pelo app, com o backend de
staging atrás:

```
seu WhatsApp → Meta → Edge Function (Deno)
                        ↓ routes_to_python(seu número) = true
                      Cloud Run STAGING → banco de STAGING
                        ↓
                      resposta no seu WhatsApp
```

O truque é `PYTHON_AGENT_URL` apontar para o serviço de **staging**. Você digita
como qualquer usuário e tudo cai no banco descartável.

```bash
npx supabase secrets set PYTHON_AGENT_URL=https://agente-staging-942030719023.southamerica-east1.run.app/whatsapp-inbound
npx supabase functions deploy whatsapp-webhook

psql "$SUPABASE_DB_URL" -c "insert into public.agent_routing (phone, use_python_agent)
  values ('55DDD9XXXXXXXX', true)"
```

Depois é abrir o WhatsApp: *"gastei 45 no mercado"*, *"quanto gastei esse mês?"*,
*"apaga o último"* → ele pergunta → *"sim"*.

Ciclo de mudança: editar → `SERVICE=agente-staging ENV_FILE=agent/.env.staging
./scripts/setup-gcp.sh deploy` → testar de novo pelo WhatsApp. Um comando entre
uma versão e outra.

⚠️ **`agent_routing` fica no banco de PRODUÇÃO** (é a Edge Function de produção
que consulta), mas o agente escreve no de **staging**. Então seu telefone precisa
existir em `profiles` **no staging** também, senão a resposta é "não encontrei
sua conta".

Passar para produção depois é só apontar o `PYTHON_AGENT_URL` para o serviço de
produção — sem mexer no roteamento nem no número.

## O script, e para que ele serve

`scripts/fake_meta.py` **não é mock**: monta o payload no formato da Meta,
assina com o `WHATSAPP_APP_SECRET` real e faz POST no Cloud Run que está no ar.
HMAC, fila, debounce, grafo, Gemini, banco e a resposta pela Graph API — tudo
real. Só "a Meta enviou isto" é simulado.

Ele resolve três coisas que o WhatsApp não faz bem:

- **rajada** — três mensagens em menos de 3s para testar o debounce
- **repetição** — a mesma bateria depois de cada mudança, sempre igual
- **independência da Meta** — testa o Cloud Run direto se o webhook estiver mal
  configurado

```bash
cd agent
export WHATSAPP_APP_SECRET=$(grep '^WHATSAPP_APP_SECRET=' .env.staging | cut -d= -f2-)
export AGENT_URL=https://agente-staging-942030719023.southamerica-east1.run.app
export TEST_PHONE=55DDD9XXXXXXXX      # SEU número, cadastrado no staging

python scripts/fake_meta.py --burst "mercado 45" "uber 30" "recebi 500 de freela"
```

---

# Parte 2 — Os três passos do corte

## Passo 1 · Rotacionar o `WHATSAPP_VERIFY_TOKEN`

O token antigo foi exposto em log durante os testes de conectividade (foi para
uma query string). Severidade baixa — ele só serve no handshake `GET` de
verificação e não autentica mensagem nenhuma, quem faz isso é o
`WHATSAPP_APP_SECRET` via HMAC — mas rotacionar é barato e o passo 3 já mexe no
painel da Meta.

```bash
# 1. gerar
NOVO=$(openssl rand -hex 32); echo "$NOVO"

# 2. atualizar os DOIS arquivos locais
#    agent/.env         → WHATSAPP_VERIFY_TOKEN=<novo>
#    supabase/.env      → WHATSAPP_VERIFY_TOKEN=<novo>
#    (e agent/.env.staging, se existir)

# 3. Secret Manager (o script grava versão nova e destrói a anterior)
./scripts/setup-gcp.sh secrets

# 4. redeploy do Cloud Run para pegar a versão nova
./scripts/setup-gcp.sh deploy

# 5. secret do Supabase + redeploy da Edge Function
npx supabase secrets set WHATSAPP_VERIFY_TOKEN="$NOVO"
npx supabase functions deploy whatsapp-webhook

# 6. painel da Meta: WhatsApp → Configuration → Verify token
```

O passo 6 é o último. Trocar antes derruba a verificação se a Meta reenviar o
handshake.

## Passo 2 · O proxy Strangler

Já implementado em `supabase/functions/whatsapp-webhook/index.ts`. O que ele faz:

1. Valida o HMAC (inalterado).
2. Extrai o telefone da primeira mensagem do payload.
3. Chama `routes_to_python(phone)` — a RPC da `0041`, que casa o número com e
   sem o 9º dígito brasileiro.
4. `false` (padrão) → segue no fluxo Deno de sempre.
5. `true` → repassa o corpo CRU e a assinatura para `PYTHON_AGENT_URL`, com
   timeout de 3s, e devolve 200 à Meta.

### O fallback, e por que ele é condicional

Quando o repasse falha, cair no fluxo antigo **sem condição** quebra duas coisas:

- **Confirmação pendente vira nota.** Conversa esperando "SIM" no Python teria a
  resposta processada pelo fluxo antigo, que não sabe que houve pergunta.
- **Processamento duplo.** Se o Python já enfileirou e só a resposta HTTP falhou,
  o Deno processa de novo. As duas filas usam tabelas diferentes
  (`messages_queue` × `messages_raw`) e o dedupe de uma não enxerga a outra —
  resultado é lançamento duplicado.

Por isso o fallback só acontece quando **as duas** condições valem:

```
nenhuma linha em pending_actions com status='awaiting' para o telefone
E  a mensagem não está em messages_queue
```

Fora disso, devolve **503** e a Meta reentrega. É mais lento e nunca corrompe.

## Passo 3 · Ligar o canário

```bash
# 1. apontar a Edge Function para o Cloud Run
npx supabase secrets set PYTHON_AGENT_URL=https://agente-wwm7xruoyq-rj.a.run.app/whatsapp-inbound
npx supabase functions deploy whatsapp-webhook

# 2. só o seu número no fluxo novo
psql "$SUPABASE_DB_URL" -c "insert into public.agent_routing (phone, use_python_agent, note)
  values ('55DDD9XXXXXXXX', true, 'canário — primeiro usuário no agente Python')
  on conflict (phone) do update set use_python_agent = true"
```

**Rollback:** `update public.agent_routing set use_python_agent = false where phone = '...'`.
Vale na mensagem seguinte, sem deploy.

### Checklist depois de ligar

- [ ] Mandar "oi" — resposta de ajuda, e **zero** chamada ao Gemini (é fast-path)
- [ ] "gastei 45 no mercado" — aparece em `transactions` e no app
- [ ] Três mensagens seguidas — **uma** resposta consolidada (debounce de 3s)
- [ ] "apaga o último" — **pergunta** antes; "sim" executa; "não" cancela
- [ ] Esperar 11 min e responder "sim" — não deve apagar nada (expira em 10)
- [ ] Conferir o trace no Langfuse (projeto `personal-proops-agent`)
- [ ] `select * from ai_events order by created_at desc limit 5` — a cota conta daqui

---

# Armadilhas conhecidas

**Duas URLs do Cloud Run.** O serviço responde na nova
(`agente-942030719023.southamerica-east1.run.app`) e na legada
(`agente-wwm7xruoyq-rj.a.run.app`). `OIDC_AUDIENCE`, `WORKER_URL` e os crons
usam a **legada**, porque é o que `status.url` devolve. Precisam continuar todos
iguais: o Cloud Tasks assina o token com essa audiência e o serviço valida
contra ela. Misturar as duas gera 401 em `/worker`.

**A política da org desliga grants automáticos.** A service account padrão do
Compute não ganha Editor sozinha, e é ela que compila no Cloud Build. O
`setup-gcp.sh` concede os papéis explicitamente na etapa `permitir_build`.

**O comentário do `.env` já virou valor.** O parser não remove `# comentário`
quando o valor está vazio. A `Settings` corta isso hoje, e a checagem de produção
valida **forma** (URL tem que ser `https://` e conter `/worker/`), não presença.

**Prompt caching não é alavanca.** Mínimo de 4.096 tokens; os prompts por domínio
têm ~800. Não gaste tempo "otimizando" para isso.

**O teto do schema do Gemini é o PRODUTO propriedades × valores de enum**, não
cada um. Medido: `15×22=330` recusa, `9×22=198` passa. Antes de somar campo,
rode `agent/scripts/diagnose_finance_schema.py`.
