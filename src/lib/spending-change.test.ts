import assert from 'node:assert/strict';
import test from 'node:test';
import { barFraction, decodeSpendingChange, percentText, rowLinkParams, visibleRows } from './spending-change.ts';

const raw = {
  current_cents: '1800', previous_cents: '8377', delta_cents: '-6577', percent_bp: -7852,
  rows: [
    { key: 'a', label: 'a', current_cents: '1500', previous_cents: '7977', delta_cents: '-6477' },
    { key: null, label: 'Sem categoria', current_cents: '300', previous_cents: '0', delta_cents: '300' },
    { key: 'z', label: 'z', current_cents: '0', previous_cents: '400', delta_cents: '-400' },
    { key: 'q', label: 'q', current_cents: '5', previous_cents: '5', delta_cents: '0' },
  ],
};
// 1500+300+0+5 = 1805 ≠ 1800: a fixture precisa fechar, então ajusta o topo.
raw.current_cents = '1805'; raw.previous_cents = '8382'; raw.delta_cents = '-6577';

test('decodifica e a soma das linhas fecha a diferença', () => {
  const r = decodeSpendingChange(raw);
  assert.equal(r.rows.reduce((s, x) => s + x.delta, 0), r.delta);
});
test('recusa resposta cuja soma não fecha', () => {
  assert.throws(() => decodeSpendingChange({ ...raw, rows: raw.rows.slice(0, 2) }));
});
test('ordena por |diferença| e esconde zeradas até "Ver todas"', () => {
  const r = decodeSpendingChange(raw);
  assert.deepEqual(visibleRows(r.rows, false).map((x) => x.key), ['a', 'z', null]);
  assert.equal(visibleRows(r.rows, true).length, 4);
});
test('percentual: nulo sem anterior, sinal com anterior', () => {
  assert.equal(percentText(null), null);
  assert.equal(percentText(-7852), '−79%');
  assert.equal(percentText(1250), '+13%');
});
test('barra proporcional ao maior', () => {
  const r = decodeSpendingChange(raw);
  assert.equal(barFraction(-6477, r.rows), 1);
  assert.equal(barFraction(0, []), 0);
});
test('link por linha usa as bordas exatas e o "sem X" da dimensão', () => {
  const p = { curFrom: '2026-10-01', curTo: '2026-10-31', prevFrom: '2026-09-01', prevTo: '2026-09-30' };
  assert.deepEqual(rowLinkParams('category', { key: 'lazer' }, p, 'previous'),
    { from: '2026-09-01', to: '2026-09-30', kind: 'expense', lente: 'gasto', category: 'lazer' });
  assert.equal(rowLinkParams('category', { key: null }, p, 'current').category, 'none');
  assert.equal(rowLinkParams('subcategory', { key: null }, p, 'current').subcategoryId, 'none');
  assert.equal(rowLinkParams('payment_method', { key: null }, p, 'current').paymentMethods, 'not_informed');
  assert.equal(rowLinkParams('pattern', { key: 'fixed' }, p, 'current').expensePatterns, 'fixed');
  assert.equal(rowLinkParams('necessity', { key: null }, p, 'current').expenseNecessities, 'not_informed');
});
