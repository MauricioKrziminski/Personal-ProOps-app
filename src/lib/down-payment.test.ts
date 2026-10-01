import assert from 'node:assert/strict';
import test from 'node:test';
import * as entrada from './down-payment.ts';
import { temContrato, podeParcelar } from './finance-form.ts';

test('entrada sai do total antes de dividir o restante, sem contar uma parcela', () => {
  assert.equal(typeof entrada.purchaseAmounts, 'function');
  assert.deepEqual(entrada.purchaseAmounts(120000, 'total', 5, 20000), {
    purchaseCents: 120000, financedCents: 100000, installmentCents: 20000,
  });
  assert.deepEqual(entrada.purchaseAmounts(33333, 'parcela', 3, 20000), {
    purchaseCents: 119999, financedCents: 99999, installmentCents: 33333,
  });
});

test('entrada não altera os centavos das prestações ou o resto da última parcela', () => {
  assert.deepEqual(entrada.purchaseAmounts(10000, 'total', 3, 1), {
    purchaseCents: 10000, financedCents: 9999, installmentCents: 3333,
  });
  assert.deepEqual(entrada.purchaseAmounts(10000, 'total', 3, 0), {
    purchaseCents: 10000, financedCents: 10000, installmentCents: 3333,
  });
});

test('entrada inválida nunca vira payload de pagamento', () => {
  assert.throws(() => entrada.purchaseAmounts(120000, 'total', 5, 120000));
  assert.throws(() => entrada.purchaseAmounts(120000, 'total', 5, -1));
  assert.throws(() => entrada.purchaseAmounts(120000, 'total', 5, 0.5));
  assert.throws(() => entrada.purchaseAmounts(Number.MAX_SAFE_INTEGER, 'parcela', 72, 1));
  assert.equal(entrada.downPaymentError({ amountCents: 20000, dateBR: '01/10/2026', accountId: 'a' }, '2026-09-30'), 'A entrada paga não pode ter data futura');
  assert.equal(entrada.downPaymentError({ amountCents: 20000, dateBR: '30/09/2026', accountId: null }, '2026-09-30'), 'Escolha a conta da entrada');
  assert.equal(entrada.downPaymentError({ amountCents: 20000, dateBR: '30/09/2026', accountId: 'a' }, '2026-09-30'), undefined);
});

test('entrada já vinculada não vira uma segunda compra parcelada ao editar', () => {
  const entry = { down_payment_debt_id: 'd' };
  assert.equal(temContrato(entry), true);
  assert.equal(podeParcelar('expense', 'conta', entry), false);
  assert.equal(podeParcelar('expense', 'conta', { down_payment_plan_id: 'p' }), false);
});
