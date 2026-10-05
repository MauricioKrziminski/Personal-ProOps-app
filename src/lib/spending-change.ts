/** F15 — "por que o gasto mudou": decodifica a RPC `spending_change` e monta o que a tela mostra. */
export const SPENDING_DIMENSIONS = ['category', 'subcategory', 'payment_method', 'pattern', 'necessity'] as const;
export type SpendingDimension = (typeof SPENDING_DIMENSIONS)[number];
/** "Sem categoria" como parâmetro de rota, no mesmo estilo de `NO_ACCOUNT` e `subcategoryId=none`. */
export const NO_CATEGORY = 'none';

export interface SpendingChangeRow { key: string | null; label: string; current: number; previous: number; delta: number }
export interface SpendingChange { current: number; previous: number; delta: number; percentBp: number | null; rows: SpendingChangeRow[] }
export interface SpendingPeriods { curFrom: string; curTo: string; prevFrom: string; prevTo: string }

const INVALID = 'Resposta inválida do servidor.';
const cents = (v: unknown): number => {
  if (typeof v !== 'string' || !/^-?\d{1,15}$/.test(v)) throw new Error(INVALID);
  return Number(v);
};

/** A soma das linhas tem que fechar a diferença do topo no centavo — senão a tela mentiria. */
export function decodeSpendingChange(raw: unknown): SpendingChange {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.rows)) throw new Error(INVALID);
  const rows = (o.rows as Record<string, unknown>[]).map((r) => {
    if (r.key !== null && typeof r.key !== 'string') throw new Error(INVALID);
    if (typeof r.label !== 'string') throw new Error(INVALID);
    const current = cents(r.current_cents), previous = cents(r.previous_cents), delta = cents(r.delta_cents);
    if (current - previous !== delta) throw new Error(INVALID);
    return { key: r.key as string | null, label: r.label, current, previous, delta };
  });
  const out: SpendingChange = {
    current: cents(o.current_cents), previous: cents(o.previous_cents), delta: cents(o.delta_cents),
    percentBp: o.percent_bp === null ? null : Number(o.percent_bp), rows,
  };
  if (out.current - out.previous !== out.delta || rows.reduce((s, r) => s + r.delta, 0) !== out.delta)
    throw new Error(INVALID);
  return out;
}

/** Maior |diferença| primeiro; zeradas só em "Ver todas". */
export function visibleRows(rows: readonly SpendingChangeRow[], all: boolean): SpendingChangeRow[] {
  return rows.filter((r) => all || r.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/** Largura proporcional (0..1) da barra de uma linha. */
export function barFraction(delta: number, rows: readonly SpendingChangeRow[]): number {
  const max = rows.reduce((m, r) => Math.max(m, Math.abs(r.delta)), 0);
  return max === 0 ? 0 : Math.abs(delta) / max;
}

/** `null` quando o anterior é zero: não existe percentual sobre nada. */
export function percentText(percentBp: number | null): string | null {
  if (percentBp === null) return null;
  const p = Math.round(percentBp / 100);
  return p === 0 ? '0%' : `${p > 0 ? '+' : '−'}${Math.abs(p)}%`;
}

const PARAM: Record<SpendingDimension, string> = {
  category: 'category', subcategory: 'subcategoryId', payment_method: 'paymentMethods',
  pattern: 'expensePatterns', necessity: 'expenseNecessities',
};

/** Parâmetros de /finance/transactions para o conjunto exato de uma linha em um dos períodos. */
export function rowLinkParams(dimension: SpendingDimension, row: Pick<SpendingChangeRow, 'key'>,
  periods: SpendingPeriods, which: 'current' | 'previous'): Record<string, string> {
  const nullKey = dimension === 'category' ? NO_CATEGORY : dimension === 'subcategory' ? 'none' : 'not_informed';
  return {
    from: which === 'current' ? periods.curFrom : periods.prevFrom,
    to: which === 'current' ? periods.curTo : periods.prevTo,
    kind: 'expense', lente: 'gasto', [PARAM[dimension]]: row.key ?? nullKey,
  };
}
