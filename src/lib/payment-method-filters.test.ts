import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAYMENT_METHODS, paymentMethodLabel } from './payment-method.ts';
import {
  PAYMENT_METHOD_FILTER_OPTIONS, normalizePaymentMethodFilters,
  parsePaymentMethodFilters, paymentMethodFilterExpression,
} from './payment-method-filters.ts';

test('opções de filtro incluem métodos canônicos e Não informado como valor próprio', () => {
  assert.deepEqual(PAYMENT_METHOD_FILTER_OPTIONS, [
    ...PAYMENT_METHODS.map(id => ({ id, label: paymentMethodLabel(id) })),
    { id: 'not_informed', label: 'Não informado' },
  ]);
});

test('normalização deduplica e ordena sem modificar a seleção original', () => {
  const original = Object.freeze(['not_informed', 'boleto', 'pix', 'pix', 'credit']);
  assert.deepEqual(normalizePaymentMethodFilters(original), ['pix', 'credit', 'boleto', 'not_informed']);
  assert.deepEqual(original, ['not_informed', 'boleto', 'pix', 'pix', 'credit']);
  assert.deepEqual(normalizePaymentMethodFilters(undefined), []);
  assert.deepEqual(normalizePaymentMethodFilters([]), []);
});

test('normalização recusa valores desconhecidos, null e tentativa de condição SQL', () => {
  for (const invalid of ['unknown', 'PIX', '', 'null', null, undefined, {}, 'pix),status.eq.cleared'])
    assert.throws(() => normalizePaymentMethodFilters(['boleto', invalid]), /forma de pagamento válida/i);
});

test('normalização recusa array esparso em vez de abrir o recorte silenciosamente', () => {
  assert.throws(() => normalizePaymentMethodFilters(new Array(1)), /forma de pagamento válida/i);
});

test('links aceitam lista por vírgula e parâmetros repetidos, com espaços e duplicatas', () => {
  assert.deepEqual(parsePaymentMethodFilters('boleto, pix,not_informed,pix'), ['pix', 'boleto', 'not_informed']);
  const repeated = Object.freeze(['boleto,pix', ' credit ', 'pix']);
  assert.deepEqual(parsePaymentMethodFilters([...repeated]), ['pix', 'credit', 'boleto']);
  assert.deepEqual(repeated, ['boleto,pix', ' credit ', 'pix']);
});

test('links vazios significam ausência; valor inválido nunca significa Não informado ou todos', () => {
  for (const empty of [undefined, '', ' ', [], ['', ' ']])
    assert.deepEqual(parsePaymentMethodFilters(empty), []);
  for (const raw of ['unknown', 'PIX', 'null', 'pix,unknown', 'pix,,boleto', ['pix', 'invalid'], 'pix),status.eq.cleared'])
    assert.equal(parsePaymentMethodFilters(raw), null);
  assert.deepEqual(parsePaymentMethodFilters('not_informed'), ['not_informed']);
});

test('link em array esparso é inválido como um todo, mesmo com método conhecido ao lado', () => {
  assert.equal(parsePaymentMethodFilters(new Array(1)), null);
  assert.equal(parsePaymentMethodFilters(['pix', ...new Array(1)]), null);
});

test('expressões fechadas distinguem ausência, null, múltiplos conhecidos e combinação', () => {
  assert.equal(paymentMethodFilterExpression(undefined), undefined);
  assert.equal(paymentMethodFilterExpression([]), undefined);
  assert.equal(paymentMethodFilterExpression(['not_informed']), 'payment_method.is.null');
  assert.equal(paymentMethodFilterExpression(['boleto', 'pix', 'pix']), 'payment_method.in.(pix,boleto)');
  assert.equal(paymentMethodFilterExpression(['not_informed', 'pix', 'credit']),
    'payment_method.in.(pix,credit),payment_method.is.null');
  assert.equal(paymentMethodFilterExpression([...PAYMENT_METHODS, 'not_informed']),
    'payment_method.in.(pix,credit,debit,cash,bank_transfer,boleto),payment_method.is.null');
  assert.throws(() => paymentMethodFilterExpression(['pix),id.not.is.null'] as never), /forma de pagamento válida/i);
});
