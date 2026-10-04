import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeGoalMoneyState, efeitoDaMovimentacao, entradaDaMovimentacao, mensagemDaMovimentacao,
  naturezaDaMovimentacao, validarMovimentacao, type GoalMoneyDraft,
} from './goal-money.ts';

const raw = {
  goal_id: 'g1', has_more: false, next_before: null,
  accounts: [
    { account_id: 'a', name: 'Nubank', type: 'checking', archived: false, goal_cents: '2000', cash_cents: '10000', allocated_cents: '4000', free_cents: '6000' },
    { account_id: 'b', name: 'Caixinha', type: 'savings', archived: false, goal_cents: '0', cash_cents: '500', allocated_cents: '0', free_cents: '500' },
  ],
  movements: [{ id: 'm1', kind: 'allocate', account_id: 'a', account_name: 'Nubank', other_account_id: null, other_account_name: null,
    amount_cents: '2000', occurred_on: '2026-10-04', transfer_id: null, created_transfer: false, revision: 1, created_at: '2026-10-04T10:00:00Z', note: null, contribution_id: 'c1' }],
};
const state = decodeGoalMoneyState(raw);
const base: GoalMoneyDraft = { direcao: 'guardar', via: 'conta', contaId: null, outraContaId: null, vincularId: null, cents: 0, data: '2026-10-04', nota: '' };
const hoje = '2026-10-04';

test('decodifica centavos de texto para inteiros seguros e recusa fora da faixa', () => {
  assert.equal(state.accounts[0].free_cents, 6000);
  assert.equal(state.movements[0].amount_cents, 2000);
  assert.throws(() => decodeGoalMoneyState({ ...raw, accounts: [{ ...raw.accounts[0], cash_cents: '9007199254740993' }] }));
  assert.throws(() => decodeGoalMoneyState({ ...raw, movements: 'x' }));
});

test('formulário incompleto não está pronto e não explica o que ainda não foi pedido', () => {
  assert.deepEqual(validarMovimentacao(base, state, 5000, hoje), { pronto: false, motivo: null });
  assert.deepEqual(validarMovimentacao({ ...base, contaId: 'a' }, state, 5000, hoje), { pronto: false, motivo: null });
  assert.equal(validarMovimentacao({ ...base, contaId: 'a', cents: 100 }, state, 5000, hoje).pronto, true);
});

test('separar além do livre da conta bloqueia dizendo quanto há', () => {
  const r = validarMovimentacao({ ...base, contaId: 'b', cents: 501 }, state, 5000, hoje);
  assert.equal(r.pronto, false);
  assert.match(r.motivo ?? '', /R\$\s?5,00 livres/);
});

test('transferir: origem igual ao destino bloqueia com motivo; diferente passa', () => {
  const d = { ...base, via: 'transferir' as const, contaId: 'a', outraContaId: 'a', cents: 100 };
  assert.deepEqual(validarMovimentacao(d, state, 5000, hoje), { pronto: false, motivo: 'Origem e destino precisam ser contas diferentes.' });
  assert.equal(validarMovimentacao({ ...d, outraContaId: 'b' }, state, 5000, hoje).pronto, true);
});

test('vincular dispensa valor e contas; só precisa da transferência', () => {
  const d = { ...base, via: 'transferir' as const };
  assert.equal(validarMovimentacao(d, state, 5000, hoje).pronto, false);
  assert.equal(validarMovimentacao({ ...d, vincularId: 't1' }, state, 5000, hoje).pronto, true);
});

test('retirar: não passa do guardado nem do separado na conta; liberar sem conta vale', () => {
  const r = { ...base, direcao: 'retirar' as const };
  assert.match(validarMovimentacao({ ...r, cents: 5001 }, state, 5000, hoje).motivo ?? '', /até R\$\s?50,00/);
  assert.match(validarMovimentacao({ ...r, contaId: 'a', cents: 2001 }, state, 5000, hoje).motivo ?? '', /R\$\s?20,00 separados/);
  assert.equal(validarMovimentacao({ ...r, cents: 100 }, state, 5000, hoje).pronto, true);
  assert.equal(validarMovimentacao({ ...r, contaId: 'a', cents: 2000 }, state, 5000, hoje).pronto, true);
});

test('data futura só vale em transferência', () => {
  const futura = '2026-10-09';
  assert.match(validarMovimentacao({ ...base, contaId: 'a', cents: 1, data: futura }, state, 5000, hoje).motivo ?? '', /futura/);
  assert.equal(validarMovimentacao({ ...base, via: 'transferir', contaId: 'a', outraContaId: 'b', cents: 1, data: futura }, state, 5000, hoje).pronto, true);
  assert.equal(validarMovimentacao({ ...base, contaId: 'a', cents: 1, data: '04/10/2026' }, state, 5000, hoje).pronto, false);
});

test('entrada do comando: cada intenção vira o op certo, com centavos em texto', () => {
  assert.deepEqual(entradaDaMovimentacao('g1', { ...base, contaId: 'a', cents: 150, nota: ' x ' }),
    { op: 'allocate', goal_id: 'g1', account_id: 'a', amount_cents: '150', occurred_on: hoje, note: 'x' });
  assert.deepEqual(entradaDaMovimentacao('g1', { ...base, via: 'transferir', contaId: 'b', outraContaId: 'a', cents: 150 }),
    { op: 'transfer_in', goal_id: 'g1', from_account_id: 'a', account_id: 'b', amount_cents: '150', occurred_on: hoje, note: null });
  assert.deepEqual(entradaDaMovimentacao('g1', { ...base, via: 'transferir', vincularId: 't1' }), { op: 'link_in', goal_id: 'g1', transfer_id: 't1' });
  assert.deepEqual(entradaDaMovimentacao('g1', { ...base, direcao: 'retirar', cents: 9 }),
    { op: 'release', goal_id: 'g1', account_id: null, amount_cents: '9', occurred_on: hoje, note: null });
  assert.deepEqual(entradaDaMovimentacao('g1', { ...base, direcao: 'retirar', via: 'transferir', contaId: 'a', outraContaId: 'b', cents: 9 }),
    { op: 'transfer_out', goal_id: 'g1', account_id: 'a', to_account_id: 'b', amount_cents: '9', occurred_on: hoje, note: null });
});

test('efeito: separar mexe no separado e no livre da conta, não no saldo', () => {
  assert.deepEqual(efeitoDaMovimentacao(state, { ...base, contaId: 'a', cents: 1000 }, hoje), [
    { contaId: 'a', conta: 'Nubank', rotulo: 'Separado para esta meta', antes: 2000, depois: 3000 },
    { contaId: 'a', conta: 'Nubank', rotulo: 'Livre na conta', antes: 6000, depois: 5000 },
  ]);
});

test('efeito: transferir mostra o saldo das duas contas e a separação no destino', () => {
  const linhas = efeitoDaMovimentacao(state, { ...base, via: 'transferir', contaId: 'b', outraContaId: 'a', cents: 1000 }, hoje);
  assert.deepEqual(linhas.map((l) => [l.contaId, l.rotulo, l.antes, l.depois]), [
    ['a', 'Saldo', 10000, 9000], ['b', 'Saldo', 500, 1500], ['b', 'Separado para esta meta', 0, 1000],
  ]);
  // transferência futura: o saldo de hoje não muda
  const futura = efeitoDaMovimentacao(state, { ...base, via: 'transferir', contaId: 'b', outraContaId: 'a', cents: 1000, data: '2026-10-09' }, hoje);
  assert.deepEqual(futura.map((l) => l.rotulo), ['Separado para esta meta']);
});

test('efeito: liberar devolve ao livre', () => {
  assert.deepEqual(efeitoDaMovimentacao(state, { ...base, direcao: 'retirar', contaId: 'a', cents: 500 }, hoje).map((l) => [l.rotulo, l.antes, l.depois]),
    [['Separado para esta meta', 2000, 1500], ['Livre na conta', 6000, 6500]]);
  assert.deepEqual(efeitoDaMovimentacao(state, { ...base, direcao: 'retirar', cents: 500 }, hoje), []);
});

test('natureza no extrato nomeia as contas e aguenta conta removida', () => {
  const m = state.movements[0];
  assert.equal(naturezaDaMovimentacao(m), 'Separado em Nubank');
  assert.equal(naturezaDaMovimentacao({ ...m, kind: 'transfer_in', other_account_name: 'Caixinha' }), 'Transferido de Caixinha para Nubank');
  assert.equal(naturezaDaMovimentacao({ ...m, kind: 'link_in', other_account_name: 'Caixinha' }), 'Transferência vinculada de Caixinha para Nubank');
  assert.equal(naturezaDaMovimentacao({ ...m, kind: 'release' }), 'Liberado de Nubank');
  assert.equal(naturezaDaMovimentacao({ ...m, kind: 'release', account_id: null, account_name: null }), 'Retirado sem origem');
  assert.equal(naturezaDaMovimentacao({ ...m, kind: 'transfer_out', other_account_name: 'Caixinha' }), 'Transferido de Nubank para Caixinha');
  assert.equal(naturezaDaMovimentacao({ ...m, account_name: null }), 'Separado em conta removida');
});

test('mensagem do banco: saldo insuficiente vira frase com o livre; erro de rede cai no fallback', () => {
  assert.match(mensagemDaMovimentacao({ code: 'PT422', message: 'SALDO_INSUFICIENTE: livre 500 centavos' }, 'x'), /R\$\s?5,00 livres/);
  assert.equal(mensagemDaMovimentacao({ code: '23505', message: 'Essa transferência já foi vinculada a uma meta' }, 'x'), 'Essa transferência já foi vinculada a uma meta');
  assert.equal(mensagemDaMovimentacao({ code: 'PT409', message: 'A movimentação mudou. Abra de novo' }, 'x'), 'A movimentação mudou. Abra de novo');
  assert.equal(mensagemDaMovimentacao(new Error('Network request failed'), 'Não deu'), 'Não deu');
});
