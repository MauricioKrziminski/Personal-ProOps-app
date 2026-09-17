import assert from 'node:assert/strict';
import { test } from 'node:test';

import { escalaDaSerie, indiceNoX, posicaoDoRotulo } from './sparkline-geometry.ts';

test('a escala põe as pontas no respiro e o maior valor mais alto', () => {
  const e = escalaDaSerie([0, 100], 112, 56)!;
  assert.equal(e.x(0), 6);
  assert.equal(e.x(1), 106);
  assert.ok(e.y(100) < e.y(0));
});

test('série plana não divide por zero', () => {
  const e = escalaDaSerie([500, 500], 100, 50)!;
  assert.ok(Number.isFinite(e.y(500)));
});

test('menos de dois pontos ou largura zero não têm escala', () => {
  assert.equal(escalaDaSerie([1], 100, 50), null);
  assert.equal(escalaDaSerie([1, 2], 0, 50), null);
});

test('o índice do dedo prende nas pontas', () => {
  assert.equal(indiceNoX(-50, 5, 112), 0);
  assert.equal(indiceNoX(500, 5, 112), 4);
  assert.equal(indiceNoX(56, 5, 112), 2);
});

test('o rótulo fica dentro da largura', () => {
  assert.equal(posicaoDoRotulo(5, 300, 100), 0);
  assert.equal(posicaoDoRotulo(290, 300, 100), 200);
  assert.equal(posicaoDoRotulo(150, 300, 100), 100);
});
