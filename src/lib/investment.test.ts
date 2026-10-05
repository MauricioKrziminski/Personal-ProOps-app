import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contasParaInvestir, decodeInvestmentLinkCandidates, decodeInvestmentMovements, decodeInvestmentPositions,
  efeitoDoInvestimento, entradaDoInvestimento, entradaDoValor, frasesDaPosicao, mensagemDoInvestimento, naturezaDoMovimento, percentualDoResultado,
  validarInvestimento, validarValor, type InvestmentDraft, type ValueDraft,
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

// ── F13: valor atual, aplicado, resultado e rendimento ────────────────────────────────────────────
const nova = (extra: Record<string, unknown> = {}) => decodeInvestmentPositions([{
  account_id: 'p', workspace_id: 'w', name: 'Corretora', balance_cents: '30000', net_contributed_cents: '25000', movements_count: 2,
  value_cents: '33000', principal_cents: '30000', result_cents: '3000', result_quality: 'conhecido', received_cents: '500', last_valuation_on: '2026-10-01', opening_on: null,
  ...extra,
}])[0];

test('F13: decodifica valor, aplicado, resultado, qualidade e recebido; resultado indisponível fica null, nunca zero', () => {
  const p = nova();
  assert.deepEqual([p.value_cents, p.principal_cents, p.result_cents, p.result_quality, p.received_cents, p.last_valuation_on], [33000, 30000, 3000, 'conhecido', 500, '2026-10-01']);
  const sem = nova({ result_cents: null, result_quality: 'indisponível', last_valuation_on: null });
  assert.equal(sem.result_cents, null);
  assert.equal(nova({ result_cents: '-1200', result_quality: 'estimado' }).result_cents, -1200);
  assert.throws(() => nova({ result_quality: 'otimo' }));
  assert.equal(nova({ value_cents: undefined }).value_cents, 30000, 'sem valor do servidor, o saldo no app');
});

test('F13: frases da posição — indisponível não escreve número nem zero; estimado avisa', () => {
  const brl = (c: number) => `R$ ${c / 100}`;
  const sem = frasesDaPosicao(nova({ result_cents: null, result_quality: 'indisponível', last_valuation_on: null }), brl);
  assert.equal(sem.resultado, null);
  assert.match(sem.qualidade, /Atualize o valor para ver o resultado/);
  assert.equal(sem.atualizado, null);
  const ok = frasesDaPosicao(nova(), brl);
  assert.equal(ok.resultado, 3000);
  assert.equal(ok.atualizado, 'atualizado em 01/10');
  assert.match(frasesDaPosicao(nova({ result_quality: 'estimado' }), brl).qualidade, /estimado/i);
  assert.match(frasesDaPosicao(nova({ result_quality: 'conhecido' }), brl).qualidade, /aplicado informado|calculado/i);
});

test('F13: percentual simples só com resultado conhecido e aplicado positivo', () => {
  assert.equal(percentualDoResultado(nova()), 10);
  assert.equal(percentualDoResultado(nova({ result_cents: '-1500' })), -5);
  assert.equal(percentualDoResultado(nova({ result_quality: 'estimado' })), null);
  assert.equal(percentualDoResultado(nova({ principal_cents: '0' })), null);
  assert.equal(percentualDoResultado(nova({ result_cents: null, result_quality: 'indisponível' })), null);
});

const vctx = { contas, posicoes: [nova()], hoje };
const vbase: ValueDraft = { modo: 'valor', posicaoId: 'p', contaId: null, cents: 0, data: hoje, nota: '' };

test('F13: formulário de valor incompleto não está pronto; data futura bloqueia com motivo', () => {
  assert.deepEqual(validarValor(vbase, vctx), { pronto: false, motivo: null });
  assert.equal(validarValor({ ...vbase, cents: 100 }, vctx).pronto, true);
  assert.equal(validarValor({ ...vbase, cents: 100, data: '' }, vctx).pronto, false);
  assert.equal(validarValor({ ...vbase, cents: 100, posicaoId: null }, vctx).pronto, false);
  const futura = validarValor({ ...vbase, cents: 100, data: '2026-10-05' }, vctx);
  assert.equal(futura.pronto, false);
  assert.match(futura.motivo ?? '', /não pode ser futura/);
  assert.equal(validarValor({ ...vbase, cents: 1.5 }, vctx).pronto, false);
});

test('F13: rendimento exige a conta; cai na posição ou em conta comum, nunca cartão ou outra posição', () => {
  const r: ValueDraft = { ...vbase, modo: 'rendimento', cents: 100 };
  assert.equal(validarValor(r, vctx).pronto, false);
  assert.equal(validarValor({ ...r, contaId: 'p' }, vctx).pronto, true);
  assert.equal(validarValor({ ...r, contaId: 'a' }, vctx).pronto, true);
  assert.match(validarValor({ ...r, contaId: 'c' }, vctx).motivo ?? '', /cartão/i);
  assert.match(validarValor({ ...r, contaId: 'q' }, vctx).motivo ?? '', /investimento/);
  assert.equal(validarValor({ ...r, contaId: 'x' }, vctx).pronto, false, 'arquivada não serve');
});

test('F13: comandos exatos de valor, abertura, rendimento, editar e apagar', () => {
  assert.deepEqual(entradaDoValor({ ...vbase, cents: 6000, nota: ' corretora ' }),
    { op: 'valuation', position_account_id: 'p', value_cents: '6000', as_of: hoje, note: 'corretora' });
  assert.deepEqual(entradaDoValor({ ...vbase, modo: 'aplicado', cents: 5000 }),
    { op: 'opening', position_account_id: 'p', value_cents: '5000', as_of: hoje });
  assert.deepEqual(entradaDoValor({ ...vbase, modo: 'rendimento', contaId: 'a', cents: 300 }),
    { op: 'income', position_account_id: 'p', to_account_id: 'a', amount_cents: '300', occurred_on: hoje, note: null });
  assert.deepEqual(entradaDoValor({ ...vbase, cents: 7000 }, { id: 'v', revision: 2 }),
    { op: 'edit', valuation_id: 'v', value_cents: '7000', as_of: hoje, expected_revision: 2 });
});

test('F13: natureza das linhas novas do histórico e mensagens P0001', () => {
  const lin = (extra: Record<string, unknown>) => decodeInvestmentMovements({ position_account_id: 'p', has_more: false, next_before: null, movements: [
    { id: 'x', kind: 'valuation', nature: 'valuation', amount_cents: '6000', occurred_on: hoje, status: null, transfer_id: null, created_transfer: false, revision: 1, created_at: '2026-10-04T10:00:00Z', ...extra }] }).movements[0];
  const v = lin({});
  assert.equal(v.deleted, false, 'atualização de valor não tem transferência e não é "lançamento apagado"');
  assert.equal(v.amount_cents, 6000);
  assert.match(naturezaDoMovimento(v), /Valor informado/);
  assert.match(naturezaDoMovimento(lin({ kind: 'opening', nature: 'opening' })), /Aplicado informado/);
  const r = lin({ kind: 'income', nature: 'income', transfer_id: 't', counterparty_account_id: null, created_transfer: true });
  assert.match(naturezaDoMovimento(r), /Rendimento recebido na posição/);
  assert.match(naturezaDoMovimento(lin({ kind: 'income', nature: 'income', transfer_id: 't', counterparty_account_id: 'a', counterparty_name: 'Nubank', created_transfer: true })), /Rendimento recebido em Nubank/);
  assert.equal(lin({ kind: 'income', nature: 'income', transfer_id: null, created_transfer: true }).deleted, true);
  assert.equal(mensagemDoInvestimento({ code: 'P0001', message: 'Já existe uma atualização em 01/10: edite a de 01/10.' }, 'x'), 'Já existe uma atualização em 01/10: edite a de 01/10.');
});
