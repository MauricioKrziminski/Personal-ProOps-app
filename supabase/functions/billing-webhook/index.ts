/**
 * Webhook da RevenueCat: é a ÚNICA coisa no sistema que concede plano pago.
 *
 * Modelo de segurança (o app não participa de nada disto):
 *
 * 1. O app NUNCA diz "sou Pro". A `0033` tirou a policy de escrita em
 *    `subscriptions` e o trigger `guard_billing` recusa alteração das colunas de
 *    cobrança vinda de `authenticated`/`anon`. Recibo forjado no device não tem
 *    onde ser gravado.
 * 2. Recibo NUNCA é validado no cliente. Quem valida com a Apple e o Google é a
 *    RevenueCat, servidor a servidor; nós só recebemos o veredito assinado com
 *    um segredo que só nós dois conhecemos.
 * 3. `Authorization` conferido em tempo constante — comparação com `===` vaza o
 *    prefixo correto por timing e deixa o segredo ser adivinhado byte a byte.
 * 4. Evento de SANDBOX nunca concede em produção (`apply_entitlement` corta).
 *    Sem isso, StoreKit Testing viraria Pro de graça para qualquer um.
 * 5. Idempotência por `billing_events.id`: a RevenueCat reenvia até receber 2xx.
 * 6. Uma compra libera UM workspace (unique parcial em `provider,external_id`).
 *
 * Responde 200 mesmo quando ignora o evento — 4xx/5xx fazem a RevenueCat
 * reenviar em loop um evento que nunca vai ser aceito. Só devolvemos erro quando
 * o reenvio TEM chance de dar certo (falha nossa, transitória).
 */

import { adminClient } from "../_shared/admin.ts";
import {
  eventoConcedeAcesso,
  msParaData,
  planForProduct,
  providerDaLoja,
} from "../_shared/billing.ts";

/** Comparação em tempo constante: não vaza o prefixo correto por timing. */
function segredoConfere(recebido: string, esperado: string): boolean {
  const a = new TextEncoder().encode(recebido);
  const b = new TextEncoder().encode(esperado);
  // tamanhos diferentes já são falha, mas ainda percorremos para não vazar o tamanho
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const segredo = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
  if (!segredo) {
    // sem segredo configurado o endpoint ficaria aberto: melhor recusar tudo
    console.error("REVENUECAT_WEBHOOK_SECRET ausente");
    return json({ error: "not configured" }, 500);
  }
  if (!segredoConfere(req.headers.get("Authorization") ?? "", segredo)) {
    return json({ error: "unauthorized" }, 401);
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const evento = (corpo.event ?? {}) as Record<string, unknown>;
  const tipo = String(evento.type ?? "");
  const eventoId = String(evento.id ?? "");
  if (!eventoId || !tipo) return json({ error: "evento sem id ou type" }, 400);

  const concede = eventoConcedeAcesso(tipo);
  if (concede === null) {
    // TEST, INVOICE_ISSUANCE e afins: 200 para a RevenueCat parar de reenviar
    console.log(`billing-webhook: evento ${tipo} ignorado (nao mexe em plano)`);
    return json({ ok: true, ignorado: tipo });
  }

  const produto = String(evento.product_id ?? "");
  const ehSandbox = String(evento.environment ?? "").toUpperCase() === "SANDBOX";

  // Sandbox NÃO concede — é o furo clássico de IAP. Mas sem uma saída não dá
  // para testar o fluxo ponta a ponta, então existe uma chave explícita.
  //
  // ⚠️ BILLING_ALLOW_SANDBOX **precisa sair antes do app ir para produção**.
  // Com ela ligada, qualquer pessoa com StoreKit Testing vira Pro de graça.
  // O `environment` real fica gravado em billing_events.payload de qualquer
  // jeito, então dá para auditar depois quem entrou por sandbox.
  const permiteSandbox = Deno.env.get("BILLING_ALLOW_SANDBOX") === "true";
  if (ehSandbox && permiteSandbox) {
    console.warn(
      "⚠️ BILLING_ALLOW_SANDBOX ligada: concedendo a partir de evento de SANDBOX. " +
        "Desligue antes de publicar.",
    );
  }

  const supabase = adminClient();

  const { data, error } = await supabase.rpc("_apply_entitlement", {
    p_event_id: eventoId,
    p_app_user_id: String(evento.app_user_id ?? ""),
    p_provider: providerDaLoja(evento.store as string) ?? "",
    // `original_transaction_id` identifica a ASSINATURA (não a cobrança), que é
    // o que precisa ser único: as renovações compartilham o mesmo id.
    p_external_id: String(
      evento.original_transaction_id ?? evento.transaction_id ?? eventoId,
    ),
    p_product_id: produto,
    p_plan: planForProduct(produto),
    p_environment: ehSandbox && !permiteSandbox ? "sandbox" : "production",
    p_expires_on: msParaData(evento.expiration_at_ms as number),
    // TRIAL = 7 dias grátis; INTRO = preço promocional; NORMAL = pagando cheio
    p_is_trial: String(evento.period_type ?? "") === "TRIAL",
    p_active: concede,
    p_payload: evento,
  });

  if (error) {
    // falha nossa: devolve 5xx de propósito para a RevenueCat reenviar
    console.error("apply_entitlement falhou", error.message, { eventoId, tipo });
    return json({ error: "falha ao aplicar" }, 500);
  }

  console.log(`billing-webhook: ${tipo} -> ${data}`, { eventoId, produto });
  return json({ ok: true, resultado: data });
});
