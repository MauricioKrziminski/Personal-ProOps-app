/** `node --test`: a janela de "ver mais" das listas que chegam inteiras de uma RPC. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PASSO, janela } from './aos-poucos.ts';

test('mostra o primeiro passo e conta o que falta', () => {
  const itens = Array.from({ length: 57 }, (_, i) => i);
  const j = janela(itens, PASSO);
  assert.equal(j.visiveis.length, PASSO);
  assert.equal(j.restantes, 57 - PASSO);
  assert.equal(j.proximos, PASSO);
});

test('o último passo mostra só o que sobra', () => {
  const itens = Array.from({ length: 25 }, (_, i) => i);
  const j = janela(itens, PASSO);
  assert.equal(j.proximos, 25 - PASSO);
  assert.equal(janela(itens, PASSO * 2).restantes, 0);
});

test('lista curta não tem "ver mais"', () => {
  assert.equal(janela([1, 2, 3], PASSO).restantes, 0);
  assert.equal(janela([], PASSO).visiveis.length, 0);
});
