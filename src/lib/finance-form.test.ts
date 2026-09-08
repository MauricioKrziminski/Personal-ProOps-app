import assert from 'node:assert/strict';
import test from 'node:test';
import { debtTerm, validRecurringRange } from './finance-form.ts';
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
