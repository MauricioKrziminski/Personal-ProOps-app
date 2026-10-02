import type { PaymentMethod } from './payment-method.ts';

/** Campos do pagamento que a edição com alcance pode aplicar sem alterar a data da baixa. */
export type DebtPaymentEditable = {
  amount_cents: number;
  category: string | null;
  description: string | null;
  merchant: string | null;
  account_id: string | null;
  occurred_at: string;
  payment_method?: PaymentMethod | null;
};

export type DebtPaymentScope = 'one' | 'from_here' | 'all';

export function debtPaymentPatch(
  oldValue: DebtPaymentEditable,
  newValue: DebtPaymentEditable,
): Partial<DebtPaymentEditable> {
  const patch: Partial<DebtPaymentEditable> = {};
  if ('payment_method' in newValue && (oldValue.payment_method ?? null) !== newValue.payment_method)
    patch.payment_method = newValue.payment_method;
  for (const field of ['amount_cents', 'category', 'description', 'merchant', 'account_id', 'occurred_at'] as const) {
    if (oldValue[field] !== newValue[field]) {
      // Cada chave conserva o seu tipo e `null` intencional.
      if (field === 'amount_cents') patch.amount_cents = newValue.amount_cents;
      else if (field === 'category') patch.category = newValue.category;
      else if (field === 'description') patch.description = newValue.description;
      else if (field === 'merchant') patch.merchant = newValue.merchant;
      else if (field === 'occurred_at') patch.occurred_at = newValue.occurred_at;
      else patch.account_id = newValue.account_id;
    }
  }
  return patch;
}

export function selectedDebtPaymentVersions(
  rows: { id: string; debt_payment_no: number | null; edit_revision: number }[],
  anchorId: string,
  anchorNo: number,
  scope: DebtPaymentScope,
): Record<string, number> {
  if (scope !== 'one' && rows.some((row) => row.debt_payment_no === null)) {
    throw new Error('Há pagamento sem número da parcela; não é possível determinar o alcance.');
  }
  const selected = rows.filter((row) =>
    scope === 'all' || (scope === 'one' ? row.id === anchorId : (row.debt_payment_no ?? -1) >= anchorNo));
  if (!selected.some((row) => row.id === anchorId)) throw new Error('O pagamento mudou; atualize a tela e tente novamente.');
  return Object.fromEntries(selected.map((row) => [row.id, row.edit_revision]));
}
