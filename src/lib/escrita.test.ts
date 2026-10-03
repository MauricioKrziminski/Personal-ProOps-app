import assert from 'node:assert/strict';
import { test } from 'node:test';

import { argsDaParcelada, linhaDaRecorrente, linhaDoFinanciamento, linhaDeJuros, linhasDoLancamento } from './escrita.ts';

const base = {
  kind: 'expense' as const, amount_cents: 35699, category: 'outros', description: 'Pix', merchant: null,
  account_id: 'cartao', counterparty_account_id: null, occurred_at: '2026-09-23', status: 'cleared' as const,
  due_at: null, auto_confirm: false,
};

test('lançamento: uma linha, com source app; juros do Pix vira a segunda linha no cartão', () => {
  assert.deepEqual(linhasDoLancamento(base), [{ ...base, source: 'app' }]);
  const [compra, juros] = linhasDoLancamento({ ...base, amount_cents: 34000, fee_cents: 1699 });
  assert.equal(compra.amount_cents, 34000);
  assert.deepEqual(
    { kind: juros.kind, amount_cents: juros.amount_cents, category: juros.category, merchant: juros.merchant, counterparty_account_id: juros.counterparty_account_id },
    { kind: 'expense', amount_cents: 1699, category: 'juros', merchant: null, counterparty_account_id: null },
  );
  // receita nunca ganha linha de juros
  assert.equal(linhasDoLancamento({ ...base, kind: 'income', fee_cents: 500 }).length, 1);
  // fee_cents não vai ao banco
  assert.ok(!('fee_cents' in linhasDoLancamento({ ...base, fee_cents: 500 })[0]));
});

test('parcelada: a RPC muda com o último dia; os argumentos são os da RPC', () => {
  const e = { accountId: 'c', totalCents: 300000, installments: 10, paidInstallments: 0, occurredAt: '2026-10-01', description: 'Notebook', category: null, merchant: null };
  assert.deepEqual(argsDaParcelada(e), {
    rpc: 'create_installment_plan_with_history',
    args: { p_account_id: 'c', p_total_cents: 300000, p_installments: 10, p_paid_installments: 0, p_occurred_at: '2026-10-01', p_description: 'Notebook', p_category: undefined, p_merchant: undefined },
  });
  assert.equal(argsDaParcelada({ ...e, lastDay: true }).rpc, 'create_installment_plan_last_day');
});

test('recorrente: a âncora é o próximo vencimento', () => {
  const r = linhaDaRecorrente({ kind: 'expense', amount_cents: 5000, description: 'Academia', merchant: null, category: null, account_id: null, rrule: 'FREQ=WEEKLY;BYDAY=MO', next_run_at: '2026-10-05T12:00:00.000Z', end_date: null, auto_confirm: false });
  assert.equal(r.dtstart, '2026-10-05T12:00:00.000Z');
});

test('financiamento: a linha é a entrada, sem id nem versão', () => {
  const f = linhaDoFinanciamento({ name: 'Carro', kind: 'financing', principal_cents: 1, remaining_cents: 1, interest_rate_monthly: 0, installments: 1, installment_cents: 1, account_id: null, due_day: 10 });
  assert.ok(!('id' in f) && !('versao' in f));
  assert.equal(f.name, 'Carro');
});

test('F09 juros técnicos não herdam detalhe da compra, legado segue omitido', () => {
  const uuid = '33333333-3333-4333-8333-333333333333';
  const owned = linhaDeJuros({ category: 'casa', subcategory_id: uuid }, 20);
  assert.equal(owned.subcategory_id, null);
  assert.equal(Object.hasOwn(linhaDeJuros({ category: 'casa' }, 20), 'subcategory_id'), false);
});
