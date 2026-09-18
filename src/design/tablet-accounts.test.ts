import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('accounts keeps the ledger primary and decision support secondary on tablets', () => {
  const source = readFileSync('src/app/finance/accounts.tsx', 'utf8');

  assert.match(source, /useAdaptiveWindow/);
  assert.match(source, /const tablet = windowClass !== 'compact'/);
  assert.match(source, /<AdaptivePanes/);
  assert.match(source, /main=\{ledger\}/);
  assert.match(source, /support=\{decisionSupport\}/);
  assert.match(source, /singlePaneContent=\{compactBody\}/);
  assert.match(source, /wide=\{tablet\}/);
  assert.match(source, /testID="accounts-tablet-workspace"/);
});

test('accounts tablet support does not duplicate ledger sections', () => {
  const source = readFileSync('src/app/finance/accounts.tsx', 'utf8');
  const decisionSupport = source.slice(source.indexOf('const decisionSupport'));

  assert.doesNotMatch(decisionSupport, /accountSections/);
  assert.match(decisionSupport, /hero/);
  assert.match(decisionSupport, /defaultAccount/);
});
