import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('wallet keeps the real flight routes while opting into a measured tablet workspace', () => {
  const source = readFileSync('src/app/finance/wallet.tsx', 'utf8');

  assert.match(source, /useAdaptiveWindow/);
  assert.match(source, /const tablet = windowClass !== 'compact'/);
  assert.match(source, /<Screen wide=\{tablet\}/);
  assert.match(source, /<AdaptivePanes/);
  assert.match(source, /main=\{walletVisual\}/);
  assert.match(source, /support=\{walletContext\}/);
  assert.match(source, /overflow: 'hidden'/);
  assert.match(source, /singlePaneContent=\{compactBody\}/);
  assert.match(source, /navigation\.addListener\('beforeRemove'/);
  assert.match(source, /pathname: '\/finance\/invoice\/\[id\]'/);
  assert.match(source, /pathname: '\/finance\/invoices'/);
  assert.match(source, /['"]\/finance\/cards['"]/);
  assert.match(source, /<EmptyState/);
  assert.match(source, /<ErrorCard/);
}
);

test('invoice history uses a bounded tablet list and truthful selected invoice context', () => {
  const source = readFileSync('src/app/finance/invoices.tsx', 'utf8');

  assert.match(source, /useAdaptiveWindow/);
  assert.match(source, /const tablet = windowClass !== 'compact'/);
  assert.match(source, /<Screen grouped wide=\{tablet\}/);
  assert.match(source, /<AdaptivePanes/);
  assert.match(source, /singlePaneContent=\{compactBody\}/);
  assert.match(source, /cents=\{selectedInvoice\.total_cents\}/);
  assert.match(source, /Total de compras/);
  assert.match(source, /pathname: '\/finance\/invoice\/\[id\]'/);
  assert.match(source, /pathname: '\/finance\/\[txId\]'/);
  assert.match(source, /invoices\.isError/);
  assert.match(source, /invoices\.isLoading/);
  assert.match(source, /Nenhuma fatura ainda/);
  assert.match(source, /headerLargeTitle: !tablet/);
}
);
