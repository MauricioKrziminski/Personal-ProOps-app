/**
 * Parsing/categorização com Google Gemini (saída estruturada via responseSchema).
 * Flash para volume; quem chama pode escalar p/ Pro quando a confiança for baixa.
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Aliases "-latest" apontam sempre para o modelo atual — evitam quebra por
// depreciação (ex.: gemini-2.5-flash ficou indisponível para chaves novas).
export const GEMINI_FLASH = "gemini-flash-latest";
export const GEMINI_PRO = "gemini-pro-latest";

export interface ParsedItem {
  type: "note" | "reminder" | "expense" | "unknown";
  title: string | null;
  content: string | null;
  category: string | null;
  amount_cents: number | null;
  currency: string | null;
  spent_at: string | null; // YYYY-MM-DD
  remind_at: string | null; // ISO datetime local do usuário
  recurrence: string | null; // RRULE (ex.: FREQ=MONTHLY;BYMONTHDAY=5)
  confidence: number; // 0..1
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    type: { type: "STRING", enum: ["note", "reminder", "expense", "unknown"] },
    title: { type: "STRING", nullable: true },
    content: { type: "STRING", nullable: true },
    category: { type: "STRING", nullable: true },
    amount_cents: { type: "INTEGER", nullable: true },
    currency: { type: "STRING", nullable: true },
    spent_at: { type: "STRING", nullable: true },
    remind_at: { type: "STRING", nullable: true },
    recurrence: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER" },
  },
  required: ["type", "confidence"],
} as const;

function systemPrompt(nowIso: string, timezone: string): string {
  return `Você é o classificador do Personal ProOps app. O usuário manda mensagens informais em português pelo WhatsApp.
Classifique em exatamente um tipo:
- "expense": menção a gasto/compra/pagamento com valor. Extraia amount_cents (inteiro, centavos: "45 reais" -> 4500), currency (padrão BRL), category (curta e minúscula, ex.: mercado, transporte, lazer, contas, saúde) e spent_at (YYYY-MM-DD; resolva "ontem"/"hoje" pela data atual).
- "reminder": pedido para ser lembrado. Extraia title, remind_at (próxima ocorrência, ISO, no fuso do usuário) e recurrence como RRULE quando recorrente (ex.: "todo dia 5" -> FREQ=MONTHLY;BYMONTHDAY=5; "todo dia às 8h" -> FREQ=DAILY). Sem recorrência -> recurrence null.
- "note": anotação livre. Extraia content (texto limpo) e category curta se óbvia.
- "unknown": não se encaixa. Use confidence baixa.
Data/hora atual: ${nowIso} | Fuso do usuário: ${timezone}.
confidence entre 0 e 1.`;
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
): Promise<{ parsed: ParsedItem; usage: GeminiUsage }> {
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

  const parsed = JSON.parse(raw) as ParsedItem;
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
