import assert from 'node:assert/strict';
import test from 'node:test';
import { estadoDaPrevista, filterExpectedLines, mesclarPrevistas, previstasNaTela, type ExpectedLedgerLine } from './ledger-expected.ts';

const recurrence: ExpectedLedgerLine = {
  origin: 'recurring', ref_id: 'series', due_date: '2026-11-01',
  amount_cents: 5590, kind: 'expense', description: 'Assinatura de streaming',
  category: 'lazer', account_id: null, installment_no: null, installments_total: null,
  inferred_start: false, status: 'pending',
};
const debt: ExpectedLedgerLine = {
  ...recurrence, origin: 'debt_schedule', ref_id: 'car', due_date: '2026-11-30',
  description: 'Carro', category: 'transporte', account_id: 'checking',
  installment_no: 9, installments_total: 48,
};

test('previsões respeitam filtros da lista, sem se passarem por lançamentos concluídos', () => {
  assert.deepEqual(filterExpectedLines([recurrence, debt], { status: 'cleared' }), []);
  const paga = { ...recurrence, ref_id: 'paga', status: 'cleared' as const };
  assert.deepEqual(filterExpectedLines([recurrence, paga], { status: 'cleared' }), [paga], 'entra como pago: já aconteceu');
  assert.deepEqual(filterExpectedLines([recurrence, paga], { status: 'pending' }), [recurrence]);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { source: 'recurring' }), [recurrence]);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { source: 'app' }), []);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { accountId: null }), [recurrence]);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { accountId: 'checking' }), [debt]);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { category: 'lazer', q: 'STREAM' }), [recurrence]);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { q: 'car' }), [debt]);
});

test('Ver ocorrências limita previsões à série selecionada', () => {
  assert.deepEqual(filterExpectedLines([recurrence, debt], { recurringId: 'series' }), [recurrence]);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { recurringId: 'other' }), []);
});

test('previsões de origens diferentes aparecem em ordem de vencimento', () => {
  assert.deepEqual(filterExpectedLines([debt, recurrence], {}), [recurrence, debt]);
  assert.deepEqual(filterExpectedLines([recurrence, debt], {}), [recurrence, debt]);
});

test('previstas entram no dia delas, entre os lançamentos, sem passar da página carregada', () => {
  const tx = (id: string, occurred_at: string) => ({ id, occurred_at });
  const rows = [tx('a', '2026-12-20'), tx('b', '2026-11-30'), tx('c', '2026-11-15')];
  const late = { ...recurrence, due_date: '2026-12-01' };
  const early = { ...recurrence, ref_id: 'early', due_date: '2026-11-02' };
  const ids = (itens: ReturnType<typeof mesclarPrevistas>) =>
    itens.map((i) => i.tx ? (i.tx as { id: string }).id : `p:${i.prevista!.due_date}`);
  // no dia dela a prevista vem ANTES das gravadas: é o lugar que o toque lhe dá (o lançamento
  // criado agora é o mais recente do dia) — tocar não pode mover a linha (28/09/2026)
  assert.deepEqual(ids(mesclarPrevistas(rows, [early, debt, late], false)),
    ['a', 'p:2026-12-01', 'p:2026-11-30', 'b', 'c', 'p:2026-11-02']);
  // com mais páginas, a de 02/11 (antes da última linha carregada) espera a próxima página
  assert.deepEqual(ids(mesclarPrevistas(rows, [early, debt, late], true)),
    ['a', 'p:2026-12-01', 'p:2026-11-30', 'b', 'c']);
  // a do dia da última linha carregada já tem o lugar certo: o topo daquele dia
  assert.deepEqual(ids(mesclarPrevistas(rows, [{ ...early, due_date: '2026-11-15' }], true)),
    ['a', 'b', 'p:2026-11-15', 'c']);
  assert.deepEqual(ids(mesclarPrevistas([], [late], false)), ['p:2026-12-01']);
});

test('pílula da prevista segue a data, e a estimada nunca se passa por conta a pagar', () => {
  assert.equal(estadoDaPrevista(recurrence, '2026-10-01'), 'previsto');
  assert.equal(estadoDaPrevista(recurrence, '2026-11-02'), 'atrasado');
  assert.equal(estadoDaPrevista({ ...recurrence, kind: 'income' }, '2026-11-02'), 'não caiu');
  assert.equal(estadoDaPrevista({ ...recurrence, inferred_start: true }, '2026-11-02'), 'estimado');
  assert.equal(estadoDaPrevista({ ...debt, origin: 'debt_estimate', status: 'cleared' }, '2026-12-02'), null);
  assert.equal(estadoDaPrevista({ ...recurrence, status: 'cleared' }, '2026-11-02'), null, 'nasce paga: nada de atrasado');
});

test('tocar na prevista não abre buraco na lista nem a mostra duas vezes', () => {
  const gravada = { occurred_at: '2026-11-01', recurring_id: 'series' };
  // a leitura das previstas voltou primeiro (sem ela), a lista ainda não tem a linha: fica a tocada
  assert.deepEqual(previstasNaTela([], [recurrence], []), [recurrence]);
  // a lista trouxe a linha, a leitura ainda é a velha: nada de duplicata
  assert.deepEqual(previstasNaTela([recurrence], [recurrence], [gravada]), []);
  assert.deepEqual(previstasNaTela([recurrence, debt], [], [gravada]), [debt]);
  // sem toque em andamento, a leitura manda
  assert.deepEqual(previstasNaTela([recurrence], [], []), [recurrence]);
});

test('previsões respeitam valor mínimo/máximo inclusivos e combinados com conta', () => {
  assert.deepEqual(filterExpectedLines([recurrence, debt], { minCents: 5590, maxCents: 5590 }), [recurrence, debt]);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { minCents: 5591 }), []);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { maxCents: 5589 }), []);
  assert.deepEqual(filterExpectedLines([recurrence, debt], { minCents: 0, maxCents: 5590, accountId: null }), [recurrence]);
});
