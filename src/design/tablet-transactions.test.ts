import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { tabletPaneWidths } from './adaptive-window.ts';

test('transaction workspace keeps the native ledger below the safe two-pane width', () => {
  assert.equal(tabletPaneWidths(920 - 48).twoPane, false);
  assert.equal(tabletPaneWidths(1200 - 48).twoPane, true);
});

test('transactions uses a virtualized ledger beside contextual controls only in wide windows', () => {
  const source = readFileSync('src/app/finance/transactions.tsx', 'utf8');
  assert.match(source, /tabletPaneWidths\(Math\.min\(width, 1200\) - Space\.lg \* 2\)\.twoPane/);
  assert.match(source, /<AdaptivePanes/);
  assert.match(source, /main=\{ledger\}/);
  assert.match(source, /support=\{controls\}/);
  assert.match(source, /ListHeaderComponent=\{wideWorkspace \? null : header\}/);
  assert.match(source, /headerLargeTitle: windowClass === 'compact'/);
});
