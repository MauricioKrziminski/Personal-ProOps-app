/**
 * A oferta da loja lida em palavras — puro, sem react-native, para o `node --test` alcançar.
 *
 * **Preço e período vêm só do que a loja devolveu** (`priceString`, `subscriptionPeriod`). Nada
 * aqui conhece valor em reais.
 */
import { planForProduct, type PaidPlan } from './billing.ts';

/** O pedaço do `PurchasesPackage` que interessa; o objeto inteiro do SDK cabe nele. */
export interface PacoteDaLoja {
  identifier: string;
  product: {
    identifier: string;
    priceString: string;
    subscriptionPeriod: string | null;
    introPrice?: { price: number; periodUnit: string; periodNumberOfUnits: number } | null;
    defaultOption?: { freePhase?: { billingPeriod: { unit: string; value: number } } | null } | null;
  };
}

const DIAS: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 };

/** Dias do teste grátis do pacote, ou `null` se ele não tem. (Elegibilidade é decidida por quem chama.) */
export function diasDeTeste(p: PacoteDaLoja): number | null {
  const intro = p.product.introPrice;
  if (intro && intro.price === 0 && DIAS[intro.periodUnit]) return intro.periodNumberOfUnits * DIAS[intro.periodUnit];
  const livre = p.product.defaultOption?.freePhase?.billingPeriod;
  if (livre && DIAS[livre.unit]) return livre.value * DIAS[livre.unit];
  return null;
}

const UNIDADE: Record<string, [string, string]> = {
  D: ['dia', 'dias'],
  W: ['semana', 'semanas'],
  M: ['mês', 'meses'],
  Y: ['ano', 'anos'],
};

/** "P1M" -> "por mês"; "P3M" -> "a cada 3 meses". Sem período legível, `null` (a tela não inventa). */
export function periodoEscrito(iso: string | null | undefined): string | null {
  const m = /^P(\d+)([DWMY])$/.exec(iso ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  const [um, varios] = UNIDADE[m[2]];
  return n === 1 ? `por ${um}` : `a cada ${n} ${varios}`;
}

export interface OpcaoDeAssinatura {
  pacote: PacoteDaLoja;
  plano: PaidPlan;
  preco: string;
  periodo: string | null;
  diasDeTeste: number | null;
}

/** Pacotes da loja -> opções por plano. Produto que o servidor não sabe traduzir não é oferecido. */
export function opcoesDaLoja(pacotes: PacoteDaLoja[], elegivelParaTeste: boolean): OpcaoDeAssinatura[] {
  const opcoes: OpcaoDeAssinatura[] = [];
  for (const pacote of pacotes) {
    const plano = planForProduct(pacote.product.identifier);
    if (!plano) continue;
    opcoes.push({
      pacote,
      plano,
      preco: pacote.product.priceString,
      periodo: periodoEscrito(pacote.product.subscriptionPeriod),
      diasDeTeste: elegivelParaTeste ? diasDeTeste(pacote) : null,
    });
  }
  return opcoes;
}

export function rotuloDoBotao(o: OpcaoDeAssinatura | undefined): string {
  if (o?.diasDeTeste) return `Começar ${o.diasDeTeste} dias grátis`;
  return 'Assinar';
}

/** A frase de renovação que a Apple exige junto do botão: valor, período e como cancelar. */
export function textoDeRenovacao(o: OpcaoDeAssinatura | undefined, loja: string): string {
  const cobranca = o ? `${o.preco}${o.periodo ? ` ${o.periodo}` : ''}` : null;
  const teste = o?.diasDeTeste ? `Grátis por ${o.diasDeTeste} dias; depois, ` : '';
  const preco = cobranca ? `${teste}${cobranca}. ` : '';
  return `${preco}Renova automaticamente até você cancelar. Cancele quando quiser na ${loja}.`;
}
