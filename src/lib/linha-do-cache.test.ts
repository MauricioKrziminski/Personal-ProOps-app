import assert from 'node:assert/strict';
import { test } from 'node:test';

import { acharLinhaNoCache } from './linha-do-cache.ts';

const tx = (id: string, extra = {}) => ({ id, amount_cents: 100, ...extra });

test('acha a linha em página de useInfiniteQuery e em lista simples, a mais recente vence', () => {
  const r = acharLinhaNoCache([
    { data: { pages: [[tx('a')], [tx('b', { amount_cents: 1 })]] }, updatedAt: 10, invalidada: false },
    { data: [tx('b', { amount_cents: 2 })], updatedAt: 20, invalidada: false },
  ], 'b');
  assert.equal(r?.updatedAt, 20);
  assert.equal(r?.linha.amount_cents, 2);
});

test('não semeia pagamento de dívida, entrada invalidada nem id ausente', () => {
  assert.equal(acharLinhaNoCache([{ data: [tx('a', { debt_id: 'd1' })], updatedAt: 1, invalidada: false }], 'a'), undefined);
  assert.equal(acharLinhaNoCache([{ data: [tx('a')], updatedAt: 1, invalidada: true }], 'a'), undefined);
  assert.equal(acharLinhaNoCache([{ data: undefined, updatedAt: 1, invalidada: false }, { data: [tx('x')], updatedAt: 1, invalidada: false }], 'a'), undefined);
});
