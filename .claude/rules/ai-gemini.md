# IA — Gemini (classificação) + Groq (áudio)

**Decisão imutável: a IA do produto é Google Gemini. Nunca usar Claude API.** STT é Groq Whisper.

## Onde vive

- Prompt, `responseSchema` e chamadas: `supabase/functions/_shared/gemini.ts`. Executor das ações: `supabase/functions/process-jobs/index.ts`. Mudança de comportamento da IA = mudar esses dois arquivos, nada de lógica de IA espalhada.

## Regras de chamada

- Endpoint `generateContent` v1beta, `temperature: 0.1`, `responseMimeType: application/json` e **sempre `responseSchema`** — nunca parsear texto livre do modelo.
- Custo: **Flash primeiro** (`GEMINI_FLASH`); se `confidence < 0.6`, refazer com **Pro** (`GEMINI_PRO`). Não inverter, não chamar Pro direto.
- Schema de saída: objeto flat com campos nullable (Gemini structured output lida mal com `anyOf`/union — não usar). Multi-intent = `{ actions: [...], confidence }`, uma ação por item da mensagem, máx. 10.
- Sem segunda chamada de LLM para formatar respostas de consulta — formatação de saída WhatsApp é TS puro (template literals + `centsToBRL`).
- Retry: usar o `fetchWithRetry` existente (backoff em 429/5xx).

## Correção (nunca criar para "consertar")

- Corrigir item existente é `update_transaction` / `delete_item`, nunca um lançamento novo. O prompt diz isso explicitamente.
- Campos de BUSCA (`amount_cents`, `category`, `content`, `occurred_at`) são separados dos de CORREÇÃO (`new_amount_cents`, `new_category`, `new_occurred_at`) — sem isso o modelo confunde "era 45, virou 54".
- `resolveTransactionRef` procura na janela dos 40 mais recentes. **Empate pergunta, não chuta**: alterar o lançamento errado é pior que uma mensagem a mais.

## Auditoria e custo

- **Todo** parse grava linha em `ai_events` (model, tokens, confidence, result jsonb, `created_transaction_ids`) — é a observabilidade do produto (sem Sentry) E a tela "Atividade da IA" do app, que mostra ao usuário o que foi entendido e deixa desfazer.
- Rate limit por usuário antes de chamar o Gemini (contagem em `ai_events` na última hora); estourou → responde "aguarde" e marca o job done.

## Prompt (convenções de conteúdo)

- Português informal BR; datas relativas ("ontem", "todo dia 5") resolvidas pelo modelo usando `nowIso` + timezone do usuário injetados no prompt.
- Categorias: curtas, minúsculas, da lista sugerida (mercado, transporte, lazer, contas, saúde, salário, freela, ...) — texto livre, sem FK.
- Recorrência sempre como **RRULE** (`FREQ=MONTHLY;BYMONTHDAY=5`) — mesmo formato dos reminders.
- Dinheiro sempre `amount_cents` inteiro ("45 reais" → 4500).

## Imagem e PDF (multimodal)

- Foto de cupom, print de Pix e PDF de fatura entram na **mesma** `parseMessage`, com `inline_data` e o **mesmo `responseSchema`** — nunca um segundo prompt só para imagem. Limite de 8MB e MIME na allowlist (`VISION_MIME` no process-jobs).
- Importação de extrato (OFX/CSV) tem prompt próprio e enxuto: `categorizeBatch` manda o lote INTEIRO numa chamada e recebe um array na mesma ordem. Uma chamada por linha seria caro e lento.
- **Regra do usuário ganha da IA**: `_match_rule` roda depois do parse (WhatsApp) e antes do Gemini (importação, economizando chamada). É a resposta à queixa de "categorizou errado e não dá para consertar".

## Áudio

- `message.type === "audio"` → `downloadMedia` (Meta) → `transcribeAudio` (Groq `whisper-large-v3-turbo`, `language=pt`) → texto segue o fluxo normal do Gemini.
