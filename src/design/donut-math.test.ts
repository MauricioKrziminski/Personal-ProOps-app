import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHAVE_OUTRAS, fatiaNoPonto, fatias } from './donut-math.ts';

test('as fatias seguem a ordem do maior e cobrem a volta com respiro', () => {
  const f = fatias([{ chave: 'b', valor: 30 }, { chave: 'a', valor: 50 }, { chave: 'c', valor: 20 }]);
  assert.deepEqual(f.map((x) => x.chave), ['a', 'b', 'c']);
  assert.ok(Math.abs(f[0].inicio - 0.003) < 1e-9);
  assert.ok(Math.abs(f[0].fim - 0.497) < 1e-9);
  assert.ok(f[2].fim <= 1);
  assert.deepEqual(f.map((x) => x.tom), [0, 1, 2]);
});

test('acima de seis, o resto vira "outras" no último tom', () => {
  const f = fatias(Array.from({ length: 8 }, (_, i) => ({ chave: `c${i}`, valor: 10 })));
  assert.equal(f.length, 7);
  assert.equal(f[6].chave, CHAVE_OUTRAS);
  assert.equal(f[6].valor, 20);
  assert.equal(f[6].tom, 5);
});

test('uma fatia só fecha a volta', () => {
  const [f] = fatias([{ chave: 'a', valor: 10 }]);
  assert.equal(f.inicio, 0);
  assert.equal(f.fim, 1);
});

test('zero e negativo não entram', () => {
  assert.deepEqual(fatias([{ chave: 'a', valor: 0 }, { chave: 'b', valor: -5 }]), []);
});

test('o toque acha a fatia pelo ângulo e ignora o furo', () => {
  const lista = fatias([{ chave: 'a', valor: 50 }, { chave: 'b', valor: 50 }]);
  assert.equal(fatiaNoPonto(60, 12, 50, 30, 50, lista), 0);
  assert.equal(fatiaNoPonto(40, 88, 50, 30, 50, lista), 1);
  assert.equal(fatiaNoPonto(50, 50, 50, 30, 50, lista), -1);
});
