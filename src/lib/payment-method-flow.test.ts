import assert from 'node:assert/strict';
import test from 'node:test';
import { argsDaParcelada, linhaDaRecorrente, linhaDoFinanciamento, linhasDoLancamento } from './escrita.ts';
import * as escrita from './escrita.ts';
import { downPaymentInput } from './down-payment.ts';
import { comumDepoisDeSalvar, comumParaSerie } from './lancar.ts';
import { SERIE_VAZIA, serieDoRegistro, serieDaOcorrencia, mudancasDaOcorrencia } from './serie.ts';
import { compraDoRegistro, payloadDaCompra, edicaoEscopadaDaCompra, type CompraGravada } from './compra.ts';
import { novaHipotese, registroDaHipotese, paramsDoAplicar } from './hipotese.ts';
import { normalizePaymentMethod, paymentMethodLabel, paymentMethodError, paymentMethodAccounts } from './payment-method.ts';

const purchase = { accountId: 'card', totalCents: 101, installments: 2, paidInstallments: 0, occurredAt: '2026-11-01', description: 'Compra', category: null, merchant: null };
const series = { id: 's', kind: 'expense', amount_cents: 100, description: 'Aluguel', merchant: null, category: null, account_id: 'bank', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', next_run_at: '2026-11-01T12:00:00Z', end_date: null, auto_confirm: true, payment_method: 'boleto' as const };
const occurrence = { ...series, occurred_at: '2026-11-01', due_at: null, invoice_id: null, payment_method: 'pix' as const };
const plan: CompraGravada & {payment_method: 'credit'} = { id: 'p', description: 'Compra', merchant: null, category: null, account_id: 'card', total_cents: 101, installments: 2, first_occurred_at: '2026-11-01', installment_cents: 50, paid: 0, locked: 0, locked_cents: 0, locked_paid: 0, locked_in_invoice: 0, last_locked_no: 0, paid_floor: 0, payment_method: 'credit' };

test('purchase builder distinguishes omitted metadata from an intentional clear', () => {
  assert.equal(argsDaParcelada({ ...purchase, paymentMethod: 'credit' }).args.p_payment_method, 'credit');
  assert.equal(argsDaParcelada({ ...purchase, paymentMethod: null }).args.p_payment_method, null);
  assert.equal(Object.hasOwn(argsDaParcelada(purchase).args, 'p_payment_method'), false);
});
test('down payment preserves its own method instead of the financed method', () => {
  assert.deepEqual(downPaymentInput({ amountCents: 25, accountId: 'bank', dateBR: '01/10/2026', paymentMethod: 'pix' }, '2026-10-02'), { amount_cents: 25, account_id: 'bank', occurred_at: '2026-10-01', payment_method: 'pix' });
  assert.equal(Object.hasOwn(downPaymentInput({ amountCents: 25, accountId: 'bank', dateBR: '01/10/2026' }, '2026-10-02'), 'payment_method'), false);
});
test('method travels between formats and save-and-create-another without changing accounting kind', () => {
  const common = { kind: 'transfer' as const, descricao: 'Pix próprio', valorCents: 100, contaId: 'card', dataBR: '01/11/2026', categoria: null, paymentMethod: 'pix' as const };
  assert.equal(comumParaSerie(common).paymentMethod, 'pix');
  assert.equal(comumDepoisDeSalvar(common).paymentMethod, 'pix');
  assert.equal(linhasDoLancamento({ kind: common.kind, amount_cents: 100, occurred_at: '2026-11-01', account_id: 'card', counterparty_account_id: 'bank', payment_method: 'pix' })[0].kind, 'transfer');
});
test('occurrence hydration and method-only future patch use the occurrence and update the series default independently', () => {
  const form = serieDaOcorrencia(series, occurrence);
  assert.equal(serieDoRegistro(series).paymentMethod, 'boleto');
  assert.equal(form.paymentMethod, 'pix');
  assert.deepEqual(mudancasDaOcorrencia(form, occurrence, series), { linhas: {}, regra: {} }, 'untouched occurrence override must not replace the series default');
  assert.deepEqual(mudancasDaOcorrencia({ ...form, paymentMethod: 'debit' }, occurrence, series), { linhas: { payment_method: 'debit' }, regra: { payment_method: 'debit' } });
  assert.deepEqual(mudancasDaOcorrencia({ ...form, paymentMethod: undefined }, occurrence, series), { linhas: {}, regra: {} });
  assert.deepEqual(mudancasDaOcorrencia({ ...form, paymentMethod: null }, occurrence, series), { linhas: { payment_method: null }, regra: { payment_method: null } });
});
test('purchase method-only edit is scoped and structural save keeps it', () => {
  const form = compraDoRegistro(plan);
  assert.equal(form.paymentMethod, 'credit');
  assert.equal(payloadDaCompra({ ...form, paymentMethod: 'pix' }, '2026-11-01').paymentMethod, 'pix');
  assert.deepEqual(edicaoEscopadaDaCompra({ ...form, paymentMethod: null }, plan, 'future'), { kind: 'scope', lastDay: false, patch: { payment_method: null } });
  assert.deepEqual(edicaoEscopadaDaCompra({ ...form, paymentMethod: undefined }, plan, 'future'), { kind: 'no-op' });
});
test('structural purchase save uses the revision from the hydrated snapshot', () => {
  const form = compraDoRegistro({ ...plan, edit_revision: 7 });
  assert.equal(payloadDaCompra({ ...form, paymentMethod: 'pix' }, '2026-11-01').expectedRevision, 7);
  assert.equal(Object.hasOwn(payloadDaCompra(compraDoRegistro(plan), '2026-11-01'), 'expectedRevision'), false);
});
test('simulation and apply preserve method for each format', () => {
  for (const forma of ['uma', 'parcelado', 'repete', 'financiamento'] as const) {
    const h = { ...novaHipotese('2099-11-01'), forma, conta: 'bank', valor_cents: 101, paymentMethod: 'pix' as const };
    const record = registroDaHipotese(h, 0)!;
    const data = forma === 'uma' ? (record.dados.linhas as Record<string, unknown>[])[0] : record.dados;
    assert.equal(data[forma === 'parcelado' ? 'p_payment_method' : 'payment_method'], 'pix', forma);
    assert.equal(paramsDoAplicar(h).params.paymentMethod, 'pix', forma);
    assert.equal(paramsDoAplicar({ ...h, paymentMethod: null }).params.paymentMethod, '', forma);
  }
});
test('write builders reject an unrecognized method rather than silently losing user intent', () => {
  assert.throws(() => argsDaParcelada({ ...purchase, paymentMethod: 'unknown' as never }), /pagamento/i);
  assert.throws(() => linhaDaRecorrente({ ...SERIE_VAZIA, payment_method: 'unknown' } as never), /pagamento/i);
  assert.throws(() => linhaDoFinanciamento({ payment_method: 'unknown' } as never), /pagamento/i);
});
test('legacy unknown reads stay unknown and cannot be confused with a recognized payment', () => {
  for (const value of [undefined, null, 'unknown', 'toString', {}, 1]) {
    assert.equal(normalizePaymentMethod(value), null);
    assert.equal(paymentMethodLabel(value), 'Não informado');
  }
  assert.equal(normalizePaymentMethod('pix'), 'pix');
  assert.equal(paymentMethodLabel('pix'), 'Pix');
  assert.equal(serieDoRegistro({ ...series, payment_method: 'unknown' as never }).paymentMethod, null);
});
test('compatible funding choices preserve account identity and never mutate the selected origin', () => {
  const bank = { id: 'b', type: 'checking' }, card = { id: 'c', type: 'credit_card' }, cash = { id: 'd', type: 'cash' };
  const accounts = [bank, card, cash];
  assert.deepEqual(paymentMethodAccounts('pix', accounts), [bank, card]);
  assert.deepEqual(paymentMethodAccounts('debit', accounts), [bank]);
  assert.deepEqual(paymentMethodAccounts('cash', accounts), [cash]);
  assert.deepEqual(paymentMethodAccounts('credit', accounts), [card]);
  assert.deepEqual(paymentMethodAccounts(null, accounts), accounts);
  assert.equal(paymentMethodAccounts('pix', accounts)[1], card);
  assert.notEqual(paymentMethodError('credit', null), null);
  assert.notEqual(paymentMethodError('debit', card), null);
  assert.notEqual(paymentMethodError('cash', bank), null);
  assert.equal(paymentMethodError('debit', { type: 'savings' }), null);
  assert.equal(paymentMethodError('debit', { type: 'investment' }), null);
  assert.equal(paymentMethodError('bank_transfer', card), null);
  assert.equal(paymentMethodError('boleto', card), null);
  assert.equal(paymentMethodError('cash', null), null);
  assert.equal(paymentMethodError('pix', null), null);
  assert.deepEqual(accounts, [bank, card, cash]);
});
test('canonical expense and own transfer destination use one primary with explicit fee instead of an unowned second line', () => {
  assert.equal(typeof escrita.dadosDoLancamento, 'function', 'canonical destination builder must exist');
  for (const kind of ['expense', 'transfer'] as const) {
    const input = { kind, amount_cents: 1000, account_id: 'card', counterparty_account_id: kind === 'transfer' ? 'bank' : null, occurred_at: '2026-11-01', payment_method: 'pix' as const, fee_cents: 25 };
    const result = escrita.dadosDoLancamento(input);
    assert.deepEqual(result, { linhas: [{ kind, amount_cents: 1000, account_id: 'card', counterparty_account_id: kind === 'transfer' ? 'bank' : null, occurred_at: '2026-11-01', payment_method: 'pix', source: 'app' }], fee_cents: 25 });
    assert.equal(linhasDoLancamento(input).length, 2, 'legacy API keeps its historical shape');
  }
});
test('canonical destination excludes income fees and preserves omitted metadata', () => {
  assert.equal(typeof escrita.dadosDoLancamento, 'function');
  const income = escrita.dadosDoLancamento({ kind: 'income', amount_cents: 1000, occurred_at: '2026-11-01', fee_cents: 25 });
  assert.equal(income.linhas.length, 1);
  assert.equal(Object.hasOwn(income, 'fee_cents'), false);
  assert.equal(Object.hasOwn(income.linhas[0], 'payment_method'), false);
  const noFee = escrita.dadosDoLancamento({ kind: 'expense', amount_cents: 1000, occurred_at: '2026-11-01', payment_method: null, fee_cents: 0 });
  assert.equal(Object.hasOwn(noFee, 'fee_cents'), false);
  assert.equal(noFee.linhas[0].payment_method, null);
});
test('canonical simulation does not guess a fee from Pix and card metadata', () => {
  const h = { ...novaHipotese('2099-11-01'), conta: 'card', valor_cents: 1000, paymentMethod: 'pix' as const };
  const record = registroDaHipotese(h, 0)!;
  assert.equal((record.dados.linhas as unknown[]).length, 1);
  assert.equal(Object.hasOwn(record.dados, 'fee_cents'), false);
});
