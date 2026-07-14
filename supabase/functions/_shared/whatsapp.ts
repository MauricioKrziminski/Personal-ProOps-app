/**
 * Helpers da Meta WhatsApp Cloud API:
 * - verificação da assinatura HMAC (X-Hub-Signature-256) do webhook
 * - envio de mensagens (texto livre na janela 24h; template p/ proativas)
 */

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

/** Valida X-Hub-Signature-256 = "sha256=<hmac do body com o app secret>". */
export async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = "sha256=" +
    Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  // comparação em tempo constante
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(signatureHeader);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function graphPost(payload: Record<string, unknown>): Promise<Response> {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) {
    throw new Error("WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID ausentes");
  }
  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp send falhou (${res.status}): ${body}`);
  }
  return res;
}

/** Texto livre — grátis dentro da janela de 24h iniciada pelo usuário. */
export function sendText(to: string, body: string) {
  return graphPost({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  });
}

/** Template Utility — para mensagens proativas (lembretes) fora da janela 24h. */
export function sendTemplate(
  to: string,
  templateName: string,
  bodyParams: string[],
  language = "pt_BR",
) {
  return graphPost({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      components: bodyParams.length
        ? [{
          type: "body",
          parameters: bodyParams.map((text) => ({ type: "text", text })),
        }]
        : [],
    },
  });
}

/** Baixa uma mídia recebida (ex.: áudio) a partir do media id da Meta. */
export async function downloadMedia(mediaId: string): Promise<Blob> {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const metaRes = await fetch(`${GRAPH_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`Media metadata falhou (${metaRes.status})`);
  const { url } = await metaRes.json();
  const fileRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!fileRes.ok) throw new Error(`Media download falhou (${fileRes.status})`);
  return await fileRes.blob();
}
