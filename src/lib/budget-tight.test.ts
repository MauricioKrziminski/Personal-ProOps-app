import assert from 'node:assert/strict';
import { test } from 'node:test';

import { orcamentosApertados } from './budget-tight.ts';

test('o aviso conta o comprometido, o número mostrado é só o gasto', () => {
  const [a] = orcamentosApertados([
    { category: 'alimentação', limit_cents: 200000, spent_cents: 150000, committed_cents: 30000 },
  ]);
  assert.equal(a.categoria, 'alimentação');
  assert.equal(a.fracaoGasta, 0.75);
  assert.equal(a.restante, 50000);
  assert.equal(a.estourou, false);
});

test('abaixo do limiar não entra; sem limite não entra', () => {
  assert.deepEqual(
    orcamentosApertados([
      { category: 'lazer', limit_cents: 100000, spent_cents: 10000, committed_cents: 0 },
      { category: 'casa', limit_cents: 0, spent_cents: 90000 },
    ]),
    []
  );
});

test('gasto mais comprometido acima do limite marca estouro, com números em string', () => {
  const [a] = orcamentosApertados([
    { category: 'mercado', limit_cents: '100000', spent_cents: '90000', committed_cents: '20000' },
  ]);
  assert.equal(a.estourou, true);
  assert.equal(a.restante, 10000);
});
