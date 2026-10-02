import { test } from 'node:test';
import assert from 'node:assert/strict';

import { accountSelectOptions, accountLabel, inicialParaOSaldo, saldoDaConta } from './accounts.ts';

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

test('O saldo de UMA conta: dinheiro mostra o confirmado; cartão, o total (24/09/2026)', () => {
  // "meu pai… como acessar saldo de uma conta específica": o extrato da conta mostrava só os
  // totais do período. A régua é a mesma da tela Contas — uma função, as duas telas.
  const corrente = { type: 'checking', balance_cents: 50000, cleared_cents: 30000, pending_in_cents: 20000, pending_out_cents: 0 };
  assert.deepEqual(saldoDaConta(corrente), { cents: 30000, previsto: 20000, rotulo: 'Saldo', previstoTexto: 'a receber' });
  const cartao = { type: 'credit_card', balance_cents: -90000, cleared_cents: 0, pending_in_cents: 0, pending_out_cents: 60000 };
  assert.deepEqual(saldoDaConta(cartao), { cents: -90000, previsto: 60000, rotulo: 'Saldo do cartão', previstoTexto: 'a vencer' });
});

test('editar o saldo atual anda o inicial pela diferença, e sem mexer não muda nada', () => {
  // O Nubank de produção (28/09/2026): inicial 867,86, a lista mostra 162,51.
  assert.equal(inicialParaOSaldo(16251, 16251, 86786), 86786);
  // A pessoa corrige para o que o banco mostra (200,00): o atual vira 200,00.
  const inicial = inicialParaOSaldo(20000, 16251, 86786);
  assert.equal(inicial, 90535);
  assert.equal(inicial + (16251 - 86786), 20000, 'inicial + lançamentos = o digitado');
  // Pode ficar negativo (conta no cheque especial).
  assert.equal(inicialParaOSaldo(-5000, 16251, 86786), 86786 - 21251);
});


test('filtros e formulários distinguem cartão, conta histórica e ausência com o mesmo seletor', () => {
  const options = accountSelectOptions([
    { id: 'card', name: 'Nubank', type: 'credit_card', closing_day: 10 },
    { id: 'bank', name: 'Nubank', type: 'checking', archived: true },
  ], 'Sem conta', 'none');
  assert.deepEqual(options.map(o => o.id), ['none', 'bank', 'card']);
  assert.equal(options[0].neutral, true);
  assert.equal(options[1].meta, 'Corrente · arquivada');
  assert.equal(options[1].group, 'CONTAS');
  assert.equal(options[2].meta, 'Cartão · fecha dia 10');
  assert.equal(options[2].group, 'CARTÕES');
  assert.equal(options[2].icon, 'creditcard');
  assert.equal(accountSelectOptions([{ id: 'cash', name: 'Carteira', type: 'cash' }])[0].group, undefined);
});


test('F02: confirma origem por UUID e compatibilidade atual, sem adotar por nome', async () => {
  const lib = await import('./accounts.ts');
  const card = { id: 'created-card', availability: 'active', account: { id: 'created-card', type: 'credit_card', archived: false } };
  assert.equal(lib.createdAccountSelection(card, ['credit_card']), 'created-card');
  assert.equal(lib.createdAccountSelection(card, ['checking', 'savings']), null, 'método mudou para débito enquanto o cadastro respondia');
});

test('F02: resultado tardio, arquivado, apagado ou com identidade divergente não sobrescreve origem', async () => {
  const lib = await import('./accounts.ts');
  const result = { id: 'created', availability: 'active', account: { id: 'created', type: 'checking', archived: false } };
  assert.equal(lib.createdAccountSelection(result, ['checking'], false), null);
  assert.equal(lib.createdAccountSelection({ ...result, availability: 'archived' }, ['checking']), null);
  assert.equal(lib.createdAccountSelection({ ...result, availability: 'unavailable', account: null }, ['checking']), null);
  assert.equal(lib.createdAccountSelection({ ...result, account: { ...result.account, archived: true } }, ['checking']), null);
  assert.equal(lib.createdAccountSelection({ ...result, account: { ...result.account, id: 'other' } }, ['checking']), null);
});
