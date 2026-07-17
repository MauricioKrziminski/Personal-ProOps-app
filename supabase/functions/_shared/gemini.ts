/**
 * Parsing/categorização com Google Gemini (saída estruturada via responseSchema).
 * Flash para volume; quem chama pode escalar p/ Pro quando a confiança for baixa.
 *
 * Multi-intent: uma mensagem pode virar VÁRIAS ações (lista de gastos, gasto +
 * lembrete, consulta + nota...). O schema é um objeto flat único por ação —
 * Gemini structured output lida mal com anyOf/union; campos não usados = null.
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Aliases "-latest" apontam sempre para o modelo atual — evitam quebra por
// depreciação (ex.: gemini-2.5-flash ficou indisponível para chaves novas).
export const GEMINI_FLASH = "gemini-flash-latest";
export const GEMINI_PRO = "gemini-pro-latest";

export const SUGGESTED_CATEGORIES = [
  "mercado", "transporte", "lazer", "contas", "saúde", "casa",
  "educação", "assinaturas", "restaurante", "salário", "freela", "outros",
] as const;

export type AiActionType =
  | "create_expense"
  | "create_income"
  | "create_transfer"
  | "create_note"
  | "create_reminder"
  | "create_goal"
  | "goal_deposit"
  | "query_balance"
  | "query_transactions"
  | "query_budgets"
  | "query_goals"
  | "undo_last"
  | "unknown";

export interface AiAction {
  type: AiActionType;
  // criação
  title: string | null;
  content: string | null;
  category: string | null;
  amount_cents: number | null; // inteiro em centavos
  currency: string | null;
  occurred_at: string | null; // YYYY-MM-DD
  remind_at: string | null; // ISO datetime local do usuário
  recurrence: string | null; // RRULE (ex.: FREQ=MONTHLY;BYMONTHDAY=5)
  account: string | null; // nome livre da conta citada
  counterparty_account: string | null; // conta destino (transfer)
  goal_name: string | null;
  target_cents: number | null;
  deadline: string | null; // YYYY-MM-DD
  // consulta
  query_from: string | null; // YYYY-MM-DD
  query_to: string | null; // YYYY-MM-DD
  query_kind: "expense" | "income" | null;
  query_category: string | null;
}

export interface AiResult {
  actions: AiAction[];
  confidence: number; // 0..1, da mensagem inteira
}

const ACTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    type: {
      type: "STRING",
      enum: [
        "create_expense", "create_income", "create_transfer", "create_note",
        "create_reminder", "create_goal", "goal_deposit", "query_balance",
        "query_transactions", "query_budgets", "query_goals", "undo_last", "unknown",
      ],
    },
    title: { type: "STRING", nullable: true },
    content: { type: "STRING", nullable: true },
    category: { type: "STRING", nullable: true },
    amount_cents: { type: "INTEGER", nullable: true },
    currency: { type: "STRING", nullable: true },
    occurred_at: { type: "STRING", nullable: true },
    remind_at: { type: "STRING", nullable: true },
    recurrence: { type: "STRING", nullable: true },
    account: { type: "STRING", nullable: true },
    counterparty_account: { type: "STRING", nullable: true },
    goal_name: { type: "STRING", nullable: true },
    target_cents: { type: "INTEGER", nullable: true },
    deadline: { type: "STRING", nullable: true },
    query_from: { type: "STRING", nullable: true },
    query_to: { type: "STRING", nullable: true },
    query_kind: { type: "STRING", enum: ["expense", "income"], nullable: true },
    query_category: { type: "STRING", nullable: true },
  },
  required: ["type"],
} as const;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    actions: { type: "ARRAY", items: ACTION_SCHEMA, maxItems: 10 },
    confidence: { type: "NUMBER" },
  },
  required: ["actions", "confidence"],
} as const;

function systemPrompt(nowIso: string, timezone: string): string {
  return `Você é o assistente do Personal ProOps app. O usuário manda mensagens informais em português pelo WhatsApp.
A mensagem pode conter VÁRIOS itens — emita UMA ação por item, na ordem em que aparecem (máx. 10).
Ex.: "mercado 200, uber 30 e recebi 500 de freela" -> 3 ações (2 create_expense + 1 create_income).

Tipos de ação:
- "create_expense": gasto/compra/pagamento com valor. amount_cents (inteiro em centavos: "45 reais" -> 4500), currency (padrão BRL), category (curta, minúscula, preferindo: ${SUGGESTED_CATEGORIES.join(", ")}), occurred_at (YYYY-MM-DD; resolva "ontem"/"hoje" pela data atual), description em content. Se citar a conta/cartão ("no nubank"), preencha account. Se for recorrente ("todo mês"), preencha recurrence como RRULE.
- "create_income": dinheiro recebido ("recebi", "caiu o salário", "me pagaram"). Mesmos campos do expense (category ex.: salário, freela).
- "create_transfer": mover dinheiro entre contas próprias ("passei 200 da corrente pra poupança"). account = origem, counterparty_account = destino.
- "create_note": anotação livre. content (texto limpo) e category curta se óbvia.
- "create_reminder": pedido para ser lembrado. title, remind_at (próxima ocorrência, ISO, no fuso do usuário) e recurrence como RRULE quando recorrente ("todo dia 5" -> FREQ=MONTHLY;BYMONTHDAY=5; "todo dia às 8h" -> FREQ=DAILY). Sem recorrência -> null.
- "create_goal": meta de poupança ("quero juntar 5000 até dezembro pra viagem"). goal_name, target_cents, deadline (YYYY-MM-DD ou null).
- "goal_deposit": aporte em meta existente ("coloca 200 na meta da viagem"). goal_name, amount_cents.
- "query_balance": pergunta sobre saldo/quanto tem ("quanto tenho?", "saldo das contas").
- "query_transactions": pergunta sobre gastos/receitas ("quanto gastei esse mês?", "gastos com mercado em junho"). query_from/query_to (YYYY-MM-DD, resolva "esse mês"/"semana passada" pela data atual), query_kind (expense/income/null p/ ambos), query_category se citada.
- "query_budgets": pergunta sobre orçamento/limite ("como tá meu orçamento?").
- "query_goals": pergunta sobre metas ("como tão minhas metas?").
- "undo_last": desfazer o último lançamento ("apaga o último", "foi engano").
- "unknown": não se encaixa em nada.

Regras:
- Dinheiro SEMPRE em centavos inteiros. "1.234,56" -> 123456.
- Datas relativas resolvidas com a data/hora atual: ${nowIso} | Fuso do usuário: ${timezone}.
- Campos que não se aplicam à ação: null.
- confidence (0..1) é da interpretação da mensagem INTEIRA.`;
}

export interface GeminiUsage {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** fetch com retry + backoff para erros transitórios (503 high demand, 429 rate limit, 5xx). */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, options);
    if (res.ok) return res;
    const transient = res.status === 429 || res.status >= 500;
    if (transient && attempt < retries) {
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt))); // 0.5s, 1s, 2s
      continue;
    }
    return res;
  }
}

export async function parseMessage(
  text: string,
  timezone: string,
  model: string = GEMINI_FLASH,
): Promise<{ parsed: AiResult; usage: GeminiUsage }> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY ausente");

  const res = await fetchWithRetry(`${GEMINI_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt(new Date().toISOString(), timezone) }],
      },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini falhou (${res.status}): ${body}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini retornou resposta vazia");

  const parsed = JSON.parse(raw) as AiResult;
  if (!Array.isArray(parsed.actions)) throw new Error("Gemini retornou shape inesperado (sem actions)");
  return {
    parsed,
    usage: {
      model,
      inputTokens: data?.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data?.usageMetadata?.candidatesTokenCount ?? null,
    },
  };
}

/** Transcreve áudio com Groq (Whisper) antes de mandar o texto pro Gemini. */
export async function transcribeAudio(audio: Blob, filename = "audio.ogg"): Promise<string> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY ausente");

  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "pt");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq falhou (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.text as string;
}
