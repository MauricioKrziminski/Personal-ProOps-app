import { brToISO, isValidBRDate } from './dates.ts';

export type DownPaymentForm = { amountCents: number; dateBR: string; accountId: string | null };
export type DownPaymentInput = { amount_cents: number; occurred_at: string; account_id: string };

/** O contrato contém só prestações; a entrada é um movimento separado, nunca parcela nº 1. */
export function purchaseAmounts(valueCents: number, unit: 'total' | 'parcela', installments: number, downPaymentCents = 0) {
  if (![valueCents, installments, downPaymentCents].every(Number.isSafeInteger) ||
      valueCents <= 0 || installments < 1 || downPaymentCents < 0) throw new Error('Informe valores válidos');
  const financedCents = unit === 'total' ? valueCents - downPaymentCents : valueCents * installments;
  const purchaseCents = financedCents + downPaymentCents;
  if (!Number.isSafeInteger(purchaseCents) || financedCents < installments)
    throw new Error('A entrada deve deixar pelo menos R$ 0,01 para cada parcela');
  return { purchaseCents, financedCents, installmentCents: Math.floor(financedCents / installments) };
}

export function downPaymentError(form: DownPaymentForm, today: string): string | undefined {
  if (!Number.isSafeInteger(form.amountCents) || form.amountCents <= 0) return 'Informe o valor da entrada';
  if (!form.accountId) return 'Escolha a conta da entrada';
  if (!isValidBRDate(form.dateBR)) return 'Informe a data da entrada';
  if (brToISO(form.dateBR) > today) return 'A entrada paga não pode ter data futura';
  return undefined;
}

export function downPaymentInput(form: DownPaymentForm, today: string): DownPaymentInput {
  const error = downPaymentError(form, today);
  if (error) throw new Error(error);
  return { amount_cents: form.amountCents, occurred_at: brToISO(form.dateBR), account_id: form.accountId! };
}
