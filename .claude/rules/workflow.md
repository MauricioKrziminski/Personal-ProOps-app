# Workflow — git, verificação e deploy

## Git

- Commits **conventional, 1 linha, sem corpo e SEM co-autor** (`feat(finance): ...`, `fix(webhook): ...`, `chore: ...`). Único autor: Gabriel.
- **Commit direto na `main` é permitido** (projeto de um dev só). Branch de feature (`<user>/<slug>`) fica opcional, para trabalho longo ou que precise de PR.
- Nunca commitar `.env*` (só `*.example`), `android/`, `ios/`, `agent/.venv/`.

## Antes de commitar

1. `npx tsc --noEmit` limpo.
2. `npx expo lint` limpo.
3. `npm test` verde (`node --test`, sem framework — helpers puros de data/dinheiro do app).

   ⚠️ **Olhe o código de saída, não a contagem.** O resumo do `node --test` tem linhas separadas
   para `pass` e `fail`, e filtrar a saída (`| grep pass`, `| head`) esconde a segunda: em
   09/09/2026 um `pass 329` foi lido como verde com `fail 1` embaixo, e o build da tag quebrou no
   CI. `npm test` já sai diferente de zero quando falha — use isso.
4. **Mudou `agent/` → `.venv/bin/ruff check app --select F,E9` E `.venv/bin/pytest` verdes.**
   Teste que fala com rede ou banco não entra: os nós que falam com o mundo viram dublê.

   **Mexeu em prompt, schema de classificador ou catálogo → `.venv/bin/python
   scripts/evaluate_answer_forms.py` (Gemini real, ~90s).** O pytest usa dublês e
   dublê sempre concorda: essa suíte é a única que diz se a pessoa pode responder do
   jeito dela, e a seção de segurança dela é a que impede que "interpretar melhor"
   vire "aprovou o que não devia".

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

   ⚠️ **A vitrine é para CONFERIR, não para gerar material.** A tira de chips no rodapé é a
   navegação dela e aparece em todo screenshot; e **no iOS a dock não aparece de jeito nenhum**,
   porque `NativeTabs` é a barra do SISTEMA e só existe dentro de um navegador de abas real (no
   Android dá para montar a `CurvedTabBar` à mão, e a vitrine já faz).

   **Para print de divulgação, use o app de verdade no simulador:** `npx expo start --dev-client`,
   `xcrun simctl launch booted com.proops.personal`, e na tela de login o botão **"Entrar como
   teste (dev)"** (`components/auth/email-login-screen.tsx`, só em `__DEV__`) — ele faz
   `signInWithPassword` com `dev@proops.local` no STAGING, que tem dados de demonstração. Sai o
   app inteiro, com dock e sem chrome, e **sem dado financeiro real no print**. O aviso amarelo do
   LogBox some com um toque no X e não existe em release.

   ⚠️ Fixture nova precisa casar a chave EXATA do hook: `useNotesList` é `useInfiniteQuery` (o
   cache guarda `{pages, pageParams}`) e `budgets_status` é consultada com duas chaves diferentes
   (o DIA na Hoje, o MÊS no Financeiro). Chave errada não quebra — cai no estado de erro, em
   silêncio.
6. Mudou o agente → subir local (`docker compose up`) e mandar `scripts/fake_meta.py` com payload
   ASSINADO. Testar com o HMAC desligado esconderia justamente o erro mais caro daquele endpoint.

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
- Edge Functions (legado): `npx supabase functions deploy <nome>`. Hoje só o `whatsapp-webhook`,
  que é o roteador do corte.
- App: builds via EAS (`eas.json`: development/preview/production).
- Fluxo WhatsApp ponta-a-ponta: usar o checklist do comando `/verify-whatsapp`.

## Observabilidade

- Debug do pipeline: `messages_queue` (entrada, fila e erro em `last_error`), `pending_actions` (o
  que espera confirmação), `executed_actions` (o que já rodou), `ai_events` (o que a IA entendeu +
  a contagem que a cota do plano usa), **Langfuse** (trace por nó e tool) e Cloud Logging.
