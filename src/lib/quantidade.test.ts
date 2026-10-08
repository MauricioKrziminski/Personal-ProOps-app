import assert from 'node:assert/strict';
import { test } from 'node:test';

import { digitarQuantidade } from './quantidade.ts';

test('quantidade: digitar com o campo já em foco não engole o dígito novo', () => {
  assert.deepEqual(digitarQuantidade('125', { min: 1, max: 44 }), { mostra: '125', valor: 44 });
  assert.deepEqual(digitarQuantidade('15', { min: 1, max: 44 }), { mostra: '15', valor: 15 });
});

test('quantidade: apagar para digitar outro número não vira o mínimo no meio do caminho', () => {
  assert.deepEqual(digitarQuantidade('', { min: 1, max: 44 }), { mostra: '', valor: null });
  assert.deepEqual(digitarQuantidade('0', { min: 1, max: 44 }), { mostra: '0', valor: null });
});

test('quantidade: só dígitos, e no máximo um além do tamanho do teto', () => {
  assert.deepEqual(digitarQuantidade('1a2', { min: 1, max: 9 }), { mostra: '12', valor: 9 });
  assert.deepEqual(digitarQuantidade('12345', { min: 1, max: 72 }), { mostra: '123', valor: 72 });
});
