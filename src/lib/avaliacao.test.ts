import assert from 'node:assert/strict';
import { test } from 'node:test';

import { devePedirAvaliacao } from './avaliacao.ts';

const DIA = 86_400_000;
const agora = Date.parse('2026-10-09T12:00:00Z');
const conta = (dias: number) => new Date(agora - dias * DIA).toISOString();
const ok = { salvamentos: 5, ultimoPedido: null };

test('avaliação: 7 dias de conta, 5 salvamentos e nada pedido em 120 dias', () => {
  assert.equal(devePedirAvaliacao(conta(7), ok, agora), true);
  assert.equal(devePedirAvaliacao(conta(6), ok, agora), false, 'conta nova demais');
  assert.equal(devePedirAvaliacao(conta(30), { ...ok, salvamentos: 4 }, agora), false, 'poucos salvamentos');
  assert.equal(devePedirAvaliacao(conta(30), { ...ok, ultimoPedido: agora - 119 * DIA }, agora), false, 'pediu há pouco');
  assert.equal(devePedirAvaliacao(conta(300), { ...ok, ultimoPedido: agora - 120 * DIA }, agora), true);
});

test('avaliação: data da conta ausente ou ilegível nunca pede', () => {
  assert.equal(devePedirAvaliacao(null, ok, agora), false);
  assert.equal(devePedirAvaliacao('ontem', ok, agora), false);
});
