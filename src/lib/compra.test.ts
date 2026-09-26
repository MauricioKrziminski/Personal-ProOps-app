import assert from 'node:assert/strict';
import test from 'node:test';
import { compraDoRegistro, mudarParcelas, payloadDaCompra, validaCompra, type CompraGravada } from './compra.ts';

// Uma compra de 10x de R$ 100 com as 3 primeiras pagas.
const tv: CompraGravada = {
  id: 'p1', description: 'TV', merchant: null, category: 'casa', account_id: 'conta', total_cents: 100000,
  installments: 10, first_occurred_at: '2026-06-05', installment_cents: 10000, paid: 3, locked: 3,
  locked_cents: 30000, locked_paid: 3, locked_in_invoice: 0, last_locked_no: 3, paid_floor: 0,
};

test('Com parcela paga o número muda, só não fica abaixo da última paga nem vira à vista', () => {
  const f = compraDoRegistro(tv);
  assert.deepEqual(validaCompra(f).faixa, { min: 3, max: 72 });
  assert.deepEqual(validaCompra(compraDoRegistro({ ...tv, paid: 0, locked: 0, locked_cents: 0, locked_paid: 0, last_locked_no: 0 })).faixa, { min: 1, max: 72 });
  assert.deepEqual(validaCompra(compraDoRegistro({ ...tv, last_locked_no: 1, locked: 1 })).faixa.min, 2, 'à vista fica fora');
});

test('Data e conta mudam fora do cartão; com parcela paga na fatura, não', () => {
  assert.equal(validaCompra(compraDoRegistro(tv)).dataLivre, true);
  assert.equal(validaCompra(compraDoRegistro({ ...tv, locked_in_invoice: 1 })).dataLivre, false);
});

test('As já pagas vão do piso (paga com a fatura) ao número de parcelas', () => {
  const f = compraDoRegistro({ ...tv, paid_floor: 2 });
  assert.equal(validaCompra({ ...f, pagas: 1 }).pagasOk, false);
  assert.equal(validaCompra({ ...f, pagas: 2 }).pagasOk, true);
  assert.equal(validaCompra({ ...f, pagas: 11 }).pagasOk, false);
  // encolher o número leva as pagas junto
  assert.equal(mudarParcelas({ ...f, pagas: 8 }, 6).pagas, 6);
});

test('O total cobre o que já foi pago e sobra um centavo por parcela em aberto', () => {
  const f = compraDoRegistro(tv);
  assert.equal(validaCompra({ ...f, totalCents: 30006 }).totalOk, false);
  assert.equal(validaCompra({ ...f, totalCents: 30007 }).totalOk, true);
  // todas pagas: o total é a soma delas
  assert.equal(validaCompra({ ...f, installments: 3, totalCents: 30000 }).totalOk, true);
  assert.equal(validaCompra({ ...f, installments: 3, totalCents: 31000 }).totalOk, false);
});

test('O salvar só manda as pagas quando elas mudaram', () => {
  const f = compraDoRegistro(tv);
  assert.equal(payloadDaCompra(f, '2026-06-05').paidInstallments, null);
  assert.equal(payloadDaCompra({ ...f, pagas: 5 }, '2026-06-05').paidInstallments, 5);
  assert.equal(payloadDaCompra({ ...f, merchant: '  ' }, '2026-06-05').merchant, null);
});

test('Cada parcela digitada segue o número novo; as pagas não mudam de valor', () => {
  const f = { ...compraDoRegistro(tv), unidade: 'parcela' as const, parcelaCents: 5000 };
  // 3 pagas (30.000) + 9 em aberto de 5.000
  assert.equal(mudarParcelas(f, 12).totalCents, 30000 + 9 * 5000);
});
