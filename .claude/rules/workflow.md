# Workflow — git, verificação e deploy

## Git

- Commits **conventional, 1 linha, sem corpo e SEM co-autor** (`feat(finance): ...`, `fix(webhook): ...`, `chore: ...`). Único autor: Gabriel.
- **Commit direto na `main` é permitido** (projeto de um dev só). Branch de feature (`<user>/<slug>`) fica opcional, para trabalho longo ou que precise de PR.
- Nunca commitar `.env*` (só `*.example`), `android/`, `ios/`, `agent/.venv/`.

## Antes de commitar

1. `npx tsc --noEmit` limpo.
2. `npx expo lint` limpo.
3. `npm test` verde (`node --test`, sem framework — helpers puros de data/dinheiro do app).
4. **Mudou `agent/` → `.venv/bin/pytest` verde.** Teste que fala com rede ou banco não entra: os
   nós que falam com o mundo viram dublê.
5. Mudou tela → conferir no device/emulador — nada de "deve funcionar".

   **As quatro raízes de aba se olham sem login**, pela rota `design-preview`: ela monta as telas
   REAIS com o cache do TanStack pré-semeado, então nenhum `queryFn` roda. Sem ela, ver a Hoje ou
   o Financeiro exigia o OTP que chega no WhatsApp do dono do número — e foi por isso que essas
   telas já foram entregues erradas duas vezes.

   O caminho é temporário de propósito (a rota não tem link em lugar nenhum e desenha vazio fora
   do `__DEV__`): trocar o destino do `Redirect` em `src/app/index.tsx` por `/design-preview`,
   olhar, e desfazer. Cada `terminate` + `launch` avança um passo (aba × faixa vertical), o que
   torna `xcrun simctl io booted screenshot` uma sequência determinística — não existe gesto de
   rolagem por linha de comando, então a tela é montada inteira e deslocada por `translateY`.

   ⚠️ Fixture nova precisa casar a chave EXATA do hook: `useNotesList` é `useInfiniteQuery` (o
   cache guarda `{pages, pageParams}`) e `budgets_status` é consultada com duas chaves diferentes
   (o DIA na Hoje, o MÊS no Financeiro). Chave errada não quebra — cai no estado de erro, em
   silêncio.
6. Mudou o agente → subir local (`docker compose up`) e mandar `scripts/fake_meta.py` com payload
   ASSINADO. Testar com o HMAC desligado esconderia justamente o erro mais caro daquele endpoint.
7. Mudou schema → migration nova aplicada com `db push` + types regenerados. Mexeu em `0040`/`0041`
   ou nas tabelas do agente → rodar `supabase/tests/agent_migrations.sql` contra o Postgres local
   (as asserções cobrem upsert de sessão, claim do lote, HITL e idempotência).

## Deploy

- Agente: `./scripts/setup-gcp.sh` (idempotente — projeto, APIs, service account, segredos, fila do
  Cloud Tasks, deploy e crons). `deploy` sozinho para redeploy. Secrets no GCP Secret Manager;
  `agent/.env.example` é a lista.
- Edge Functions (legado): `npx supabase functions deploy <nome>`. Hoje só o `whatsapp-webhook`,
  que é o roteador do corte.
- App: builds via EAS (`eas.json`: development/preview/production).
- Fluxo WhatsApp ponta-a-ponta: usar o checklist do comando `/verify-whatsapp`.

## Observabilidade

- Debug do pipeline: `messages_queue` (entrada, fila e erro em `last_error`), `pending_actions` (o
  que espera confirmação), `executed_actions` (o que já rodou), `ai_events` (o que a IA entendeu +
  a contagem que a cota do plano usa), **Langfuse** (trace por nó e tool) e Cloud Logging.
