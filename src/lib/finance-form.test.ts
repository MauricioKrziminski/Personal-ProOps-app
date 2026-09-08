import assert from 'node:assert/strict';
import test from 'node:test';
import { debtTerm, validRecurringRange, simpleDebtValues } from './finance-form.ts';
test('remaining installments are added to already paid, never subtracted twice', () => {
  assert.equal(debtTerm('8', 4), 12);
  assert.equal(debtTerm('', 4), null);
  assert.throws(() => debtTerm('0', 4));
});
test('recurrence end and interval reject invalid schedules', () => {
  assert.equal(validRecurringRange('2026-09-08', '2026-09-07', '1'), false);
  assert.equal(validRecurringRange('2026-09-08', '', '0'), false);
  assert.equal(validRecurringRange('2026-09-08', '2026-09-08', '2'), true);
});

test('debt term rejects fabricated negative or fractional paid history', () => {
  assert.throws(() => debtTerm('40', -1));
  assert.throws(() => debtTerm('40', 8.5));
});

test('retrospective purchase asks paid history and preserves explicit zero', async () => {
  const helpers = await import('./finance-form.ts');
  assert.equal(typeof helpers.installmentHistory, 'function', 'history must have a shared validated boundary');
  const history = helpers.installmentHistory;
  assert.throws(() => history('',48,'2026-01-08','2026-09-08'), /pagas/);
  assert.equal(history('0',48,'2026-01-08','2026-09-08'),0);
  assert.equal(history('8',48,'2026-01-08','2026-09-08'),8);
  assert.equal(history('',48,'2026-09-08','2026-09-08'),0);
  for (const bad of ['-1','8.5','49','8foo']) assert.throws(() => history(bad,48,'2026-01-08','2026-09-08'));
});

test('simple financing needs only installment value and total count, keeping embedded interest unspecified', () => {
  assert.deepEqual(simpleDebtValues(147000, '48', 0), {
    principal_cents: 7056000, remaining_cents: 7056000, installments: 48,
    installments_paid: 0, installment_cents: 147000,
    calculation_mode: 'fixed_installments', interest_rate_monthly: 0,
  });
});
test('simple financing subtracts explicitly paid installments once', () => {
  const values = simpleDebtValues(147000, '48', 8);
  assert.equal(values.remaining_cents, 5880000);
  assert.equal(values.installments, 48);
  assert.equal(values.installments_paid, 8);
});
test('simple financing rejects fractional counts, absent amounts, excess history and unsafe sums', () => {
  for (const [amount, count, paid] of [[0, '48', 0], [147000, '', 0], [147000, '2.5', 0], [147000, '48', 49], [147000, '48', -1], [Number.MAX_SAFE_INTEGER, '48', 0]] as const) {
    assert.throws(() => simpleDebtValues(amount, count, paid));
  }
});
