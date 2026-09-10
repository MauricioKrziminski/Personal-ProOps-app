import { test } from 'node:test';
import assert from 'node:assert/strict';

import { accountLabel } from './accounts.ts';

test('o cartão diz que é cartão — foi o que custou R$ 4.000 em produção', () => {
  // As quatro contas reais de 09/09/2026, na ordem em que apareciam no seletor.
  assert.equal(accountLabel({ name: 'Conta corrente', type: 'checking' }), 'Conta corrente');
  assert.equal(accountLabel({ name: 'Conta corrente BB', type: 'checking' }), 'Conta corrente BB');
  assert.equal(accountLabel({ name: 'BB', type: 'credit_card' }), 'BB · Cartão');
  assert.equal(accountLabel({ name: 'Nubank', type: 'credit_card' }), 'Nubank · Cartão');
});

test('nome que já diz o tipo não repete', () => {
  // Repetir ensina o usuário a ignorar o sufixo, que é onde a informação mora.
  assert.equal(accountLabel({ name: 'Cartão Nubank', type: 'credit_card' }), 'Cartão Nubank');
  assert.equal(accountLabel({ name: 'cartao inter', type: 'credit_card' }), 'cartao inter');
  assert.equal(accountLabel({ name: 'Poupança', type: 'savings' }), 'Poupança');
});

test('os outros tipos também aparecem — a regra não é só sobre cartão', () => {
  assert.equal(accountLabel({ name: 'Nubank', type: 'savings' }), 'Nubank · Poupança');
  assert.equal(accountLabel({ name: 'Carteira', type: 'cash' }), 'Carteira · Dinheiro');
  assert.equal(accountLabel({ name: 'XP', type: 'investment' }), 'XP · Investimento');
});

test('sem conta e tipo desconhecido não quebram a tela', () => {
  assert.equal(accountLabel(null), 'Sem conta');
  assert.equal(accountLabel(undefined), 'Sem conta');
  assert.equal(accountLabel({ name: 'Alguma', type: null }), 'Alguma');
  assert.equal(accountLabel({ name: 'Alguma', type: 'coisa_nova' }), 'Alguma');
});
