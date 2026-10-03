import assert from 'node:assert/strict';
import { test } from 'node:test';

import { debtPaymentPatch, selectedDebtPaymentVersions } from './debt-payment-scope.ts';

const original = {
  amount_cents: 147000, category: 'contas', description: 'Parcela Carro',
  merchant: null, account_id: 'conta-1', occurred_at: '2026-09-05',
};

test('o patch de pagamento só contém campos alterados e mantém null explícito', () => {
  assert.deepEqual(debtPaymentPatch(original, { ...original, description: 'Financiamento', merchant: 'Banco' }),
    { description: 'Financiamento', merchant: 'Banco' });
  assert.deepEqual(debtPaymentPatch(original, { ...original, account_id: null }), { account_id: null });
  assert.deepEqual(debtPaymentPatch(original, { ...original }), {});
  assert.deepEqual(debtPaymentPatch(original, { ...original, occurred_at: '2026-09-06' }), { occurred_at: '2026-09-06' });
});

test('as versões seguem exatamente o escopo escolhido, inclusive o histórico em Todos', () => {
  const rows = [
    { id: 'primeiro', debt_payment_no: 1, edit_revision: 2 },
    { id: 'meio', debt_payment_no: 2, edit_revision: 0 },
    { id: 'ultimo', debt_payment_no: 3, edit_revision: 9 },
  ];
  assert.deepEqual(selectedDebtPaymentVersions(rows, 'meio', 2, 'one'), { meio: 0 });
  assert.deepEqual(selectedDebtPaymentVersions(rows, 'meio', 2, 'from_here'), { meio: 0, ultimo: 9 });
  assert.deepEqual(selectedDebtPaymentVersions(rows, 'meio', 2, 'all'), { primeiro: 2, meio: 0, ultimo: 9 });
  assert.throws(() => selectedDebtPaymentVersions([{ ...rows[1], debt_payment_no: null }], 'meio', 2, 'all'), /sem número/);
});

test('F09 pagamento muda detalhe por alcance e troca de pai limpa UUID herdado', () => {
  const child = '33333333-3333-4333-8333-333333333333';
  const before = { amount_cents: 1000, category: 'crédito', description: null, merchant: null, account_id: null,
    occurred_at: '2026-10-03', subcategory_id: child };
  assert.deepEqual(debtPaymentPatch(before, { ...before }), {});
  assert.deepEqual(debtPaymentPatch(before, { ...before, subcategory_id: null }), { subcategory_id: null });
  assert.deepEqual(debtPaymentPatch(before, { ...before, category: 'saúde' }), { category: 'saúde', subcategory_id: null });
  const { subcategory_id, ...legacy } = before;
  assert.deepEqual(debtPaymentPatch(before, legacy), {});
});
