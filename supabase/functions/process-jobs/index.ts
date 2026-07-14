/**
 * Consumidor da fila `jobs` (invocada por pg_cron/pg_net ou manualmente).
 * Para cada job pendente:
 *   1. resolve o usuário pelo telefone (profiles.phone)
 *   2. áudio -> Groq (Whisper) transcreve; texto segue direto
 *   3. Gemini classifica {note | reminder | expense} com responseSchema
 *   4. insere na tabela certa + audita em ai_events
 *   5. confirma pro usuário via WhatsApp (grátis na janela 24h)
 */

import { adminClient } from "../_shared/admin.ts";
import { downloadMedia, sendText } from "../_shared/whatsapp.ts";
import {
  GEMINI_FLASH,
  GEMINI_PRO,
  type ParsedItem,
  parseMessage,
  transcribeAudio,
} from "../_shared/gemini.ts";

const MAX_ATTEMPTS = 3;
const CONFIDENCE_ESCALATE = 0.6;

function centsToBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function confirmationText(parsed: ParsedItem): string {
  switch (parsed.type) {
    case "expense":
      return `💸 Gasto anotado: ${centsToBRL(parsed.amount_cents ?? 0)}` +
        (parsed.category ? ` em *${parsed.category}*` : "") +
        (parsed.spent_at ? ` (${parsed.spent_at})` : "") + ".";
    case "reminder":
      return `⏰ Lembrete criado: *${parsed.title ?? "sem título"}*` +
        (parsed.recurrence ? " (recorrente)" : "") + ".";
    case "note":
      return `📝 Nota salva: ${parsed.content ?? parsed.title ?? ""}`;
    default:
      return "🤔 Não entendi bem. Tenta algo como: \"gastei 45 no mercado\" ou \"me lembra de pagar a conta dia 10\".";
  }
}

async function extractText(message: Record<string, unknown>): Promise<string | null> {
  if (message.type === "text") {
    return (message.text as { body?: string })?.body ?? null;
  }
  if (message.type === "audio") {
    const mediaId = (message.audio as { id?: string })?.id;
    if (!mediaId) return null;
    const blob = await downloadMedia(mediaId);
    return await transcribeAudio(blob);
  }
  return null; // outros tipos (imagem/recibo) ficam para a próxima fase
}

async function persistItem(
  supabase: ReturnType<typeof adminClient>,
  userId: string,
  timezone: string,
  parsed: ParsedItem,
): Promise<boolean> {
  if (parsed.type === "expense" && parsed.amount_cents) {
    const { error } = await supabase.from("expenses").insert({
      user_id: userId,
      amount_cents: parsed.amount_cents,
      currency: parsed.currency ?? "BRL",
      category: parsed.category,
      description: parsed.content ?? parsed.title,
      spent_at: parsed.spent_at ?? new Date().toISOString().slice(0, 10),
      source: "whatsapp",
    });
    return !error;
  }
  if (parsed.type === "reminder" && (parsed.remind_at || parsed.recurrence)) {
    const { error } = await supabase.from("reminders").insert({
      user_id: userId,
      title: parsed.title ?? parsed.content ?? "Lembrete",
      recurrence: parsed.recurrence,
      next_run_at: parsed.remind_at ?? new Date().toISOString(),
      timezone,
      channel: "both",
      source: "whatsapp",
    });
    return !error;
  }
  if (parsed.type === "note") {
    const { error } = await supabase.from("notes").insert({
      user_id: userId,
      content: parsed.content ?? parsed.title ?? "",
      category: parsed.category,
      source: "whatsapp",
    });
    return !error;
  }
  return false;
}

Deno.serve(async (_req) => {
  const supabase = adminClient();

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at")
    .limit(10);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let done = 0;
  for (const job of jobs ?? []) {
    await supabase
      .from("jobs")
      .update({ status: "processing", attempts: job.attempts + 1 })
      .eq("id", job.id);

    const { phone, message, message_raw_id } = job.payload as {
      phone: string;
      message: Record<string, unknown>;
      message_raw_id: string;
    };

    try {
      // 1. resolve usuário pelo telefone
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, timezone")
        .eq("phone", phone)
        .maybeSingle();

      if (!profile) {
        await sendText(
          phone,
          "👋 Ainda não encontrei sua conta. Baixe o app ProOps e cadastre-se com este número para começar!",
        );
        await supabase.from("jobs").update({ status: "done", processed_at: new Date().toISOString() }).eq("id", job.id);
        continue;
      }

      // 2. texto (transcreve áudio se preciso)
      const text = await extractText(message);
      if (!text) {
        await sendText(phone, "🙈 Por enquanto só entendo texto e áudio. Em breve, fotos de recibo!");
        await supabase.from("jobs").update({ status: "done", processed_at: new Date().toISOString() }).eq("id", job.id);
        continue;
      }

      // 3. Gemini Flash; escala p/ Pro se a confiança for baixa
      let { parsed, usage } = await parseMessage(text, profile.timezone, GEMINI_FLASH);
      if (parsed.confidence < CONFIDENCE_ESCALATE) {
        ({ parsed, usage } = await parseMessage(text, profile.timezone, GEMINI_PRO));
      }

      await supabase.from("ai_events").insert({
        user_id: profile.id,
        message_raw_id,
        model: usage.model,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        confidence: parsed.confidence,
        result: parsed,
      });

      // 4. persiste
      await persistItem(supabase, profile.id, profile.timezone, parsed);

      // 5. confirma (grátis na janela 24h)
      await sendText(phone, confirmationText(parsed));

      await supabase.from("jobs").update({ status: "done", processed_at: new Date().toISOString() }).eq("id", job.id);
      done++;
    } catch (err) {
      const failed = job.attempts + 1 >= MAX_ATTEMPTS;
      await supabase
        .from("jobs")
        .update({ status: failed ? "failed" : "pending", last_error: String(err) })
        .eq("id", job.id);
      console.error(`job ${job.id}:`, err);
    }
  }

  return new Response(JSON.stringify({ processed: done, total: jobs?.length ?? 0 }), {
    headers: { "Content-Type": "application/json" },
  });
});
