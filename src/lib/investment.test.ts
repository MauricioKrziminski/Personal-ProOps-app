import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contasParaInvestir, decodeInvestmentLinkCandidates, decodeInvestmentMovements, decodeInvestmentPositions,
  efeitoDoInvestimento, entradaDoInvestimento, mensagemDoInvestimento, naturezaDoMovimento, validarInvestimento,
  type InvestmentDraft,
} from './investment.ts';

const posicoes = decodeInvestmentPositions([
  { account_id: 'p', workspace_id: 'w', name: 'Corretora', type: 'investment', type_label: 'Conta de investimento', balance_cents: '30000', net_contributed_cents: '25000', movements_count: 2 },
]);
const contas = [
  { id: 'a', name: 'Nubank', type: 'checking', archived: false, balance_cents: 100000 },
  { id: 'c', name: 'Cartão', type: 'credit_card', archived: false, balance_cents: null },
  { id: 'q', name: 'Outra corretora', type: 'investment', archived: false, balance_cents: 0 },
  { id: 'x', name: 'Velha', type: 'checking', archived: true, balance_cents: 0 },
];
const hoje = '2026-10-04';
const ctx = { contas, posicoes, hoje };
const base: InvestmentDraft = { direcao: 'aplicar', posicaoId: 'p', contaId: null, vincularId: null, cents: 0, data: hoje, nota: '' };

test('decodifica centavos de texto e recusa fora da faixa', () => {
  assert.equal(posicoes[0].balance_cents, 30000);
  assert.equal(posicoes[0].type_label, 'Conta de investimento');
  assert.throws(() => decodeInvestmentPositions([{ ...posicoes[0], balance_cents: '9007199254740993' }]));
  assert.throws(() => decodeInvestmentMovements({ position_account_id: 'p', movements: 'x' }));
  assert.equal(decodeInvestmentLinkCandidates([{ id: 't', amount_cents: '700', occurred_on: '2026-10-04', kind: 'contribution', position_account_id: 'p' }])[0].amount_cents, 700);
});

test('só contas comuns, sem cartão, investimento nem arquivada, servem de outra ponta', () => {
  assert.deepEqual(contasParaInvestir(contas).map((c) => c.id), ['a']);
});

test('formulário incompleto não está pronto e não explica o que ainda não foi pedido', () => {
  assert.deepEqual(validarInvestimento(base, ctx), { pronto: false, motivo: null });
  assert.deepEqual(validarInvestimento({ ...base, contaId: 'a' }, ctx), { pronto: false, motivo: null });
  assert.equal(validarInvestimento({ ...base, contaId: 'a', cents: 100 }, ctx).pronto, true);
  assert.equal(validarInvestimento({ ...base, contaId: 'a', cents: 100, data: '' }, ctx).pronto, false);
});

test('origem igual à posição bloqueia com motivo; cartão e outra posição também', () => {
  assert.match(validarInvestimento({ ...base, contaId: 'p', cents: 100 }, ctx).motivo ?? '', /diferentes/);
  assert.match(validarInvestimento({ ...base, contaId: 'c', cents: 100 }, ctx).motivo ?? '', /cartão/i);
  assert.match(validarInvestimento({ ...base, contaId: 'q', cents: 100 }, ctx).motivo ?? '', /investimento/);
});

test('resgatar além do disponível bloqueia dizendo quanto há; dentro passa; total passa', () => {
  const d: InvestmentDraft = { ...base, direcao: 'resgatar', contaId: 'a', cents: 30001 };
  const r = validarInvestimento(d, ctx, (c) => `R$ ${c / 100}`);
  assert.equal(r.pronto, false);
  assert.match(r.motivo ?? '', /R\$ 300/);
  assert.equal(validarInvestimento({ ...d, cents: 30000 }, ctx).pronto, true);
  assert.equal(validarInvestimento({ ...d, cents: 1 }, ctx).pronto, true);
});

test('vincular dispensa valor e data; centavos não inteiros seguros recusam', () => {
  assert.equal(validarInvestimento({ ...base, vincularId: 't', data: '' }, ctx).pronto, true);
  assert.equal(validarInvestimento({ ...base, contaId: 'a', cents: 1.5 }, ctx).pronto, false);
  assert.equal(validarInvestimento({ ...base, contaId: 'a', cents: Number.MAX_SAFE_INTEGER + 2 }, ctx).pronto, false);
});

test('comandos exatos: aplicar, resgatar, vincular, editar', () => {
  assert.deepEqual(entradaDoInvestimento({ ...base, contaId: 'a', cents: 500, nota: ' CDB ' }),
    { op: 'contribute', position_account_id: 'p', from_account_id: 'a', amount_cents: '500', occurred_on: hoje, note: 'CDB' });
  assert.deepEqual(entradaDoInvestimento({ ...base, direcao: 'resgatar', contaId: 'a', cents: 500 }),
    { op: 'redeem', position_account_id: 'p', to_account_id: 'a', amount_cents: '500', occurred_on: hoje, note: null });
  assert.deepEqual(entradaDoInvestimento({ ...base, vincularId: 't' }), { op: 'link', transfer_id: 't' });
  assert.deepEqual(entradaDoInvestimento({ ...base, contaId: 'a', cents: 700 }, { id: 'm', revision: 3 }),
    { op: 'edit', movement_id: 'm', amount_cents: '700', occurred_on: hoje, expected_revision: 3 });
});

test('efeito antes → depois nas duas contas; data futura e vínculo não mexem no saldo de hoje', () => {
  const aplicar = efeitoDoInvestimento({ ...base, contaId: 'a', cents: 1000 }, ctx);
  assert.deepEqual(aplicar.map((l) => [l.conta, l.antes, l.depois]), [['Nubank', 100000, 99000], ['Corretora', 30000, 31000]]);
  const resgatar = efeitoDoInvestimento({ ...base, direcao: 'resgatar', contaId: 'a', cents: 1000 }, ctx);
  assert.deepEqual(resgatar.map((l) => [l.conta, l.antes, l.depois]), [['Corretora', 30000, 29000], ['Nubank', 100000, 101000]]);
  assert.deepEqual(efeitoDoInvestimento({ ...base, contaId: 'a', cents: 1000, data: '2026-10-09' }, ctx), []);
  assert.deepEqual(efeitoDoInvestimento({ ...base, vincularId: 't' }, ctx), []);
});

test('natureza e mensagens do banco', () => {
  const m = decodeInvestmentMovements({ position_account_id: 'p', has_more: false, next_before: null, movements: [
    { id: 'm1', kind: 'redemption', amount_cents: '500', occurred_on: hoje, status: 'cleared', counterparty_account_id: 'a', counterparty_name: 'Nubank',
      transfer_id: 't', created_transfer: false, revision: 2, created_at: '2026-10-04T10:00:00Z', description: null }] }).movements[0];
  assert.match(naturezaDoMovimento(m), /Resgatado para Nubank/);
  assert.match(naturezaDoMovimento(m), /vinculada/);
  assert.match(mensagemDoInvestimento({ code: 'PT422', message: 'SALDO_INSUFICIENTE: faltam 150 centavos em 04/10/2026' }, 'x', (c) => `R$ ${c / 100}`), /R\$ 1.5.*04\/10\/2026/);
  assert.equal(mensagemDoInvestimento({ code: 'PT409', message: 'A movimentação mudou. Abra de novo' }, 'x'), 'A movimentação mudou. Abra de novo');
  const apagado = decodeInvestmentMovements({ position_account_id: 'p', has_more: true, next_before: { on: '2026-10-01', created: '2026-10-01T10:00:00Z', id: 'm0' },
    movements: [{ id: 'm2', kind: 'contribution', amount_cents: null, occurred_on: '2026-10-01', status: null, transfer_id: null, created_transfer: true, revision: 1, created_at: '2026-10-01T10:00:00Z' }] });
  assert.equal(apagado.movements[0].deleted, true);
  assert.equal(naturezaDoMovimento(apagado.movements[0]), 'Lançamento apagado');
  assert.deepEqual(apagado.next_before, { on: '2026-10-01', created: '2026-10-01T10:00:00Z', id: 'm0' });
  assert.equal(mensagemDoInvestimento(new Error('rede'), 'Não deu'), 'Não deu');
});
