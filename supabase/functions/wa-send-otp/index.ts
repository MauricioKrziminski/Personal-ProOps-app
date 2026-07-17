/**
 * Supabase "Send SMS Auth Hook" → entrega o OTP pelo NOSSO WhatsApp (custo ~zero),
 * em vez de um provedor de SMS.
 *
 * O Supabase gera e valida o código nativamente (signInWithOtp/verifyOtp) e apenas
 * DELEGA a entrega para esta função. Assim não precisamos criar sessão na mão.
 *
 * Wiring (Dashboard → Authentication → Hooks → Send SMS, ou Management API):
 *   - URI: https://<ref>.supabase.co/functions/v1/wa-send-otp
 *   - Secret: gere um e coloque em SEND_SMS_HOOK_SECRET (formato v1,whsec_<base64>)
 * Também requer: provedor Phone habilitado + template de Autenticação aprovado na Meta
 * (nome em WA_OTP_TEMPLATE) na WABA dedicada deste app.
 *
 * Assinatura: padrão "standardwebhooks" — HMAC-SHA256 de `${id}.${ts}.${body}`.
 */

import { sendAuthCode } from "../_shared/whatsapp.ts";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verifica a assinatura standardwebhooks do hook do Supabase. */
async function verifyHook(payload: string, headers: Headers, secret: string): Promise<boolean> {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigHeader = headers.get("webhook-signature");
  if (!id || !ts || !sigHeader) return false;

  // secret vem como "v1,whsec_<base64>" (ou só "whsec_<base64>")
  const b64Secret = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(b64Secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${payload}`));
  const expected = bytesToBase64(new Uint8Array(mac));

  // header pode ter várias assinaturas separadas por espaço: "v1,<sig> v1,<sig2>"
  return sigHeader.split(" ").some((part) => {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    return timingSafeEqual(sig, expected);
  });
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("SEND_SMS_HOOK_SECRET");
  if (!secret) return new Response("hook secret ausente", { status: 500 });

  const payload = await req.text();
  const valid = await verifyHook(payload, req.headers, secret);
  if (!valid) return new Response("assinatura inválida", { status: 401 });

  try {
    const { user, sms } = JSON.parse(payload) as {
      user: { phone?: string };
      sms: { otp?: string };
    };
    const phone = user?.phone;
    const otp = sms?.otp;
    if (!phone || !otp) {
      return new Response(JSON.stringify({ error: { message: "phone/otp ausentes" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const template = Deno.env.get("WA_OTP_TEMPLATE") ?? "otp_login";
    await sendAuthCode(phone, otp, template);

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("wa-send-otp:", err);
    // erro estruturado para o Supabase surfaçar
    return new Response(
      JSON.stringify({ error: { http_code: 500, message: String(err) } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
