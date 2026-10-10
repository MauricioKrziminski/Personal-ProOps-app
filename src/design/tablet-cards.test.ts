import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('cards keeps compact reading order and composes a measured tablet decision workspace', () => {
  const source = readFileSync('src/app/finance/cards.tsx', 'utf8');

  assert.match(source, /const tablet = windowClass !== 'compact'/);
  assert.match(source, /<Screen grouped wide=\{tablet\}/);
  assert.match(source, /<AdaptivePanes/);
  assert.match(source, /main=\{/);
  assert.match(source, /support=\{decisionSupport\}/);
  assert.match(source, /singlePaneContent=\{compactBody\}/);
  assert.match(source, /testID="cards-tablet-workspace"/);
  assert.match(source, /router\.push\(\{ pathname: '\/finance\/wallet'/);
  assert.match(source, /router\.push\(\{ pathname: '\/finance\/invoice\/\[id\]'/);
  assert.match(source, /title="Faturas anteriores"/);
  // o MESMO número do card da lista: o total, com "pago · falta" quando paga em parte
  assert.match(source, /cents=\{Number\(contexto\.invoice_total_cents \?\? 0\)\}/);
  assert.match(source, /parcialDoContexto/);
});
