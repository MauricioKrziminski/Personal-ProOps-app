import assert from 'node:assert/strict';
import test from 'node:test';
import { faltaDepoisDeDesfazer, mensagemDeDesfazer } from './pagamentos-da-fatura.ts';

const fmt = (c: number) => `R$ ${c}`;

test('falta depois de desfazer soma o pagamento de volta, sem passar do total', () => {
  assert.equal(faltaDepoisDeDesfazer(1000, 1000, 300), 300);
  assert.equal(faltaDepoisDeDesfazer(1000, 600, 200), 600);
  assert.equal(faltaDepoisDeDesfazer(1000, 100, 500), 1000);
});

test('mensagem de desfazer', () => {
  assert.equal(mensagemDeDesfazer(300, 'Conta', 300, fmt), 'R$ 300 volta para Conta. A fatura fica com R$ 300 em aberto.');
});
