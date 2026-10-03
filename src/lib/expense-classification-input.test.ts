import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UNKNOWN_EXPENSE_CLASSIFICATION as unknownClass, expenseClassificationFromRecord, selectExpenseClassification } from './expense-classification.ts';
import { prepararLancamento, type LancamentoFormValues } from './lancamento-write.ts';
import { argsDaParcelada, linhaDaRecorrente, linhaDoFinanciamento, linhasDoLancamento } from './escrita.ts';
import { escritaDoLancamento, escritaDaParcelada, escritaDaRecorrente, escritaDoFinanciamento } from './finance-write-input.ts';
import { comumDepoisDeSalvar, comumParaSerie } from './lancar.ts';

const values: LancamentoFormValues = { kind: 'expense', amount_cents: 10001, category: 'casa',
  description: 'Mesa', merchant: 'Loja', account_id: 'conta', payment_method: 'boleto',
  counterparty_account_id: null, installments: 1, fee_cents: 0, auto_confirm: false,
  paid_installments: '0', down_payment_enabled: false, down_payment_cents: 0,
  down_payment_date: '01/10/2026', down_payment_account: null, down_payment_method: null,
  value_unit: 'total', occurred_at: '03/10/2026', pending: false, installment_occurrence: false, due_at: null };
const context = { podeAdiar: true, podeParcelarAqui: true, intencaoDoDia: null, isCard: false, mostraJuros: false, hoje: '2026-10-03' } as const;
const transaction = { kind: 'expense' as const, amount_cents: 10001, account_id: 'conta', counterparty_account_id: null, category: 'casa', description: 'Mesa', occurred_at: '2026-10-03' };
const purchase = { accountId: 'conta', totalCents: 10001, installments: 3, paidInstallments: 0, occurredAt: '2026-10-03', description: 'Mesa', category: 'casa', merchant: null };
const recurring = { ...transaction, merchant: null, rrule: 'FREQ=MONTHLY;BYMONTHDAY=3', next_run_at: '2026-10-03T12:00:00Z', end_date: null, auto_confirm: false };
const debt = { name: 'Mesa', kind: 'financing' as const, principal_cents: 10001, remaining_cents: 10001, interest_rate_monthly: 0, installments: 3, installment_cents: 3333, account_id: 'conta', due_day: 3 };
const keys = Object.keys(unknownClass);
const read = expenseClassificationFromRecord;

test('quatro combinações do formulário são o mesmo snapshot na prévia e nas escritas canônicas', () => {
  for (const pattern of ['fixed', 'variable'] as const) for (const necessity of ['essential', 'discretionary'] as const) {
    const snapshot = selectExpenseClassification(selectExpenseClassification(unknownClass, 'pattern', pattern), 'necessity', necessity);
    const form = prepararLancamento({ ...values, installments: 3, expenseClassification: snapshot }, context);
    assert.deepEqual(read(form.entradaLancamento), snapshot);
    assert.deepEqual(read(form.entradaParcelada), snapshot);
    assert.deepEqual(read(escritaDoLancamento(form.entradaLancamento).args.p_input), snapshot);
    assert.deepEqual(read(escritaDaParcelada(form.entradaParcelada!).args.p_dados), snapshot);
    assert.deepEqual(read(argsDaParcelada(form.entradaParcelada!).args), snapshot);
    assert.deepEqual(read(linhasDoLancamento(form.entradaLancamento)[0]), snapshot);
    assert.deepEqual(read(escritaDaRecorrente({ ...recurring, ...snapshot }).args.p_input), snapshot);
    assert.deepEqual(read(escritaDoFinanciamento({ ...debt, ...snapshot }).args.p_dados), snapshot);
  }
});

test('dimensão explicitamente limpa é publicada sem acrescentar dimensão omitida', () => {
  const pair = { expense_pattern: null, expense_pattern_source: 'explicit' } as const;
  for (const output of [escritaDoLancamento({ ...transaction, ...pair }).args.p_input,
    escritaDaParcelada({ ...purchase, ...pair }).args.p_dados,
    escritaDaRecorrente({ ...recurring, ...pair }).args.p_input,
    escritaDoFinanciamento({ ...debt, ...pair }).args.p_dados]) {
    assert.equal(typeof output, 'object');
    assert.equal(output?.expense_pattern, null);
    assert.equal(output?.expense_pattern_source, 'explicit');
    assert.equal(Object.hasOwn(output!, 'expense_necessity'), false);
  }
});

test('sem snapshot legado não ganha nenhuma coluna de classificação', () => {
  const form = prepararLancamento(values, context);
  for (const output of [form.entradaLancamento, form.entradaParcelada!, escritaDoLancamento(transaction).args.p_input!,
    escritaDaParcelada(purchase).args.p_dados!, escritaDaRecorrente(recurring).args.p_input!, escritaDoFinanciamento(debt).args.p_dados!]) {
    for (const key of keys) assert.equal(Object.hasOwn(output, key), false);
  }
});

test('receitas e transferências limpam snapshots existentes; a compra mantém classificação de gasto', () => {
  const snapshot = selectExpenseClassification(unknownClass, 'pattern', 'fixed');
  for (const kind of ['income', 'transfer'] as const) {
    const form = prepararLancamento({ ...values, kind, expenseClassification: snapshot }, context);
    assert.deepEqual(read(form.entradaLancamento), unknownClass);
    assert.deepEqual(read(form.entradaParcelada), snapshot);
    assert.deepEqual(read(escritaDoLancamento({ ...transaction, kind, ...snapshot }).args.p_input), unknownClass);
  }
  assert.deepEqual(read(escritaDaRecorrente({ ...recurring, kind: 'income', ...snapshot }).args.p_input), unknownClass);
});

test('taxa do Pix não herda classificação principal e preserva saída legada ausente', () => {
  const snapshot = selectExpenseClassification(unknownClass, 'necessity', 'discretionary');
  const [main, fee] = linhasDoLancamento({ ...transaction, ...snapshot, fee_cents: 50 });
  assert.deepEqual(read(main), snapshot);
  assert.deepEqual(read(fee), unknownClass);
  assert.equal(fee.expense_necessity_source, null);
  const legacyFee = linhasDoLancamento({ ...transaction, fee_cents: 50 })[1];
  for (const key of keys) assert.equal(Object.hasOwn(legacyFee, key), false);
});

test('trocar formato conserva rascunho imutável e criar outro remove snapshot', () => {
  const snapshot = Object.freeze(selectExpenseClassification(unknownClass, 'pattern', null));
  const common = Object.freeze({ kind: 'expense' as const, descricao: 'Mesa', valorCents: 10001, contaId: 'conta', dataBR: '03/10/2026', categoria: 'casa', expenseClassification: snapshot });
  const series = comumParaSerie(common);
  assert.notEqual(series, common);
  assert.deepEqual(series.expenseClassification, snapshot);
  const next = comumDepoisDeSalvar(common);
  assert.equal(Object.hasOwn(next, 'expenseClassification'), false);
  assert.deepEqual(common.expenseClassification, snapshot);
});

test('escritas fechadas rejeitam dimensão pela metade, enums/fontes inválidos e undefined explícito', () => {
  const invalid = [{ expense_pattern: 'fixed' }, { expense_pattern_source: 'explicit' },
    { expense_pattern: undefined, expense_pattern_source: 'explicit' },
    { expense_pattern: 'fixed', expense_pattern_source: 'recurring' },
    { expense_necessity: false, expense_necessity_source: 'explicit' },
    { expense_pattern: null, expense_pattern_source: 'category_default' }];
  for (const patch of invalid) {
    assert.throws(() => escritaDoLancamento({ ...transaction, ...patch } as never), /classifica/i);
    assert.throws(() => escritaDaParcelada({ ...purchase, ...patch } as never), /classifica/i);
    assert.throws(() => escritaDaRecorrente({ ...recurring, ...patch } as never), /classifica/i);
    assert.throws(() => escritaDoFinanciamento({ ...debt, ...patch } as never), /classifica/i);
  }
  assert.throws(() => prepararLancamento({ ...values, expenseClassification: { essential: true } as never }, context), /classifica/i);
});

test('adaptadores de registros não removem uma dimensão presente nem reclassificam outra', () => {
  const pair = { expense_necessity: 'essential', expense_necessity_source: 'category_default' } as const;
  assert.deepEqual(read(linhaDaRecorrente({ ...recurring, ...pair })), { ...unknownClass, ...pair });
  assert.deepEqual(read(linhaDoFinanciamento({ ...debt, ...pair })), { ...unknownClass, ...pair });
});
