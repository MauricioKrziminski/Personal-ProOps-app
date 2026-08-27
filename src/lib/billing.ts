/**
 * Produtos de assinatura das lojas — FONTE ÚNICA.
 *
 * A cobrança é só por In-App Purchase (App Store + Google Play), então estes ids
 * precisam existir, com a MESMA grafia, em três lugares: App Store Connect,
 * Google Play Console e aqui. Errar uma letra = compra que a loja aprova e o
 * nosso webhook não sabe traduzir (vira `produto_desconhecido` e ninguém libera).
 *
 * `supabase/functions/_shared/billing.ts` mantém uma cópia literal porque roda em
 * Deno e não importa de `src/`. `src/lib/billing.test.ts` falha se as duas
 * divergirem — mexeu numa, mexe na outra. Mesmo padrão de `categories.ts`.
 *
 * ⚠️ Pro e Família ficam no MESMO subscription group na Apple. São dois motivos:
 * só existe UM teste grátis por Apple ID por grupo (grupos separados deixariam a
 * pessoa pegar 7 dias no Pro, cancelar e pegar mais 7 no Família), e a troca
 * entre planos do mesmo grupo já sai proporcional, de graça.
 */

/** Plano interno, igual ao check de `subscriptions.plan`. */
export type PaidPlan = 'pro' | 'family';

export interface StoreProduct {
  /** id do produto nas duas lojas (usar a mesma string nas duas) */
  id: string;
  plan: PaidPlan;
  period: 'monthly' | 'annual';
  /** só para exibir — o preço que vale é o que a loja devolve no device */
  fallbackPrice: string;
}

export const STORE_PRODUCTS: StoreProduct[] = [
  { id: 'proops.personal.pro.monthly', plan: 'pro', period: 'monthly', fallbackPrice: 'R$ 24,90/mês' },
  { id: 'proops.personal.pro.annual', plan: 'pro', period: 'annual', fallbackPrice: 'R$ 249,00/ano' },
  { id: 'proops.personal.family.monthly', plan: 'family', period: 'monthly', fallbackPrice: 'R$ 39,90/mês' },
  { id: 'proops.personal.family.annual', plan: 'family', period: 'annual', fallbackPrice: 'R$ 399,00/ano' },
];

/** Dias de teste grátis. Configurado como introductory offer nas duas lojas. */
export const TRIAL_DAYS = 7;

/** id do entitlement na RevenueCat — um só, porque o plano vem do produto. */
export const ENTITLEMENT_ID = 'premium';

/** Produto -> plano. Desconhecido devolve null: nunca chutar plano pago. */
export function planForProduct(productId: string | null | undefined): PaidPlan | null {
  if (!productId) return null;
  return STORE_PRODUCTS.find((p) => p.id === productId)?.plan ?? null;
}
