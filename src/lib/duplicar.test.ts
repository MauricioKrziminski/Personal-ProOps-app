import assert from 'node:assert/strict';
import test from 'node:test';
import { COLUNAS_COPIADAS, COLUNAS_IGNORADAS, paramsDaCopia } from './duplicar.ts';
import { decodeModelo, encodeModelo } from './favoritos.ts';

test('a lista de colunas copiadas e ignoradas é exatamente a do contrato F22', () => {
  assert.deepEqual([...COLUNAS_COPIADAS], ['kind', 'description', 'merchant', 'amount_cents', 'category', 'subcategory_id',
    'account_id', 'counterparty_account_id', 'payment_method',
    'expense_pattern', 'expense_pattern_source', 'expense_necessity', 'expense_necessity_source']);
  assert.deepEqual([...COLUNAS_IGNORADAS], ['id', 'invoice_id', 'installment_plan_id', 'installment_no', 'recurring_id', 'debt_id',
    'debt_payment_no', 'debt_principal_cents', 'debt_balance_after_cents', 'pays_invoice_id',
    'rollover_of_invoice_id', 'pix_fee_for_transaction_id', 'down_payment_debt_id',
    'down_payment_plan_id', 'status', 'paid_at', 'auto_confirm', 'due_at', 'occurred_at',
    'attachment_path', 'source', 'edit_revision', 'workspace_id', 'user_id', 'created_at']);
  assert.equal(COLUNAS_COPIADAS.filter((c) => (COLUNAS_IGNORADAS as readonly string[]).includes(c)).length, 0);
});

test('a cópia de uma parcela paga no cartão abre à vista, sem nenhum vínculo nos params', () => {
  const origem = Object.fromEntries(COLUNAS_IGNORADAS.map((c) => [c, 'x'])) as any;
  Object.assign(origem, { kind: 'expense', description: 'Fone (3/10)', amount_cents: 5249, account_id: 'cartao', category: 'lazer',
    merchant: 'Loja', payment_method: 'credit', installment_plan_id: 'plano', installment_no: 3, status: 'cleared' });
  const { params, nota } = paramsDaCopia(origem, '05/10/2026', 10);
  assert.equal(params.description, 'Fone');
  assert.equal(params.amount, '5249');
  assert.equal(params.data, '05/10/2026');
  assert.equal(params.conta, 'cartao');
  assert.equal(nota, 'Cópia da parcela 3/10 — vira um lançamento à vista');
  assert.deepEqual(Object.keys(params).sort(), ['amount', 'category', 'classificacao', 'conta', 'data', 'description', 'kind',
    'merchant', 'nota', 'paymentMethod', 'subcategory_id']);
  assert.ok(!JSON.stringify(params).includes('"x"'), 'valor das colunas ignoradas não vaza');
});

test('decodeModelo ignora chave desconhecida, zera valor inválido e o encode só leva o copiável', () => {
  const m = decodeModelo({ kind: 'bogus', amount_cents: -5, payment_method: 'cheque', account_id: 'a1', invoice_id: 'i', foo: 1, description: '  ' });
  assert.equal(m.kind, 'expense');
  assert.equal(m.amount_cents, null);
  assert.equal(m.payment_method, null);
  assert.equal(m.account_id, 'a1');
  assert.equal(m.description, null);
  assert.ok(!('invoice_id' in m) && !('foo' in m));
  assert.equal(decodeModelo(null).kind, 'expense');
  assert.deepEqual(encodeModelo({ kind: 'income', amount_cents: 100, invoice_id: 'i' } as any), { kind: 'income', amount_cents: 100 });
});
