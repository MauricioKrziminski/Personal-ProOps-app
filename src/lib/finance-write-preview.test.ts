import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contasDoEfeito, estadoDaPrevia, lerPrevia, type FinancePreview, type PreviewQuery } from './finance-write-preview.ts';

const snapshot = { balances: [{ account_id: 'bank', cleared_cents: -48146 }], limits: [
  { account_id: 'card', credit_limit_cents: 500000, available_limit_cents: 477655, limit_status: 'available' as const },
], accounts: [{ account_id: 'bank', saldo_fim: -48146 }], cards: [] };
const preview: FinancePreview = { as_of: '2026-10-02', horizon_end: '2026-12-31', before: snapshot, after: { ...snapshot,
  balances: [{ account_id: 'bank', cleared_cents: -49380 }],
  accounts: [{ account_id: 'bank', saldo_fim: -49380 }],
}, write: { operation: 'transaction', result: { id: 'tx' } }, schedule: [{
  origin: 'transaction', id: 'tx', ref_id: null, occurred_at: '2026-10-02', due_at: null,
  account_id: 'bank', counterparty_account_id: null, kind: 'expense', amount_cents: 1234,
  status: 'cleared', description: 'Pix', installment_no: null, installments_total: null,
  invoice_id: null, invoice_closing_date: null, invoice_due_date: null, invoice_status: null,
  is_entry: false, is_fee: false, payment_method: 'pix', estimated: false,
}], schedule_total: 1, schedule_truncated: false, schedule_scope: 'contract', horizon_days: 90 };
const query: PreviewQuery = { data: { identity: 'old', preview }, isError: false, isPending: false,
  isFetching: false, isStale: false, fetchStatus: 'idle' };

test('an old completed response disappears immediately while the changed draft is still debouncing', () => {
  assert.equal(estadoDaPrevia('new', 'old', query).kind, 'loading');
  assert.equal(estadoDaPrevia('new', 'new', query).kind, 'loading');
  assert.equal(estadoDaPrevia(null, 'old', query).kind, 'incomplete');
});
test('same draft numbers are hidden during a financial refresh and after its failure or offline pause', () => {
  assert.equal(estadoDaPrevia('old', 'old', { ...query, isFetching: true, fetchStatus: 'fetching' }).kind, 'loading');
  assert.equal(estadoDaPrevia('old', 'old', { ...query, isError: true }).kind, 'unavailable');
  assert.equal(estadoDaPrevia('old', 'old', { ...query, fetchStatus: 'paused' }).kind, 'unavailable');
  assert.equal(estadoDaPrevia('old', 'old', { ...query, isStale: true }).kind, 'loading');
  assert.deepEqual(estadoDaPrevia('old', 'old', query), { kind: 'ready', preview });
});
test('preview reads preserve negative balances and numeric bigint strings without silently inventing zero', () => {
  const raw = JSON.parse(JSON.stringify(preview));
  raw.before.balances[0].cleared_cents = '-48146';
  raw.schedule[0].amount_cents = '1234';
  const read = lerPrevia(raw);
  assert.equal(read.before.balances[0].cleared_cents, -48146);
  assert.equal(read.schedule[0].amount_cents, 1234);
  for (const invalid of [null, '', '1.2', true, 9007199254740992]) {
    raw.schedule[0].amount_cents = invalid;
    assert.throws(() => lerPrevia(raw));
  }
});
test('unknown and inconsistent limit quality never becomes available credit', () => {
  const raw = JSON.parse(JSON.stringify(preview));
  raw.after.limits[0] = { account_id: 'card', credit_limit_cents: null, available_limit_cents: null, limit_status: 'not_set' };
  assert.equal(lerPrevia(raw).after.limits[0].available_limit_cents, null);
  raw.after.limits[0].limit_status = 'available';
  assert.throws(() => lerPrevia(raw));
  raw.after.limits[0].limit_status = 'needs_review';
  assert.equal(lerPrevia(raw).after.limits[0].available_limit_cents, null);
});
test('only affected accounts appear, and a new horizon line has no fabricated before amount', () => {
  const effects = contasDoEfeito(preview, [{ id: 'bank', name: 'Conta', type: 'bank' }, { id: 'card', name: 'Cartão', type: 'credit_card' }]);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].balanceBefore, -48146);
  assert.equal(effects[0].balanceAfter, -49380);
  const withMissing = { ...preview, before: { ...snapshot, accounts: [] } };
  assert.equal(contasDoEfeito(withMissing, [{ id: 'bank', name: 'Conta', type: 'bank' }])[0].forecastBefore, null);
});
test('credit uses canonical quality even when the legacy horizon advertises a numeric free limit', () => {
  const cardPreview = { ...preview, after: { ...preview.after,
    limits: [{ account_id: 'card', credit_limit_cents: 500000, available_limit_cents: null, limit_status: 'needs_review' as const }],
    cards: [{ account_id: 'card', livre: 498766 }],
  }, schedule: [{ ...preview.schedule[0], account_id: 'card' }] };
  const effect = contasDoEfeito(cardPreview, [{ id: 'card', name: 'Cartão', type: 'credit_card' }])[0];
  assert.equal(effect.limitStatus, 'needs_review');
  assert.equal(effect.limitAfter, null);
});

test('unassigned canonical balances remain readable and distinct from a missing account balance', () => {
  const raw = JSON.parse(JSON.stringify(preview));
  raw.before.balances.push({ account_id: null, cleared_cents: 0 });
  raw.after.balances.push({ account_id: null, cleared_cents: -1234 });
  raw.schedule[0].account_id = null;
  const read = lerPrevia(raw);
  const unassigned = contasDoEfeito(read, []).find((a) => a.id === null)!;
  assert.equal(unassigned.balanceBefore, 0);
  assert.equal(unassigned.balanceAfter, -1234);
  assert.equal(unassigned.name, 'Sem conta');
});

const classificationKeys = ['expense_pattern', 'expense_pattern_source', 'expense_necessity', 'expense_necessity_source'] as const;
const unknownClassification = {
  expense_pattern: null, expense_pattern_source: null, expense_necessity: null, expense_necessity_source: null,
};
const explicitClassification = {
  expense_pattern: 'fixed', expense_pattern_source: 'explicit',
  expense_necessity: 'essential', expense_necessity_source: 'category_default',
};
function previewWithClassification(classification: Record<string, unknown>, line: Record<string, unknown> = {}) {
  return { ...preview, schedule: [{ ...preview.schedule[0], ...line, ...classification }] };
}

test('legacy F04 schedule without classification columns stays absent and is never inferred from origin', () => {
  for (const origin of ['transaction', 'recurring', 'debt_schedule', 'debt_estimate']) {
    const read = lerPrevia(previewWithClassification({}, { origin, estimated: origin !== 'transaction' }));
    for (const key of classificationKeys) assert.equal(Object.hasOwn(read.schedule[0], key), false);
  }
});

test('schedule preserves the server snapshot for recorded, recurring, debt and declared lines', () => {
  for (const origin of ['transaction', 'recurring', 'debt_schedule', 'debt_estimate']) {
    for (const classification of [explicitClassification, {
      expense_pattern: 'variable', expense_pattern_source: 'category_default',
      expense_necessity: 'discretionary', expense_necessity_source: 'explicit',
    }]) {
      const raw = previewWithClassification(classification, {
        origin, estimated: origin !== 'transaction', status: origin === 'debt_estimate' ? 'declared' : 'pending',
      });
      assert.deepEqual(lerPrevia(raw).schedule[0], raw.schedule[0]);
    }
  }
});

test('explicit NULL, four unknown columns and one classified dimension preserve distinct snapshots', () => {
  for (const classification of [unknownClassification, {
    expense_pattern: null, expense_pattern_source: 'explicit',
    expense_necessity: null, expense_necessity_source: 'explicit',
  }, {
    expense_pattern: null, expense_pattern_source: 'explicit',
    expense_necessity: 'essential', expense_necessity_source: 'category_default',
  }, {
    expense_pattern: 'variable', expense_pattern_source: 'explicit',
  }, {
    expense_necessity: 'discretionary', expense_necessity_source: 'category_default',
  }]) {
    const raw = previewWithClassification(classification);
    assert.deepEqual(lerPrevia(raw).schedule[0], raw.schedule[0]);
  }
});

test('a Pix fee retains its own unknown snapshot independently of the classified purchase', () => {
  const raw = { ...preview, schedule: [
    { ...preview.schedule[0], ...explicitClassification, account_id: 'card' },
    { ...preview.schedule[0], ...unknownClassification, id: 'fee', ref_id: 'tx',
      account_id: 'card', is_fee: true, amount_cents: 50, description: 'Juros do Pix no crédito' },
  ], schedule_total: 2 };
  assert.deepEqual(lerPrevia(raw).schedule, raw.schedule);
});

test('schedule rejects classification enums and provenance outside the closed domain', () => {
  for (const invalid of [
    { expense_pattern: 'sometimes', expense_pattern_source: 'explicit' },
    { expense_pattern: 'FIXED', expense_pattern_source: 'explicit' },
    { expense_pattern: 'fixed', expense_pattern_source: 'recurring' },
    { expense_pattern: 'fixed', expense_pattern_source: true },
    { expense_pattern: 1, expense_pattern_source: 'explicit' },
    { expense_necessity: 'optional', expense_necessity_source: 'explicit' },
    { expense_necessity: 'essential', expense_necessity_source: 'inferred' },
    { expense_necessity: 'essential', expense_necessity_source: {} },
  ]) assert.throws(() => lerPrevia(previewWithClassification(invalid)), JSON.stringify(invalid));
});

test('schedule rejects a known value without source and a category default whose value is NULL', () => {
  for (const invalid of [
    { expense_pattern: 'fixed' },
    { expense_pattern: 'fixed', expense_pattern_source: null },
    { expense_necessity: 'essential' },
    { expense_necessity: 'essential', expense_necessity_source: null },
    { expense_pattern: null, expense_pattern_source: 'category_default' },
    { expense_necessity: null, expense_necessity_source: 'category_default' },
  ]) assert.throws(() => lerPrevia(previewWithClassification(invalid)), JSON.stringify(invalid));
});

test('income and transfers preserve four cleared metadata columns', () => {
  for (const kind of ['income', 'transfer']) {
    const raw = previewWithClassification(unknownClassification, { kind });
    assert.deepEqual(lerPrevia(raw).schedule[0], raw.schedule[0]);
  }
});

test('income and transfers reject known expense classification', () => {
  for (const kind of ['income', 'transfer']) {
    for (const classification of [explicitClassification, {
      expense_pattern: 'variable', expense_pattern_source: 'category_default',
    }, {
      expense_necessity: 'essential', expense_necessity_source: 'explicit',
    }]) assert.throws(() => lerPrevia(previewWithClassification(classification, { kind })));
  }
});

test('income and transfers reject explicit NULL provenance as expense metadata', () => {
  for (const kind of ['income', 'transfer']) {
    for (const classification of [{
      expense_pattern: null, expense_pattern_source: 'explicit',
    }, {
      expense_necessity: null, expense_necessity_source: 'explicit',
    }]) assert.throws(() => lerPrevia(previewWithClassification(classification, { kind })));
  }
});
