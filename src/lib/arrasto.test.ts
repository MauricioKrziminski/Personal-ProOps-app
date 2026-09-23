import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ladosDoArrasto, temArrasto } from './arrasto.ts';

const a = (label: string, extra: Record<string, unknown> = {}) => ({ label, onPress: () => {}, ...extra });

test('cada ação vai para o lado marcado, na ordem declarada', () => {
  const lados = ladosDoArrasto([a('Editar', { arrasto: 'direita' }), a('Apagar', { arrasto: 'esquerda', destructive: true })]);
  assert.deepEqual(lados.direita.map((x) => x.label), ['Editar']);
  assert.deepEqual(lados.esquerda.map((x) => x.label), ['Apagar']);
  assert.equal(lados.mais, false, 'nada sobrou: sem "Mais"');
});

test('"Mais" aparece quando sobra ação sem lado, e "fora" não conta', () => {
  assert.equal(ladosDoArrasto([a('Fixar', { arrasto: 'direita' }), a('Cor')]).mais, true);
  assert.equal(ladosDoArrasto([a('Editar', { arrasto: 'direita' }), a('Ver detalhe', { arrasto: 'fora' })]).mais, false);
});

test('submenu sem lado conta para o "Mais" (é assim que "Mover para" chega)', () => {
  assert.equal(ladosDoArrasto([a('Fixar', { arrasto: 'direita' }), { label: 'Mover para', actions: [a('Casa')] }]).mais, true);
});

test('ação desligada ou sem onPress não entra no arrasto nem no "Mais"', () => {
  const lados = ladosDoArrasto([a('Paguei', { arrasto: 'direita', disabled: true }), { label: 'Mover para', arrasto: 'esquerda' }]);
  assert.deepEqual(lados.direita, []);
  assert.deepEqual(lados.esquerda, []);
  assert.equal(lados.mais, false);
});

test('até o fim só com desfaz: a ponta é a primeira do lado', () => {
  const lados = ladosDoArrasto([
    a('Fixar', { arrasto: 'direita', desfaz: true }),
    a('Apagar', { arrasto: 'esquerda', destructive: true }),
  ]);
  assert.equal(lados.pontaDireita?.label, 'Fixar');
  assert.equal(lados.pontaEsquerda, null, 'Apagar nunca vai sozinho');
});

test('temArrasto: só quando há algo para mostrar', () => {
  assert.equal(temArrasto([a('Ver', { arrasto: 'fora' })]), false);
  assert.equal(temArrasto([a('Editar', { arrasto: 'direita' })]), true);
  assert.equal(temArrasto([]), false);
});
