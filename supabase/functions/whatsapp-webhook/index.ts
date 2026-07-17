/**
 * Webhook da Meta WhatsApp Cloud API.
 * GET  -> verificação inicial (hub.verify_token)
 * POST -> valida HMAC, dedupe por wa_message_id, grava messages_raw,
 *         enfileira job e responde 200 IMEDIATAMENTE (<5s ou a Meta reenvia).
 * O trabalho pesado (IA, inserts, confirmação) roda na função process-jobs.
 */

import { adminClient } from "../_shared/admin.ts";
import { verifySignature } from "../_shared/whatsapp.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // --- verificação do webhook (feita uma vez, no painel da Meta) ---
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === Deno.env.get("WHATSAPP_VERIFY_TOKEN")) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  // --- assinatura HMAC obrigatória ---
  const rawBody = await req.text();
  const valid = await verifySignature(rawBody, req.headers.get("x-hub-signature-256"));
  if (!valid) {
    return new Response("invalid signature", { status: 401 });
  }

  const supabase = adminClient();

  let enqueued = 0;
  try {
    const body = JSON.parse(rawBody);
    const messages: unknown[] = [];

    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        for (const message of change?.value?.messages ?? []) {
          messages.push(message);
        }
      }
    }

    for (const message of messages as Array<Record<string, unknown>>) {
      const waMessageId = message.id as string;
      const phone = message.from as string;

      // idempotência: a Meta reenvia webhooks; unique em wa_message_id
      const { data: inserted, error } = await supabase
        .from("messages_raw")
        .insert({
          wa_message_id: waMessageId,
          direction: "inbound",
          phone,
          message_type: message.type,
          payload: message,
        })
        .select("id")
        .maybeSingle();

      if (error) {
        // 23505 = duplicado -> já processado, ignora silenciosamente
        if (error.code !== "23505") console.error("messages_raw insert:", error);
        continue;
      }

      const { error: jobError } = await supabase.from("jobs").insert({
        type: "process_message",
        payload: { message_raw_id: inserted!.id, phone, message },
      });
      if (jobError) console.error("jobs insert:", jobError);
      else enqueued++;
    }
  } catch (err) {
    // nunca devolver erro à Meta por falha interna — logar e seguir
    console.error("webhook error:", err);
  }

  // Dispara o processamento AGORA (fire-and-forget) para resposta quase instantânea;
  // o cron continua como rede de segurança. Não bloqueia o 200 para a Meta.
  if (enqueued > 0) {
    const fnUrl = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (fnUrl && anon) {
      const trigger = fetch(`${fnUrl}/functions/v1/process-jobs`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${anon}`, "Content-Type": "application/json" },
        body: "{}",
      }).catch((e) => console.error("trigger process-jobs:", e));
      const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
      rt?.waitUntil?.(trigger);
    }
  }

  // sempre 200 rápido: reentregas são tratadas pela idempotência acima
  return new Response("ok", { status: 200 });
});
