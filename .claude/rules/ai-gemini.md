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

## Auditoria e custo

- **Todo** parse grava linha em `ai_events` (model, tokens, confidence, result jsonb) — é a observabilidade do produto (sem Sentry).
- Rate limit por usuário antes de chamar o Gemini (contagem em `ai_events` na última hora); estourou → responde "aguarde" e marca o job done.

## Prompt (convenções de conteúdo)

- Português informal BR; datas relativas ("ontem", "todo dia 5") resolvidas pelo modelo usando `nowIso` + timezone do usuário injetados no prompt.
- Categorias: curtas, minúsculas, da lista sugerida (mercado, transporte, lazer, contas, saúde, salário, freela, ...) — texto livre, sem FK.
- Recorrência sempre como **RRULE** (`FREQ=MONTHLY;BYMONTHDAY=5`) — mesmo formato dos reminders.
- Dinheiro sempre `amount_cents` inteiro ("45 reais" → 4500).

## Áudio

- `message.type === "audio"` → `downloadMedia` (Meta) → `transcribeAudio` (Groq `whisper-large-v3-turbo`, `language=pt`) → texto segue o fluxo normal do Gemini.
