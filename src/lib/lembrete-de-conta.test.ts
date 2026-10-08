import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hrefDoLembrete, alvoComoParam, alvoDoParam, alvosDoAberto, resumoDosAvisos, rotuloDoAviso } from './lembrete-de-conta.ts';

const tx = (o: Partial<{ recurring_id: string; installment_plan_id: string; invoice_id: string }> = {}) =>
  ({ id: 't1', recurring_id: null, installment_plan_id: null, invoice_id: null, status: 'pending', ...o });

test('o que se abriu decide onde o lembrete fica pendurado', () => {
  assert.deepEqual(alvosDoAberto({ tipo: 'lancamento', tx: tx() }), { so: { transaction_id: 't1' }, todas: null });
  assert.deepEqual(alvosDoAberto({ tipo: 'lancamento', tx: tx({ recurring_id: 'r1' }) }),
    { so: { transaction_id: 't1' }, todas: { recurring_id: 'r1' } });
  assert.deepEqual(alvosDoAberto({ tipo: 'lancamento', tx: tx({ installment_plan_id: 'p1' }) }),
    { so: { transaction_id: 't1' }, todas: { installment_plan_id: 'p1' } });
  // compra à vista no cartão: o lembrete é da compra (o da fatura mora na fatura)
  assert.deepEqual(alvosDoAberto({ tipo: 'lancamento', tx: tx({ invoice_id: 'f1' }) }), { so: { transaction_id: 't1' }, todas: null });
  assert.deepEqual(alvosDoAberto({ tipo: 'divida', debtId: 'd1', parcela: 9 }),
    { so: { debt_id: 'd1', debt_installment_no: 9 }, todas: { debt_id: 'd1' } });
  assert.deepEqual(alvosDoAberto({ tipo: 'divida', debtId: 'd1' }), { so: { debt_id: 'd1' }, todas: null });
  assert.deepEqual(alvosDoAberto({ tipo: 'serie', recurringId: 'r1' }), { so: { recurring_id: 'r1' }, todas: null });
  assert.deepEqual(alvosDoAberto({ tipo: 'fatura', invoiceId: 'f1' }), { so: { invoice_id: 'f1' }, todas: null });
  // ocorrência já paga: só a série/compra, sem perguntar
  assert.deepEqual(alvosDoAberto({ tipo: 'lancamento', tx: { ...tx({ recurring_id: 'r1' }), status: 'cleared' } }),
    { so: { recurring_id: 'r1' }, todas: null });
  assert.deepEqual(alvosDoAberto({ tipo: 'lancamento', tx: { ...tx({ installment_plan_id: 'p1', invoice_id: 'f1' }), status: 'cleared', fatura_status: 'paid' } }),
    { so: { installment_plan_id: 'p1' }, todas: null });
  // no cartão a linha fica `cleared` com a fatura aberta: ainda não está paga
  assert.deepEqual(alvosDoAberto({ tipo: 'lancamento', tx: { ...tx({ installment_plan_id: 'p1', invoice_id: 'f1' }), status: 'cleared', fatura_status: 'closed' } }),
    { so: { transaction_id: 't1' }, todas: { installment_plan_id: 'p1' } });
});

test('o aviso se lê como a pessoa fala', () => {
  assert.equal(rotuloDoAviso({ days_before: 0, at_time: '09:00' }), 'no dia às 9h');
  assert.equal(rotuloDoAviso({ days_before: 1, at_time: '09:00' }), '1 dia antes às 9h');
  assert.equal(rotuloDoAviso({ days_before: 3, at_time: '08:30' }), '3 dias antes às 8h30');
  assert.equal(resumoDosAvisos([{ days_before: 1, at_time: '09:00' }, { days_before: 0, at_time: '08:00' }]),
    '1 dia antes às 9h · no dia às 8h');
});

test('o alvo vai e volta pela rota, e lixo não vira alvo', () => {
  const id = '11111111-1111-1111-1111-111111111111';
  for (const a of [{ transaction_id: id }, { debt_id: id, debt_installment_no: 9 }, { invoice_id: id }] as const) {
    assert.deepEqual(alvoDoParam(alvoComoParam(a)), a);
  }
  assert.equal(alvoDoParam('transaction_id:nao-uuid'), null);
  assert.equal(alvoDoParam('user_id:' + id), null);
});

test('o alvo é canônico: sem sobra, parcela só 1 a 4 dígitos positivos', () => {
  const id = '11111111-1111-1111-1111-111111111111';
  assert.equal(alvoDoParam(`transaction_id:${id}:9`), null);
  assert.equal(alvoDoParam(`debt_id:${id}:9:9`), null);
  for (const n of ['0', '1e2', '-1', '1.5', '12345', ' 9', '']) assert.equal(alvoDoParam(`debt_id:${id}:${n}`), null, n);
  assert.deepEqual(alvoDoParam(`debt_id:${id}:12`), { debt_id: id, debt_installment_no: 12 });
  // a chave sai da lista, não da ordem do objeto
  assert.equal(alvoComoParam({ debt_installment_no: 3, debt_id: id } as never), `debt_id:${id}:3`);
});

test('o link do lembrete leva o alvo e, havendo série, a alternativa', () => {
  assert.deepEqual(hrefDoLembrete({ tipo: 'lancamento', tx: tx({ recurring_id: 'r1' }) }, 'Academia'),
    { pathname: '/reminder-form', params: { conta: 'transaction_id:t1', todas: 'recurring_id:r1', nome: 'Academia' } });
  assert.deepEqual(hrefDoLembrete({ tipo: 'fatura', invoiceId: 'f1' }, 'Fatura Nubank'),
    { pathname: '/reminder-form', params: { conta: 'invoice_id:f1', nome: 'Fatura Nubank' } });
});
