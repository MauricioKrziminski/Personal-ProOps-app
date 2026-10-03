import { PAYMENT_METHODS, normalizePaymentMethod, paymentMethodLabel, type PaymentMethod } from './payment-method.ts';

export type PaymentMethodFilter = PaymentMethod | 'not_informed';
export const PAYMENT_METHOD_FILTER_OPTIONS: readonly { id: PaymentMethodFilter; label: string }[] = [
  ...PAYMENT_METHODS.map(id => ({ id, label: paymentMethodLabel(id) })),
  { id: 'not_informed', label: 'Não informado' },
];

/** Empty means no filter; only the explicit sentinel selects historical null metadata. */
export function normalizePaymentMethodFilters(values: readonly unknown[] | undefined): PaymentMethodFilter[] {
  if (values === undefined) return [];
  if (!Array.isArray(values))
    throw new Error('Informe uma forma de pagamento válida para filtrar');
  const selected = new Set(values);
  for (const value of selected) {
    if (value !== 'not_informed' && normalizePaymentMethod(value) === null)
      throw new Error('Informe uma forma de pagamento válida para filtrar');
  }
  return PAYMENT_METHOD_FILTER_OPTIONS.map(option => option.id).filter(id => selected.has(id));
}

/** A malformed link is invalid as a whole, rather than silently widening its selection. */
export function parsePaymentMethodFilters(raw: string | string[] | undefined): PaymentMethodFilter[] | null {
  if (raw === undefined) return [];
  const params = typeof raw === 'string' ? [raw] : raw;
  if (!Array.isArray(params)) return null;
  const values: string[] = [];
  for (const value of params) {
    if (typeof value !== 'string') return null;
    if (value.trim()) values.push(...value.split(',').map(part => part.trim()));
  }
  try {
    return normalizePaymentMethodFilters(values);
  } catch {
    return null;
  }
}

/** Closed PostgREST OR group; no caller-provided text becomes part of an expression. */
export function paymentMethodFilterExpression(values: readonly PaymentMethodFilter[] | undefined): string | undefined {
  const normalized = normalizePaymentMethodFilters(values);
  const known = normalized.filter(value => value !== 'not_informed');
  const conditions: string[] = [];
  if (known.length) conditions.push(`payment_method.in.(${known.join(',')})`);
  if (normalized.includes('not_informed')) conditions.push('payment_method.is.null');
  return conditions.length ? conditions.join(',') : undefined;
}
