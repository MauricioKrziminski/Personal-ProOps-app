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
| **Staging** | projeto Supabase `utkqoiigimqzeenxkxdl` + Cloud Run `agente-staging` + fila `whatsapp-debounce-staging` — ver Parte 1 |

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

> **Já está montado** (31/08/2026). Esta parte descreve o que existe e como
> reproduzir; não é lista de tarefas. O que falta para conversar pelo WhatsApp
> está em *Ligar o staging no seu WhatsApp*, no fim da seção.

| | |
|---|---|
| Supabase staging | projeto `utkqoiigimqzeenxkxdl` (`Personal ProOps app - staging`), sa-east-1 · as 41 migrations aplicadas |
| Cloud Run staging | `agente-staging`, mesmo projeto GCP, `min-instances=0` |
| URLs do staging | nova: `https://agente-staging-942030719023.southamerica-east1.run.app`<br>legada (é a de `WORKER_URL`/`OIDC_AUDIENCE`): `https://agente-staging-wwm7xruoyq-rj.a.run.app`<br>as duas respondem; a legada é a que `status.url` devolve |
| Fila | `whatsapp-debounce-staging` |
| Segredos | 12, com sufixo `-staging` no Secret Manager |
| Config local | `agent/.env.staging` (não versionado) |

⚠️ **A senha do banco de staging só existe dentro do `agent/.env.staging`**, no `DATABASE_URL`. Não há segunda cópia — se o arquivo sumir, é resetar a senha no dashboard do Supabase e regravar o segredo (`./scripts/setup-gcp.sh staging`).

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

Consequência: `agent/.env.staging` troca **cinco** linhas do `agent/.env`
(`DATABASE_URL`, `SUPABASE_URL` e os três nomes do Cloud Run). Gemini, Groq,
WhatsApp e Langfuse são os **mesmos de produção**, de propósito.

## Montar o Supabase de staging

O free tier permite 2 projetos por organização (org `fwoypsbbxdoscnudslty`).

```bash
npx supabase projects create "Personal ProOps app - staging" \
  --org-id fwoypsbbxdoscnudslty --region sa-east-1 \
  --db-password "$(openssl rand -hex 24)"
```

Senha em **hex** de propósito: sem caractere que precise de URL-encode dentro do
`DATABASE_URL`.

### ⚠️ Os segredos do Vault vêm ANTES do `db push`

A `0003` tem a URL e o anon key de **PRODUÇÃO hardcoded** num `cron.schedule`.
A `0008` conserta isso lendo do Vault — mas **aborta** com `raise exception` se
os segredos não existirem (a `0016` e a `0025` também). Empurrar sem eles para
o push no meio, e o banco de staging fica com cron batendo em **produção** a
cada minuto até alguém perceber.

Criar os dois primeiro faz o push atravessar `0003 → 0008` sem parar, e a `0008`
substitui os jobs no mesmo movimento:

```sql
-- no banco de STAGING, com os valores do STAGING
select vault.create_secret('https://utkqoiigimqzeenxkxdl.supabase.co', 'project_url');
select vault.create_secret('<publishable key do staging>',             'anon_key');
```

### Aplicar o schema

```bash
export SUPABASE_DB_PASSWORD='<a senha gerada acima>'
trap 'npx supabase link --project-ref kwriuifcwyvdrxtspjiz' EXIT   # relink garantido
npx supabase link --project-ref utkqoiigimqzeenxkxdl
npx supabase db push --yes
```

O `trap` não é preciosismo: esquecer o relink faz o **próximo `db push` cair no
banco errado**. Deixe o religamento amarrado à saída do shell, não à sua memória.

### Depois do push: desagendar os crons do fluxo Deno

Sobram 5 pg_cron no staging. Quatro chamam Edge Functions que **não existem
ali** — 404 a cada minuto, para sempre, enchendo `net._http_response`:

```sql
select cron.unschedule(j) from unnest(array[
  'process-jobs','send-reminders','finance-scheduler','send-alerts']) j;
-- 'purge-trashed-notes' FICA: é SQL puro, local ao banco.
```

Quem faz esse trabalho no staging é o agente Python.

### Conferir que nada aponta para produção

```sql
select jobname, schedule, command like '%kwriuifcwyvdrxtspjiz%' as aponta_producao
from cron.job order by jobname;
```

## O `.env.staging` e o serviço Cloud Run

```bash
cp agent/.env agent/.env.staging
# trocar DATABASE_URL (session pooler do staging, porta 5432),
# SUPABASE_URL, TASKS_QUEUE, WORKER_URL e OIDC_AUDIENCE.
```

⚠️ O pooler do staging é **`aws-0`**-sa-east-1; o de produção é **`aws-1`**. Não
é typo, e copiar o host errado dá `tenant/user not found` — erro que parece
senha errada.

```bash
./scripts/setup-gcp.sh staging
```

O modo `staging` do script existe porque `deploy` **não serve**: ele não grava
segredos (leria os de produção), não cria a fila, e chamaria `criar_crons`, que
faz `update` nos jobs do Scheduler — repontando os crons de **produção** para a
URL de staging, em silêncio. O modo `staging` roda
`criar_projeto → gravar_segredos → criar_fila → deploy`, e **não** mexe em cron.

Os segredos vão para o mesmo projeto GCP com sufixo `-staging`
(`SECRET_SUFFIX`), porque Secret Manager é por projeto: sem sufixo, o serviço de
staging receberia o `database-url` de **produção** e escreveria no banco real —
exatamente o que staging existe para impedir.

```bash
curl -s https://agente-staging-942030719023.southamerica-east1.run.app/health
```

Ciclo de mudança: editar → `./scripts/setup-gcp.sh staging` → testar. Um comando
entre uma versão e outra.

**Exercitado ponta a ponta em 31/08/2026** com `fake_meta.py` e um DDD inválido
(`550000000000`, que a Meta rejeita — assim o teste não manda WhatsApp para
ninguém): `/whatsapp-inbound` 200 → linha em `messages_queue` do **staging** →
debounce no Cloud Tasks → worker → `status='done'`. Três mensagens seguidas
viraram um lote só. Foi esse teste que revelou o `actAs` faltando (ver
*Armadilhas*).

## Ligar o staging no seu WhatsApp

O caminho principal **não** é script. É conversar pelo app, com o backend de
staging atrás:

```
seu WhatsApp → Meta → Edge Function (Deno, em PRODUÇÃO)
                        ↓ routes_to_python(seu número) = true
                      Cloud Run STAGING → banco de STAGING
                        ↓
                      resposta no seu WhatsApp
```

O truque é `PYTHON_AGENT_URL` apontar para o serviço de **staging**. Você digita
como qualquer usuário e tudo cai no banco descartável.

**Três coisas, nesta ordem:**

```bash
# 1. seu usuário PRECISA existir no banco de STAGING, senão a resposta é
#    "não encontrei sua conta". Criar pelo Auth (o trigger on_auth_user_created
#    cria profile + workspace + assinatura); um insert direto em profiles pularia
#    os três.
#    STG_SERVICE_KEY = o **service_role legado** (JWT, começa com eyJ...).
#    Medido em 31/08/2026: a chave nova `sb_secret_...` é RECUSADA por
#    /auth/v1/admin/* com {"message":"Invalid API key"}. Pegue assim:
#      npx supabase projects api-keys --project-ref utkqoiigimqzeenxkxdl -o json \
#        | jq -r '.[]|select(.name=="service_role").api_key'
curl -X POST 'https://utkqoiigimqzeenxkxdl.supabase.co/auth/v1/admin/users' \
  -H "apikey: $STG_SERVICE_KEY" -H "Authorization: Bearer $STG_SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"phone":"55DDD9XXXXXXXX","phone_confirm":true}'
#    telefone SÓ DÍGITOS, com o 55 (ver agent/app/domain/phone.py)

# 2. a Edge Function de produção passa a repassar para o staging.
#    PYTHON_AGENT_FALLBACK=off é OBRIGATÓRIO enquanto o alvo for staging:
#    o fallback decide olhando messages_queue/pending_actions do banco DESTA
#    function (produção), mas o Python está gravando no de staging — as duas
#    checagens consultam o lugar errado, sempre respondem "pode cair", e um
#    timeout de repasse mandaria sua mensagem para o fluxo Deno, que a grava
#    em PRODUÇÃO. Com "off", falha de repasse vira 503 e a Meta reentrega.
npx supabase secrets set \
  PYTHON_AGENT_URL=https://agente-staging-942030719023.southamerica-east1.run.app/whatsapp-inbound \
  PYTHON_AGENT_FALLBACK=off
npx supabase functions deploy whatsapp-webhook

# 3. seu número no fluxo novo — esta linha vai no banco de PRODUÇÃO
insert into public.agent_routing (phone, use_python_agent, note)
values ('55DDD9XXXXXXXX', true, 'staging — teste pelo WhatsApp')
on conflict (phone) do update set use_python_agent = true;
```

⚠️ **`agent_routing` fica no banco de PRODUÇÃO** (é a Edge Function de produção
que consulta), mas o agente escreve no de **staging**. As duas pontas são de
bancos diferentes, e é isso que faz o isolamento funcionar.

⚠️ **A partir do passo 3 suas mensagens reais param de chegar no app de
produção** — elas vão para o banco descartável. **Rollback:**

```sql
update public.agent_routing set use_python_agent = false where phone = '55DDD9XXXXXXXX';
```

Vale na mensagem seguinte, sem deploy.

**Ligado em 31/08/2026** para `5535998744200` (Gabriel) e `5551992553295`
(sócio), cada um com workspace próprio no staging. O caminho foi provado
ponta a ponta com um número inválido roteado temporariamente: POST assinado na
Edge Function de PRODUÇÃO → Cloud Run de staging → `messages_queue` do staging →
`done`, com **zero** linhas em `messages_raw` de produção (o fluxo Deno não foi
tocado).

### ⚠️ O staging NÃO tem sweep — mensagem pode ficar presa

O modo `staging` do `setup-gcp.sh` pula `criar_crons` de propósito (para não
repontar os jobs de produção). Consequência: **não existe Cloud Scheduler no
staging, logo `/worker/sweep` nunca roda sozinho.**

Isso importa porque `claim_thread_batch` recusa thread com `processing` recente
(um worker por conversa, por desenho). Se você mandar a segunda mensagem
enquanto a primeira ainda está sendo processada — o que é fácil, já que um turno
com Gemini + cold start leva ~35s —, a segunda fica `pending` **para sempre**.

Em produção o sweep do cron de lembretes recupera em até 1 minuto. No staging,
destrave na mão:

```bash
SEC=$(grep '^INTERNAL_SECRET=' agent/.env.staging | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | xargs)
curl -X POST https://agente-staging-wwm7xruoyq-rj.a.run.app/worker/sweep -H "X-Internal-Secret: $SEC"
```

Sintoma: a mensagem aparece `pending` em `messages_queue`, sem erro nenhum.

### Três coisas que confundem durante o teste

**1. O número de teste da Meta só ENVIA para destinatários cadastrados.** Quem
não estiver na lista (Meta → WhatsApp → API Setup → campo "To") manda mensagem
normalmente, ela é processada, e a **resposta não chega** — `try_send` engole a
falha de envio de propósito (envio é best-effort e nunca reprocessa). Sintoma:
"o agente ignorou meu sócio". Cadastre os dois números antes.

**2. Os lembretes continuam vindo do banco de PRODUÇÃO.** O `pg_cron` de
produção segue com `send-reminders` ativo a cada minuto, e ele lê os lembretes de
**produção** — que chegam no MESMO chat onde você está testando o staging. Não é
bug do agente novo. Para silenciar durante o teste:
`select cron.unschedule('send-reminders');` no banco de produção (e reagendar
depois com a `0008`) — mas aí você perde os lembretes reais no período.

**3. Responder a um lembrete antigo não reagenda nada.** A mensagem "responda
aqui para reagendar" veio de produção, mas a sua resposta agora vai para
**staging**, que não conhece aquele lembrete.

Depois é abrir o WhatsApp: *"gastei 45 no mercado"*, *"quanto gastei esse mês?"*,
*"apaga o último"* → ele pergunta → *"sim"*.

Passar para produção depois é só apontar o `PYTHON_AGENT_URL` para o serviço de
produção — sem mexer no roteamento nem no número.

## Testar o APP contra o staging

O WhatsApp escrevendo em staging só é metade do fluxo. Para VER isso no app, ele
precisa apontar para o mesmo banco — senão você digita no WhatsApp e olha uma
tela de produção, vazia.

**1. `.env.local` sobrepõe o `.env`** (verificado com `@expo/env` nesta versão;
o `.env` continua em produção, intocado):

```bash
EXPO_PUBLIC_SUPABASE_URL=https://utkqoiigimqzeenxkxdl.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<publishable do staging>
```

**Não há troca automática: o arquivo existir É o switch.** Medido com
`@expo/env` em 31/08/2026:

| | aponta para |
|---|---|
| `.env.local` presente, `NODE_ENV=development` | **staging** |
| `.env.local` presente, `NODE_ENV=production` | **staging** |
| `.env.local` presente, `NODE_ENV=test` | produção |
| sem `.env.local` | produção |

Isso corta dos dois lados. Apagar o arquivo no meio do teste devolve o app para
produção — e a tela fica vazia enquanto o WhatsApp segue escrevendo no staging.
E ele **não** se desliga sozinho num build de produção: vence com
`NODE_ENV=production` também.

⚠️ **`rm .env.local` na mão antes de qualquer build EAS de produção.** Esquecer
publica um app lendo o banco descartável. Voltar para produção no dev não exige
rebuild — `rm .env.local && npx expo start -c` basta, porque `EXPO_PUBLIC_*` é
inlinado no BUNDLE, não no binário.

A sessão salva no device vai ser recusada (o emissor do JWT é outro projeto):
cair na tela de login é o comportamento certo.

**2. O provider de telefone nasce DESLIGADO no projeto novo** — e o app mostra
isso como *"Não deu para continuar agora"*, o fallback genérico de
`src/lib/auth-errors.ts` (a política é nunca vazar inglês técnico para a tela).
O erro de verdade é `phone_provider_disabled`. Conferir sem adivinhar:

```bash
curl -s https://<ref>.supabase.co/auth/v1/settings -H "apikey: <anon>" | jq .external.phone
```

Produção devolve `true`; um projeto recém-criado devolve `false`, e o login falha
com `phone_provider_disabled`. Ligar no staging exige DUAS coisas — o provider
**e** o Send SMS Hook apontando para o `/hooks/otp` do Cloud Run de staging, com
o mesmo `SEND_SMS_HOOK_SECRET` (os segredos do staging são cópia dos de produção,
então o segredo já casa).

**2b. Atalho que dispensa configurar o OTP:** o botão *"Entrar como teste (dev)"*
(só em `__DEV__`) faz `signInWithPassword` com `dev@proops.local`, e o provider de
email já vem habilitado. Cole email e senha **no usuário do telefone existente**,
nunca crie um usuário novo — o trigger `on_auth_user_created` daria a ele um
workspace próprio, e o app abriria numa conta vazia, parecendo que o WhatsApp não
escreveu:

```bash
curl -X PUT "https://utkqoiigimqzeenxkxdl.supabase.co/auth/v1/admin/users/<id-do-usuario-do-telefone>" \
  -H "apikey: $STG_SERVICE_KEY" -H "Authorization: Bearer $STG_SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev@proops.local","password":"devtest123","email_confirm":true}'
```

**3. Realtime já está de pé:** as 15 tabelas da publicação `supabase_realtime`
vieram nas migrations, então o que o WhatsApp grava aparece no app sem refresh.

## O script, e para que ele serve

`scripts/fake_meta.py` **não é mock**: monta o payload no formato da Meta,
assina com o `WHATSAPP_APP_SECRET` real e faz POST no Cloud Run que está no ar.
HMAC, fila, debounce, grafo, Gemini, banco e a resposta pela Graph API — tudo
real. Só "a Meta enviou isto" é simulado. **A resposta chega no seu WhatsApp de
verdade**, inclusive numa rajada.

Ele resolve três coisas que o WhatsApp não faz bem:

- **rajada** — três mensagens em menos de 3s para testar o debounce
- **repetição** — a mesma bateria depois de cada mudança, sempre igual
- **independência da Meta** — testa o Cloud Run direto se o webhook estiver mal
  configurado

```bash
cd agent
# o sed NÃO é opcional: a linha do .env tem comentário depois do valor, e
# sem cortá-lo o HMAC sai errado e o webhook devolve 401 invalid signature
export WHATSAPP_APP_SECRET=$(grep '^WHATSAPP_APP_SECRET=' .env.staging \
  | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | xargs)
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

## Antes do Passo 3: medir o cold start

`PROXY_TIMEOUT_MS` na Edge Function é **3s**, e o Cloud Run roda com
`min-instances=0`. Se o container frio demorar mais que isso, o repasse expira.

Em **staging** isso é inofensivo, porque `PYTHON_AGENT_FALLBACK=off` transforma a
falha em 503 e a Meta reentrega (na reentrega o container já está quente). Em
**produção** o fallback volta a ficar ligado, e aí um timeout de cold start manda
a mensagem para o fluxo Deno — `fallbackSeguro` protege (ele consulta o banco
certo em produção), mas a proteção depende de o insert do Python já ter
commitado, o que numa partida fria é justamente o que ainda não aconteceu.

Medir com o serviço parado de verdade (≥15 min sem tráfego — **qualquer**
requisição sua reaquece e invalida a medida):

```bash
curl -s -o /dev/null -w 'cold=%{time_total}s\n' https://agente-wwm7xruoyq-rj.a.run.app/health
```

Se passar de ~2s, subir `PROXY_TIMEOUT_MS` não resolve (a Meta corta em 5s): o
caminho é `min-instances=1` no serviço de produção durante o canário.

## Passo 3 · Ligar o canário

```bash
# 1. apontar a Edge Function para o Cloud Run de PRODUÇÃO.
#    Aqui o fallback condicional VOLTA a ser correto (o Python passa a gravar
#    no mesmo banco que a function consulta), então tire o PYTHON_AGENT_FALLBACK.
npx supabase secrets set PYTHON_AGENT_URL=https://agente-wwm7xruoyq-rj.a.run.app/whatsapp-inbound
npx supabase secrets unset PYTHON_AGENT_FALLBACK
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

## O 9º dígito quebra a RESPOSTA, não só a busca

Medido em 31/08/2026 contra o número de teste:

| envio para | resultado |
|---|---|
| `5535998744200` (com o 9) | **aceito** — e a Meta devolve `wa_id: 553598744200` |
| `553598744200` (sem o 9) | **recusado**, `(#131030) Recipient phone number not in allowed list` |

A Meta ENTREGA o `from` sem o 9 e casa a allowed list pela forma COM o 9: ela
normaliza na entrada e não na saída. O agente respondia ao `from` como veio, o
envio falhava, e `try_send` engolia — a conversa ficava **muda**, com a
transação criada corretamente no banco. Sintoma: "mandei e ele não respondeu".

`_graph_post` (`app/services/whatsapp.py`) agora tenta as duas formas, nessa
ordem, e só troca em **4xx** (rejeitado = nada entregue, então não duplica).
Coberto por `tests/test_whatsapp_send.py`.

## Rascunho (draft) — lançamento pela metade

`draft_actions` guarda uma extração incompleta com o SLOT que ela espera
(`amount` ou `account`). É o que permite três coisas ao mesmo tempo: pedir o dado
que falta, deixar o usuário mudar de assunto sem perder nada, e retomar depois.

Máquina de estados: pede o valor → recebe → descobre que falta o cartão → pede o
cartão → valida contra `accounts` → executa (com HITL se for valor alto).

**Cartão é obrigatório em compra parcelada** (`installments > 1`): parcelamento
vira fatura, e o trigger `set_invoice` precisa de dono. Compra à vista continua
aceitando conta nula, que é a regra escrita do projeto.

**Cartão inexistente NÃO quebra a sessão.** Lista os cartões reais e mantém o
rascunho `awaiting` — jogar no fallback genérico aqui apagaria de vista um
lançamento que está a um dado de ficar pronto.

⚠️ **O rascunho é chaveado por TELEFONE, não por thread** (0044). O thread
efetivo carrega o epoch da sessão, que gira em 6h; o rascunho vive 24h.

### Coleta robusta (31/08/2026)

O teste de usabilidade com cartões pegou o agente literal demais. Três defeitos
encadeados, e um quarto que só apareceu na leitura do código:

- **A pergunta do cartão é MENU**, não texto livre: Lista Interativa (ou botões,
  com até 2 cartões) com os cartões reais, payload `ds:<id do rascunho>:c:<id do
  cartão>` e `ds:<id>:no` para desistir. O clique executa sem chamar IA nenhuma.
  Prefixo próprio, e não `pa:`, porque um rascunho em `pending_actions` ocuparia
  o índice de "uma pergunta aberta por conversa" (o motivo está na 0043).
- **O modelo extrai a entidade na MESMA chamada que classifica**
  (`DraftDecision.extracted_value`). "acabei de criar um pelo app, chama nubank
  cartao" devolve `nubank`. Duas chamadas dobrariam a latência e comeriam duas
  das 500 requisições diárias do Flash-Lite para chegar no mesmo lugar.
  **O VALOR continua determinístico** — `parse_valor_em_centavos`, que só aceita
  um número plausível. Só o slot de conta usa a extração.
- **O casamento é normalizado e mora em UM lugar** (`domain/matching.py`):
  sem acento, minúsculo, sem pontuação; exato → substring bidirecional →
  semelhança (typo). Antes eram TRÊS matchers diferentes — a validação do
  rascunho, o `resolve_account` da execução e o filtro de fatura —, então
  validar e executar podiam discordar sobre qual cartão o usuário quis dizer.
  Empate devolve a lista: quem tem como perguntar pergunta, e `resolve_account`,
  que resolve em silêncio, só aceita semelhança quando é única.
- **O nome gravado é o CANÔNICO do banco.** Era o defeito silencioso: mesmo com
  a validação passando, `mesclar` gravava o texto digitado, o `ilike` de baixo
  não achava, e a compra parcelada nascia SEM cartão — exatamente o que a regra
  "cartão obrigatório em parcelado" existe para impedir.

O menu é emitido **depois** do bloco de pausa em `_resposta_do_estado`: rascunho
e `interrupt()` coexistem no mesmo turno ("comprei um mac em 12x e apaga o
último"), e interceptar antes pularia o `create_pending`, deixando o grafo parado
num checkpoint que nenhum resume alcança.

`scripts/fake_meta.py --click "<id>"` manda um `list_reply` assinado — sem ele
nenhum clique era testável localmente, nem os botões de confirmação.

**Custo do turno:** os fast-paths que classificam TEXTO (resposta de rascunho,
SIM/NÃO digitado) passaram a gravar em `ai_events` — eles chamam o Gemini desde
que o SIM/NÃO deixou de ser regex, e não estavam sendo contados, então o paywall
mensal subcontava. O **clique continua custando zero**: o estado que volta do
checkpoint carrega o `llm_calls` do turno da PERGUNTA, que já virou linha lá
atrás, e somá-lo no resume cobraria a mesma chamada duas vezes.

# Quando o número real da ProOps entrar

Hoje existe **um** número (o de teste da Meta), e por isso o roteamento é pelo
telefone de QUEM MANDA (`agent_routing`) e o ambiente é o secret global
`PYTHON_AGENT_URL`. Quando o número real entrar, o discriminador natural passa a
ser **para qual número você mandou** — mas isso NÃO acontece sozinho:

- **A Meta entrega os dois no mesmo webhook.** O webhook é configurado por App,
  não por número: números da mesma WABA/App caem na MESMA URL. (Se o número real
  nascer em outro App, aí sim são webhooks distintos — e o mais simples é apontar
  o webhook do App novo direto para o Cloud Run de produção, sem Edge Function.)
- **O código ignora o destino.** O payload traz `value.metadata.phone_number_id`,
  que diz qual dos SEUS números recebeu a mensagem. Nem
  `supabase/functions/whatsapp-webhook/index.ts` nem
  `agent/app/routes/inbound.py` leem esse campo — os dois roteiam só pelo
  `messages[0].from`. Com `PYTHON_AGENT_URL` em staging, mandar para o número
  real cairia no banco de **staging** do mesmo jeito.

**O caminho certo, quando chegar a hora** (~10 linhas na Edge Function, sem
migration): escolher a URL por `phone_number_id` — número de teste → staging,
número real → produção. É melhor que uma coluna em `agent_routing` porque:

- vale para todo mundo de uma vez, sem uma linha por telefone;
- a resposta volta **do número para o qual você escreveu** (cada serviço manda
  pelo seu próprio `WHATSAPP_PHONE_NUMBER_ID`, ver `services/whatsapp.py`), então
  as duas conversas ficam em threads separadas no WhatsApp — dá para saber qual
  ambiente respondeu só de olhar, sem consultar banco nenhum;
- o `PYTHON_AGENT_FALLBACK` deixa de ser um knob e vira regra estrutural:
  fallback só quando o alvo é produção.

Não foi implementado agora de propósito: o número real ainda não existe, o
`phone_number_id` dele é desconhecido, e não daria para testar.

# Armadilhas conhecidas

**Duas URLs do Cloud Run.** O serviço responde na nova
(`agente-942030719023.southamerica-east1.run.app`) e na legada
(`agente-wwm7xruoyq-rj.a.run.app`). `OIDC_AUDIENCE`, `WORKER_URL` e os crons
usam a **legada**, porque é o que `status.url` devolve. Precisam continuar todos
iguais: o Cloud Tasks assina o token com essa audiência e o serviço valida
contra ela. Misturar as duas gera 401 em `/worker`.

**O `setup-gcp.sh` usa a conta ATIVA do gcloud, e ela muda.** Com outra conta
ativa, `criar_projeto` não consegue nem descrever o projeto, cai no `create` e
morre com `PERMISSION_DENIED ... resourcemanager.projects.create` — mensagem que
parece falta de papel na organização, mas é conta errada. Não troque a
configuração global só para rodar o script; prefixe a chamada:

```bash
CLOUDSDK_CORE_ACCOUNT=gestao.proops@gmail.com ./scripts/setup-gcp.sh staging
```

O mesmo vale para `gcloud logging read` e qualquer leitura: `--account
gestao.proops@gmail.com`.

**O pooler do Supabase IGNORA `options=-csearch_path` — em silêncio.** O
isolamento do checkpointer do LangGraph era feito assim, pelo conninfo. A conexão
sobe sem erro nenhum e o `search_path` continua `"$user", public, extensions`, de
modo que `checkpointer.setup()` criou `checkpoints`, `checkpoint_writes` e
`checkpoint_blobs` em **public** — onde o PostgREST as serve com a **anon key**.
Elas guardam o CONTEÚDO das conversas (valores, contas, notas), que é exatamente
o que a `0040` criou o schema `langgraph` para proteger. Confirmado com
`GET /rest/v1/checkpoints` → HTTP 200 usando a chave publishable.

O isolamento agora é `set search_path to langgraph` no callback `configure` do
pool (`app/db.py::_isolar_checkpointer`), que roda DEPOIS do handshake e não
depende de o pooler repassar parâmetro de startup. A `0042` remove as tabelas
órfãs de `public`, com guard que aborta se houver conversa viva. Conferir a
qualquer momento:

```sql
select to_regclass('public.checkpoints');  -- tem que ser null
```

**Ordem importa no corte:** deploy do código primeiro, `db push` depois. Um
container antigo recriaria as tabelas em `public` no `setup()` seguinte.

**A SA precisa de `actAs` sobre SI MESMA — e faltava.** Para criar uma task com
token OIDC assinado como `agente-runner`, o Cloud Tasks exige
`iam.serviceAccounts.actAs` do chamador sobre a SA do token; aqui o chamador *é*
a `agente-runner`, e mesmo assim o binding não vem de graça (a org desliga os
grants automáticos). Sem ele, `create_task` devolve **403 e o debounce nunca é
agendado**: a mensagem entra na `messages_queue` e fica lá. O `inbound` degrada
de propósito — loga "o sweep recupera" e responde 200 à Meta — mas o sweep vive
no cron de lembretes, **que nasce pausado**. Efeito líquido: mensagem
enfileirada e nunca processada, sem erro visível para a Meta.

Isso valia para **produção também** (mesma SA), e só apareceu porque o staging
foi exercitado ponta a ponta. Corrigido em `criar_sa()`; reaplicável com
`./scripts/setup-gcp.sh sa`. É IAM, não config do serviço: vale sem redeploy,
mas leva ~1 min para propagar.

**A política da org desliga grants automáticos.** A service account padrão do
Compute não ganha Editor sozinha, e é ela que compila no Cloud Build. O
`setup-gcp.sh` concede os papéis explicitamente na etapa `permitir_build`.

**O comentário do `.env` já virou valor.** O parser não remove `# comentário`
quando o valor está vazio. A `Settings` corta isso hoje, e a checagem de produção
valida **forma** (URL tem que ser `https://` e conter `/worker/`), não presença.

**`SUPABASE_URL` não é segredo, mas some fácil.** Ela não está na lista
`SEGREDOS` do `setup-gcp.sh` (é URL pública), e por isso ficou de fora do
primeiro deploy de produção: sem ela, `current_user()` recusa **todo** JWT do app
e `/internal/import-statement` respondia 401 como se fosse permissão. O `deploy`
passou a lê-la do `$ENV_FILE` e mandá-la em `--set-env-vars`; **produção só
ganha a correção no próximo `./scripts/setup-gcp.sh deploy`.**

**`deploy` e `staging` não são intercambiáveis.** `deploy` mexe em cron e lê os
segredos sem sufixo; `staging` não mexe em cron e usa `SECRET_SUFFIX=-staging`.
Rodar `deploy` com `ENV_FILE=agent/.env.staging` **não** faz o que parece: o
`ENV_FILE` só é lido por `gravar_segredos`, que o `deploy` não chama — o serviço
subiria com o `database-url` de produção.

**Prompt caching não é alavanca.** Mínimo de 4.096 tokens; os prompts por domínio
têm ~800. Não gaste tempo "otimizando" para isso.

**O teto do schema do Gemini é o PRODUTO propriedades × valores de enum**, não
cada um. Medido: `15×22=330` recusa, `9×22=198` passa. Antes de somar campo,
rode `agent/scripts/diagnose_finance_schema.py`.
