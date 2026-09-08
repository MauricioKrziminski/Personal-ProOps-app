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
