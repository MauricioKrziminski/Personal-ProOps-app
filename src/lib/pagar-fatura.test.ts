import assert from 'node:assert/strict';
import { test } from 'node:test';

import { podeConfirmarPagamento } from './pagar-fatura.ts';

const base = { payerId: 'conta', dataISO: '2026-10-07', valorCents: 1000, falta: 5000 };

test('descontando de uma conta: precisa da conta, da data e de um valor até o que falta', () => {
  assert.equal(podeConfirmarPagamento({ ...base, desconta: true }), true);
  assert.equal(podeConfirmarPagamento({ ...base, desconta: true, valorCents: 5000 }), true);
  assert.equal(podeConfirmarPagamento({ ...base, desconta: true, payerId: null }), false);
  assert.equal(podeConfirmarPagamento({ ...base, desconta: true, dataISO: null }), false);
  assert.equal(podeConfirmarPagamento({ ...base, desconta: true, valorCents: 0 }), false);
  assert.equal(podeConfirmarPagamento({ ...base, desconta: true, valorCents: 5001 }), false);
});

test('só marcando como paga: valor e conta não importam, a data sim', () => {
  assert.equal(podeConfirmarPagamento({ ...base, desconta: false, payerId: null, valorCents: 0 }), true);
  assert.equal(podeConfirmarPagamento({ ...base, desconta: false, valorCents: 999999 }), true);
  assert.equal(podeConfirmarPagamento({ ...base, desconta: false, dataISO: null }), false);
});

test('nada falta: não há o que pagar nos dois modos', () => {
  assert.equal(podeConfirmarPagamento({ ...base, desconta: true, falta: 0 }), false);
  assert.equal(podeConfirmarPagamento({ ...base, desconta: false, falta: 0 }), false);
});
