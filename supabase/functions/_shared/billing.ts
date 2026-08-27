/**
 * Cópia literal de `src/lib/billing.ts` — Deno não importa de `src/`.
 * `src/lib/billing.test.ts` falha se as duas divergirem. Mexeu numa, mexe na outra.
 */

export type PaidPlan = "pro" | "family";

export interface StoreProduct {
  id: string;
  plan: PaidPlan;
  period: "monthly" | "annual";
  fallbackPrice: string;
}

export const STORE_PRODUCTS: StoreProduct[] = [
  { id: "proops.personal.pro.monthly", plan: "pro", period: "monthly", fallbackPrice: "R$ 24,90/mês" },
  { id: "proops.personal.pro.annual", plan: "pro", period: "annual", fallbackPrice: "R$ 249,00/ano" },
  { id: "proops.personal.family.monthly", plan: "family", period: "monthly", fallbackPrice: "R$ 39,90/mês" },
  { id: "proops.personal.family.annual", plan: "family", period: "annual", fallbackPrice: "R$ 399,00/ano" },
];

export const TRIAL_DAYS = 7;
export const ENTITLEMENT_ID = "premium";

export function planForProduct(productId: string | null | undefined): PaidPlan | null {
  if (!productId) return null;
  return STORE_PRODUCTS.find((p) => p.id === productId)?.plan ?? null;
}

// ── daqui para baixo é só do lado do servidor ───────────────────────────────

/**
 * Tipos de evento da RevenueCat -> a assinatura continua valendo?
 *
 * A sutileza que morde: **CANCELLATION não revoga**. Na RevenueCat (e nas duas
 * lojas) cancelar significa "não vai renovar" — o acesso continua até o fim do
 * período pago. Quem revoga é EXPIRATION. Tratar CANCELLATION como revogação
 * tiraria o acesso de quem ainda pagou por ele, e é a reclamação mais comum
 * contra app de assinatura.
 *
 * BILLING_ISSUE também não revoga: a loja entra em período de graça e tenta de
 * novo. Se não conseguir, manda EXPIRATION.
 */
const MANTEM_ACESSO = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "CANCELLATION", // "não vai renovar" — o acesso vale até expirar
  "BILLING_ISSUE", // período de graça
  "SUBSCRIPTION_EXTENDED",
  "TEMPORARY_ENTITLEMENT_GRANT",
]);

const REVOGA = new Set([
  "EXPIRATION",
  "REFUND",
  "REFUND_REVERSED", // volta a revogar; a reversão é tratada por evento próprio
  "SUBSCRIPTION_PAUSED",
  "TRANSFER", // a compra foi para outra conta: esta perde
]);

export function eventoConcedeAcesso(tipo: string): boolean | null {
  if (MANTEM_ACESSO.has(tipo)) return true;
  if (REVOGA.has(tipo)) return false;
  return null; // TEST, INVOICE_ISSUANCE e afins: registra e não mexe no plano
}

/** `expiration_at_ms` -> data ISO. A checagem de expiração no banco usa data. */
export function msParaData(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/** `store` da RevenueCat -> nosso `provider`. */
export function providerDaLoja(store: string | null | undefined): string | null {
  if (store === "APP_STORE" || store === "MAC_APP_STORE") return "apple";
  if (store === "PLAY_STORE") return "google";
  return null; // PROMOTIONAL, STRIPE, AMAZON: não usamos
}
