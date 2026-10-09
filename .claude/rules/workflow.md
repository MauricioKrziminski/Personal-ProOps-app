# Workflow — git, verificação e deploy

## Git

- Commits **conventional, 1 linha, sem corpo e SEM co-autor** (`feat(finance): ...`, `fix(webhook): ...`, `chore: ...`). Único autor: Gabriel.
- **Commit direto na `main` é permitido** (projeto de um dev só). Branch de feature (`<user>/<slug>`) fica opcional, para trabalho longo ou que precise de PR.
- Nunca commitar `.env*` (só `*.example`), `android/`, `ios/`, `agent/.venv/`.

## Antes de commitar

1. `npx tsc --noEmit` limpo.
2. `npx expo lint` limpo.
3. `npm test` verde (`node --test`, sem framework — helpers puros de data/dinheiro do app).

   **Olhe o código de saída, não a contagem.** O resumo do `node --test` tem linhas separadas
   para `pass` e `fail`, e filtrar a saída (`| grep pass`, `| head`) esconde a segunda: em
   09/09/2026 um `pass 329` foi lido como verde com `fail 1` embaixo, e o build da tag quebrou no
   CI. `npm test` já sai diferente de zero quando falha — use isso.
4. **Mudou `agent/` → `.venv/bin/ruff check app --select F,E9` E `.venv/bin/pytest` verdes.**
   Teste que fala com rede ou banco não entra: os nós que falam com o mundo viram dublê.

   **Mexeu em prompt, schema de classificador ou catálogo → avaliação com modelo real, SÓ da
   parte mexida** (decisão do dono do produto, 06/10/2026: *"rodar o teste somente daquela parte
   que mexeu e garantir que não houve regressão, só rodar o teste completo quando for preciso"*).
   Ela não roda no CI: cada commit pagaria a suíte inteira por uma mudança que toca uma seção.

   - **A parte:** `evaluate_answer_forms.py --secao <pedaço do nome>` (casa por pedaço:
     `notas`, `cadastro`, `escolha`, `corrigir`, `loteB/guardar`…; a lista é `secoes()`) e, para
     roteamento e histórico de conversa, `evaluate_conversation_understanding.py --cases <ids>`.
     Rode a seção ANTES de mexer (a linha de base) e depois: regressão é caso que passava e deixou
     de passar. As suítes rodam no Gemini GRATUITO (`IA_PROVEDOR=gemini`, os scripts põem
     sozinhos; o crédito do Claude fica para o tráfego). Enquanto itera, `--barato` (gate no Lite).
   - **Mexeu no portão do SIM** (`domain/confirm.py`, prompt/schema do gate, `policy.py`) → também
     `--secao segurança --gate-producao --teto-usd 1`, **sem `--barato`**: aprova quem roda no
     modelo de PRODUÇÃO do portão (Claude Sonnet), e só essa rodada gasta crédito da Anthropic.
   - **Suíte INTEIRA só quando a mudança alcança todas as seções:** modelo de um papel
     (`services/gemini.py`, `GEMINI_MODEL_*`/`GEMINI_THINKING_*`), prompt do roteador ou bloco
     comum dos prompts, campo ou ORDEM de campo de um schema compartilhado (`FinanceAction`: a
     ordem mudou o resultado de três costuras diferentes em 06/10/2026), troca de versão de prompt
     (`AGENT_PROMPT_V2`). Uma vez, no fim, sem flag.
   - Caso que não mudou sai do cache (`agent/.eval-cache`, chave = caso + hash de prompts, schemas
     e modelos): repetir a seção custa só o que mudou. Com chave paga, sempre `--teto-usd`.
   - Para VER a rodada (caso a caso, comparada com a anterior, com custo): `--langfuse`. Ela vira
     um experimento no Langfuse (`ai-gemini.md`). Saída 3 = a rodada não chamou o modelo (cota):
     o resultado não vale, mesmo que diga "passou". (Rodada SÓ de caso sem modelo — "sim", "ok" —
     também sai 3; é o preço de a trava ser por rodada, não por caso. Não "conserte" a trava por isso.)

   O pytest usa dublês e dublê sempre concorda: essa suíte é a única que diz se a pessoa pode
   responder do jeito dela, e a seção de segurança é a que impede que "interpretar melhor" vire
   "aprovou o que não devia". Custo e cota em `ai-gemini.md`.

   O `ruff` entrou em 07/09/2026 porque o pytest não pega tudo: `nodes.py` usava `guards.` sem ter
   importado o módulo, e em produção isso virava `NameError` — o app respondia "Não consegui
   processar essa mensagem" para QUALQUER compra parcelada. O teste que existia chamava as funções
   direto de `guards`, então elas estavam cobertas e o caminho que as usa não estava. `F821`
   (nome não definido) custa 200ms e pega essa classe inteira.
5. Mudou tela → conferir no device/emulador — nada de "deve funcionar".

   **As cinco raízes de aba se olham sem login**, pela rota `design-preview`: ela monta as telas
   REAIS com o cache do TanStack pré-semeado, então nenhum `queryFn` roda. Sem ela, ver a Hoje ou
   o Financeiro exigia o OTP que chega no WhatsApp do dono do número — e foi por isso que essas
   telas já foram entregues erradas duas vezes.

   O caminho é temporário de propósito (a rota não tem link em lugar nenhum e desenha vazio fora
   do `__DEV__`): trocar o destino do `Redirect` em `src/app/index.tsx` por `/design-preview`,
   olhar, e desfazer. Cada `terminate` + `launch` avança um passo (aba × faixa vertical), o que
   torna `xcrun simctl io booted screenshot` uma sequência determinística — não existe gesto de
   rolagem por linha de comando, então a tela é montada inteira e deslocada por `translateY`.

   **A vitrine é para CONFERIR, não para gerar material.** **No iOS a dock não aparece de jeito
   nenhum**,
   porque `NativeTabs` é a barra do SISTEMA e só existe dentro de um navegador de abas real (no
   Android dá para montar a `PillTabBar` à mão, e a vitrine já faz).

   **Para print de divulgação, use o app de verdade no simulador:** `npx expo start --dev-client`,
   `xcrun simctl launch booted com.proops.personal`, e na tela de login o botão **"Entrar como
   teste (dev)"** (`components/auth/email-login-screen.tsx`, só em `__DEV__`) — ele faz
   `signInWithPassword` com `dev@proops.local` no STAGING, que tem dados de demonstração. Sai o
   app inteiro, com dock e sem chrome, e **sem dado financeiro real no print**. O aviso amarelo do
   LogBox some com um toque no X e não existe em release.

   Fixture nova precisa casar a chave EXATA do hook: `useNotesList` é `useInfiniteQuery` (o
   cache guarda `{pages, pageParams}`) e `budgets_status` é consultada com duas chaves diferentes
   (o DIA na Hoje, o MÊS no Financeiro). Chave errada não quebra — cai no estado de erro, em
   silêncio.
6. Mudou o agente → subir local (`docker compose up`) e mandar `scripts/fake_meta.py` com payload
   ASSINADO. Testar com o HMAC desligado esconderia justamente o erro mais caro daquele endpoint.

   **Suba com o override de não-envio, senão o teste manda WhatsApp de verdade.** O telefone
   do staging é o número REAL do Gabriel, e o agente responde no fim do caminho:
   `docker compose -f docker-compose.yml -f docker-compose.sem-envio.yml up`. O override só troca
   o `WHATSAPP_TOKEN` por um inválido — `try_send` é best-effort, então a resposta para no log e
   todo o resto (HMAC, fila, debounce, grafo, escrita) continua real.

   **`agent/.env` é o STAGING** (desde 04/09/2026); produção mora em `agent/.env.production`.
   O padrão tem que ser o staging porque nada que lê `.env` escolhe ambiente — `docker compose
   up`, o `env_file=".env"` do pydantic e um `source` no terminal pegam o que estiver lá. Enquanto
   `.env` era produção, este passo 6 ligava o agente local no banco REAL sem avisar.
7. Mudou schema → **`scripts/supabase-target.sh` para confirmar o alvo**, migration nova aplicada
   no STAGING com `db push` + types regenerados. Produção (`kwriuifcwyvdrxtspjiz`) só com pedido
   explícito do Gabriel. Mexeu em `0040`/`0041`
   ou nas tabelas do agente → rodar `supabase/tests/agent_migrations.sql` contra o Postgres local
   (as asserções cobrem upsert de sessão, claim do lote, HITL e idempotência).

## Deploy

- Agente: `./scripts/setup-gcp.sh staging` para o staging e `./scripts/setup-gcp.sh` (idempotente
  — projeto, APIs, service account, segredos, fila do Cloud Tasks, deploy e crons) para produção.
  `deploy` sozinho para redeploy. Secrets no GCP Secret Manager; `agent/.env.example` é a lista.

  **Produção pede confirmação**: os subcomandos que escrevem (`tudo`, `deploy`, `secrets`, `sa`,
  `build-iam`) param e exigem que você digite `PRODUCAO`, ou `PROOPS_PROD_OK=1` — a MESMA saída de
  emergência do hook do Supabase, para não haver duas convenções. `staging` passa direto. Sem isso,
  `./scripts/setup-gcp.sh` sem argumento nenhum fazia deploy em produção sem perguntar nada.
- Edge Functions: **não existem mais** (09/09/2026). Não há o que deployar; o que era delas é
  rota do agente.
- App: builds via EAS (`eas.json`: development/preview/staging/distribution/production).

  **A TAG é o build — não são dois passos.** `publish-android-release.yml` dispara em
  `push` de tag `v*`: compila o APK, confere a assinatura contra `EXPECTED_SIGNER_SHA256` e
  publica a release (APK + `update.json` + `native-compatibility.json`) no repositório de
  distribuição. Ninguém roda `eas build` à mão para soltar versão. Leva ~10 min.

  A receita é sempre a mesma: portão verde (`tsc`, `lint`, `npm test`, `ruff`, `pytest`) →
  `app.json.version` para a nova (PATCH, MINOR ou MAJOR: a tabela do `CLAUDE.md`, *Versão, build,
  release e OTA*) → commit `chore: vX.Y.Z` → `push origin main` → tag LEVE nesse
  commit → `push origin vX.Y.Z`.

  **`runtimeVersion.policy` é `appVersion`, então bump de versão FECHA a porta do OTA.** Um
  update publicado como 1.3.31 não alcança quem está em 1.3.30 — para isso existe
  `publish-android-ota.yml`, que é `workflow_dispatch` e recebe a `native_tag` de uma nativa já
  publicada. Mudança só de JS sem bump = OTA; com bump = build.
- Fluxo WhatsApp ponta-a-ponta: usar o checklist do comando `/verify-whatsapp`.

## Observabilidade

- Debug do pipeline: `messages_queue` (entrada, fila e erro em `last_error`), `pending_actions` (o
  que espera confirmação), `executed_actions` (o que já rodou), `ai_events` (o que a IA entendeu +
  a contagem que a cota do plano usa), **Langfuse** (trace por nó e tool) e Cloud Logging.
