/**
 * Webhook da Meta WhatsApp Cloud API.
 * GET  -> verificação inicial (hub.verify_token)
 * POST -> valida HMAC, dedupe por wa_message_id, grava messages_raw,
 *         enfileira job e responde 200 IMEDIATAMENTE (<5s ou a Meta reenvia).
 *
 * ── MIGRAÇÃO (Strangler Fig) ──────────────────────────────────────────────
 * Enquanto o agente Python (Cloud Run) não atende todo mundo, esta função é
 * TAMBÉM o roteador: para telefone com `agent_routing.use_python_agent = true`,
 * ela repassa o corpo CRU e a assinatura para o Cloud Run em vez de enfileirar
 * aqui. Rollback é um update numa linha.
 *
 * Quando o repasse falha, a decisão NÃO é óbvia e as duas saídas ingênuas
 * quebram coisa:
 *
 *   (a) Cair no fluxo antigo sempre. Se a conversa está esperando "SIM" no
 *       Python, o fluxo daqui não sabe que uma pergunta foi feita e grava "sim"
 *       como nota — a ação confirmada nunca acontece. E se o Python já tinha
 *       enfileirado a mensagem (só a resposta HTTP falhou), processar aqui
 *       DUPLICA o lançamento: as duas filas usam tabelas diferentes e o dedupe
 *       de uma não enxerga a outra.
 *
 *   (b) Devolver erro sempre. A Meta reentrega, mas o usuário espera.
 *
 * O que esta função faz é o meio-termo seguro: cai para o fluxo antigo SÓ
 * quando as duas condições valem — nenhuma confirmação pendente para o telefone
 * E a mensagem ainda não está na fila do Python. Fora disso, devolve 503 e
 * deixa a Meta reentregar, que é lento mas nunca corrompe.
 */

import { adminClient } from "../_shared/admin.ts";
import { verifySignature } from "../_shared/whatsapp.ts";

type Admin = ReturnType<typeof adminClient>;

/** Timeout do repasse. Curto de propósito: a Meta corta em 5s. */
const PROXY_TIMEOUT_MS = 3_000;

/**
 * O fallback só é seguro quando o agente Python escreve NESTE MESMO banco.
 *
 * `fallbackSeguro` decide olhando `messages_queue` e `pending_actions` pelo
 * admin client DESTA function — ou seja, o banco de produção. Apontando
 * `PYTHON_AGENT_URL` para o serviço de STAGING, o Python grava no banco de
 * staging e as duas checagens consultam o lugar errado: elas nunca encontram
 * nada e sempre respondem "pode cair para o fluxo antigo". Resultado: qualquer
 * falha do repasse (timeout de cold start, deploy, 5xx) manda a mensagem para o
 * fluxo Deno, que a grava em PRODUÇÃO — exatamente a corrupção que o fallback
 * existe para evitar, com o agravante de ser silenciosa.
 *
 * Por isso, enquanto o alvo for staging: PYTHON_AGENT_FALLBACK=off.
 * Aí falha de repasse vira 503 e a Meta reentrega, que é lento e correto.
 * Sem a variável, o comportamento é o de produção (fallback condicional ligado).
 */
const FALLBACK_LIGADO = Deno.env.get("PYTHON_AGENT_FALLBACK") !== "off";

interface Mensagem {
  id?: string;
  from?: string;
  type?: string;
}

/** Primeira mensagem do payload — é dela que sai o telefone do roteamento. */
function primeiraMensagem(body: unknown): Mensagem | null {
  const entry = (body as { entry?: unknown[] })?.entry?.[0] as
    | { changes?: { value?: { messages?: Mensagem[] } }[] }
    | undefined;
  return entry?.changes?.[0]?.value?.messages?.[0] ?? null;
}

/**
 * É seguro processar esta mensagem no fluxo ANTIGO depois de o Python falhar?
 * Só quando nada dela já entrou lá e nenhuma confirmação está aberta.
 */
async function fallbackSeguro(
  supabase: Admin,
  phone: string,
  waMessageId: string,
): Promise<boolean> {
  const [naFila, pendente] = await Promise.all([
    supabase.from("messages_queue").select("id").eq("wa_message_id", waMessageId).maybeSingle(),
    supabase.from("pending_actions").select("id").eq("phone", phone).eq("status", "awaiting")
      .maybeSingle(),
  ]);

  if (naFila.data) {
    console.warn(`fallback bloqueado: ${waMessageId} já está na fila do Python`);
    return false;
  }
  if (pendente.data) {
    console.warn(`fallback bloqueado: ${phone} tem confirmação aberta`);
    return false;
  }
  return true;
}

/**
 * Repassa para o Cloud Run quando o telefone está na flag.
 * - Response  -> a requisição terminou aqui (repasse ok, ou 503 para reentrega)
 * - null      -> segue no fluxo antigo nesta mesma requisição
 */
async function rotearParaPython(
  supabase: Admin,
  pythonUrl: string,
  rawBody: string,
  headers: Headers,
): Promise<Response | null> {
  const mensagem = primeiraMensagem(safeParse(rawBody));
  const telefone = mensagem?.from;
  const waMessageId = mensagem?.id;
  if (!telefone || !waMessageId) return null; // status update, reaction, etc.

  const { data, error } = await supabase.rpc("routes_to_python", { p_phone: telefone });
  if (error) {
    console.error("routes_to_python:", error);
    return null; // na dúvida, fluxo antigo — é o que está em produção
  }
  if (data !== true) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
    const res = await fetch(pythonUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // assinatura INTACTA: o Python revalida o HMAC por conta própria
        "X-Hub-Signature-256": headers.get("x-hub-signature-256") ?? "",
      },
      body: rawBody,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (res.ok) return new Response("ok", { status: 200 });
    console.error(`agente Python respondeu ${res.status}`);
  } catch (err) {
    console.error("repasse para o agente Python falhou:", err);
  }

  if (FALLBACK_LIGADO && await fallbackSeguro(supabase, telefone, waMessageId)) {
    console.warn(`fallback para o fluxo antigo: ${waMessageId}`);
    return null;
  }
  // 503 = a Meta reentrega. O dedupe do lado Python absorve a duplicata;
  // o silêncio, não.
  return new Response("agente indisponível", { status: 503 });
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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

  // --- roteamento da migração ---
  const pythonUrl = Deno.env.get("PYTHON_AGENT_URL");
  if (pythonUrl) {
    const resposta = await rotearParaPython(supabase, pythonUrl, rawBody, req.headers);
    if (resposta) return resposta;
  }

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
    // nunca devolver erro interno à Meta por falha interna — logar e seguir
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
