import assert from 'node:assert/strict';
import { test } from 'node:test';

import { passoDaVolta } from './reabrir-ao-voltar.ts';

test('a folha só reabre depois de a tela ter saído do foco e voltado', () => {
  assert.deepEqual(passoDaVolta('pedido', true), { estado: 'pedido', abrir: false }, 'o render do toque não reabre');
  assert.deepEqual(passoDaVolta('pedido', false), { estado: 'fora', abrir: false });
  assert.deepEqual(passoDaVolta('fora', false), { estado: 'fora', abrir: false }, 'enquanto está na outra tela, espera');
  assert.deepEqual(passoDaVolta('fora', true), { estado: 'nada', abrir: true }, 'voltou: reabre uma vez');
  assert.deepEqual(passoDaVolta('nada', true), { estado: 'nada', abrir: false });
});
