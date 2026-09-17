import assert from 'node:assert/strict';
import { test } from 'node:test';

import { caixaDasContas } from '../lib/account-cash.ts';
import { previewAccountBalances } from './preview-account-balances.ts';

test('preview account balances satisfy the same cash contract as production', () => {
  const caixa = caixaDasContas(previewAccountBalances);
  assert.equal(caixa.total, 904040);
  assert.ok(caixa.linhas.every((line) => Number.isFinite(line.cents)));
  assert.equal(caixa.aReceber, 0);
});
