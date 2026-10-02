/** Payment metadata never determines the accounting kind or guesses legacy values. */
export const PAYMENT_METHODS = ['pix', 'credit', 'debit', 'cash', 'bank_transfer', 'boleto'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];

const LABELS: Record<PaymentMethod, string> = {
  pix: 'Pix', credit: 'Crédito', debit: 'Débito', cash: 'Dinheiro',
  bank_transfer: 'Transferência', boleto: 'Boleto',
};

export function normalizePaymentMethod(value: unknown): PaymentMethod | null {
  return typeof value === 'string' && Object.hasOwn(LABELS, value) ? value as PaymentMethod : null;
}

/** Omission preserves a previous value; explicit null clears it. Invalid writes are rejected. */
export function assertPaymentMethod(value: unknown): asserts value is PaymentMethod | null | undefined {
  if (value !== undefined && value !== null && normalizePaymentMethod(value) === null)
    throw new Error('Informe uma forma de pagamento válida');
}

export function paymentMethodLabel(method: unknown): string {
  const normalized = normalizePaymentMethod(method);
  return normalized === null ? 'Não informado' : LABELS[normalized];
}

type PaymentAccount = { type?: string | null };
const BANK_TYPES = ['checking', 'savings', 'investment'];

export function paymentMethodError(method: PaymentMethod | null | undefined, account: PaymentAccount | null): string | null {
  assertPaymentMethod(method);
  if (method == null) return null;
  if (method === 'credit') return account?.type === 'credit_card' ? null : 'Escolha um cartão para pagar no crédito.';
  if (!account) return null;
  if (method === 'cash') return account.type === 'cash' ? null : 'Escolha uma conta de dinheiro para esta forma de pagamento.';
  if (method === 'debit') return BANK_TYPES.includes(account.type ?? '') ? null : 'Escolha uma conta para pagar no débito.';
  return BANK_TYPES.includes(account.type ?? '') || account.type === 'credit_card'
    ? null : 'Escolha uma conta bancária ou um cartão para esta forma de pagamento.';
}

export function paymentMethodAccounts<T extends PaymentAccount>(method: PaymentMethod | null | undefined, accounts: readonly T[]): T[] {
  return accounts.filter((account) => paymentMethodError(method, account) === null);
}
