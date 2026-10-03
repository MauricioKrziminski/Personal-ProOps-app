import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escritaDoLancamento, escritaDaParcelada, escritaDaRecorrente, escritaDoFinanciamento } from './finance-write-input.ts';

const linha = { kind: 'expense' as const, amount_cents: 10333, category: 'casa', description: 'Compra',
  account_id: 'cartao', counterparty_account_id: null, occurred_at: '2026-10-02' };

// Catches leaking request metadata to SQL and losing the optional-field PATCH semantics.
test('lançamento conserva ausência de método, baixa, taxa e vencimento', () => {
  assert.deepEqual(escritaDoLancamento(linha), { operation: 'transaction', args: {
    p_transaction_id: null, p_input: linha, p_fee_cents: null, p_expected_revision: null,
  } });
});

test('editar requer revisão; juros existentes prevalecem sobre a taxa, inclusive zero', () => {
  assert.throws(() => escritaDoLancamento({ ...linha, id: 'tx' }), /conferir a versão/);
  assert.deepEqual(escritaDoLancamento({ ...linha, id: 'tx', expectedRevision: 7,
    fee_cents: 450, juros: { id: 'fee', cents: 0 }, payment_method: null, auto_confirm: true,
  }), { operation: 'transaction', args: { p_transaction_id: 'tx', p_expected_revision: 7,
    p_fee_cents: 0, p_input: { ...linha, payment_method: null, auto_confirm: true },
  } });
  assert.equal(escritaDoLancamento({ ...linha, fee_cents: 0 }).args.p_fee_cents, 0);
  assert.equal(escritaDoLancamento({ ...linha, juros: { id: null, cents: 75 } }).args.p_fee_cents, 75);
});

test('forma de pagamento inválida é recusada antes de qualquer RPC', () => {
  assert.throws(() => escritaDoLancamento({ ...linha, payment_method: 'bitcoin' as never }), /forma de pagamento válida/);
});

test('parcelada transporta centavos, histórico, último dia e entrada como compra atômica', () => {
  assert.deepEqual(escritaDaParcelada({ accountId: 'conta', totalCents: 10001, installments: 3,
    paidInstallments: 1, occurredAt: '2026-09-30', description: 'Móvel', category: null, merchant: 'Loja',
    lastDay: true, paymentMethod: 'boleto', downPayment: { amount_cents: 5000, occurred_at: '2026-09-29', account_id: 'entrada', payment_method: 'pix' },
  }), { operation: 'purchase', args: { p_tipo: 'parcelada', p_dados: {
    p_account_id: 'conta', p_total_cents: 10001, p_installments: 3, p_paid_installments: 1,
    p_occurred_at: '2026-09-30', p_description: 'Móvel', p_category: undefined,
    p_merchant: 'Loja', p_payment_method: 'boleto', ultimo_dia: true,
    down_payment: { amount_cents: 5000, occurred_at: '2026-09-29', account_id: 'entrada', payment_method: 'pix' },
  } } });
});

test('recorrente leva a âncora idêntica ao início, preservando o calendário e automático', () => {
  assert.deepEqual(escritaDaRecorrente({ kind: 'income', amount_cents: 264200, category: 'salario',
    description: 'Salário', merchant: null, account_id: 'conta', rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
    next_run_at: '2026-10-31T15:00:00.000Z', end_date: null, auto_confirm: true,
  }), { operation: 'recurring', args: { p_input: { kind: 'income', amount_cents: 264200,
    category: 'salario', description: 'Salário', merchant: null, account_id: 'conta',
    rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1', next_run_at: '2026-10-31T15:00:00.000Z',
    dtstart: '2026-10-31T15:00:00.000Z', end_date: null, auto_confirm: true,
  } } });
});

test('financiamento não leva id nem versão e mantém a entrada e a âncora do contrato', () => {
  const debt = { id: 'ignored', versao: 'ignored', name: 'Carro', kind: 'financing' as const,
    principal_cents: 30000, remaining_cents: 20000, interest_rate_monthly: 0,
    calculation_mode: 'fixed_installments' as const, installments: 3, installments_paid: 1,
    installment_cents: 10000, account_id: 'conta', due_day: -1, first_due_date: '2026-09-30',
    down_payment: { amount_cents: 5000, occurred_at: '2026-09-01', account_id: 'entrada' },
  };
  assert.deepEqual(escritaDoFinanciamento(debt), { operation: 'purchase', args: { p_tipo: 'financiamento', p_dados: {
    name: 'Carro', kind: 'financing', principal_cents: 30000, remaining_cents: 20000,
    interest_rate_monthly: 0, calculation_mode: 'fixed_installments', installments: 3,
    installments_paid: 1, installment_cents: 10000, account_id: 'conta', due_day: -1,
    first_due_date: '2026-09-30', down_payment: { amount_cents: 5000, occurred_at: '2026-09-01', account_id: 'entrada' },
  } } });
});
