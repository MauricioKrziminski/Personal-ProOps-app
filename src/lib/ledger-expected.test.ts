import assert from 'node:assert/strict';
import test from 'node:test';
import { filterExpectedLines, type ExpectedLedgerLine } from './ledger-expected.ts';

const recurrence: ExpectedLedgerLine = {
  origin: 'recurring', ref_id: 'series', due_date: '2026-11-01',
  amount_cents: 5590, kind: 'expense', description: 'Assinatura de streaming',
  category: 'lazer', account_id: null, installment_no: null, installments_total: null,
  inferred_start: false,
};
const debt: ExpectedLedgerLine = {
  ...recurrence, origin: 'debt_schedule', ref_id: 'car', due_date: '2026-11-30',
  description: 'Carro', category: 'transporte', account_id: 'checking',
  installment_no: 9, installments_total: 48,
};

test('previsões respeitam filtros da lista, sem se passarem por lançamentos concluídos', () => {
  assert.deepEqual(filterExpectedLines([recurrence, debt], { status: 'cleared' }), []);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { source: 'recurring' }), [recurrence]);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { source: 'app' }), []);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { accountId: null }), [recurrence]);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { accountId: 'checking' }), [debt]);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { category: 'lazer', q: 'STREAM' }), [recurrence]);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { q: 'car' }), [debt]);
});

test('Ver ocorrências limita previsões à série selecionada', () => {
  assert.deepEqual(filterExpectedLines([recurrence, debt], { recurringId: 'series' }), [recurrence]);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { recurringId: 'other' }), []);
});

test('previsões de origens diferentes aparecem em ordem de vencimento', () => {
  assert.deepEqual(filterExpectedLines([debt, recurrence], {}), [recurrence, debt]);
  assert.deepEqual(filterExpectedLines([recurrence, debt], {}), [recurrence, debt]);
});
