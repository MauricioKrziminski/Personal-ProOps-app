import assert from 'node:assert/strict';
import { test } from 'node:test';
import { abreComDuasDatas, dataUnicaEVencimento, oferecerOutraData, rotuloOutraData } from './uma-data.ts';

const base = { serie: false, naCompra: false, podeAdiar: true, pending: true, outraData: false };

test('Ainda vai sair: um campo só, até a pessoa pedir a outra data', () => {
  assert.equal(dataUnicaEVencimento(base), true);
  assert.equal(oferecerOutraData(base), true);
  assert.equal(dataUnicaEVencimento({ ...base, outraData: true }), false, 'par de datas aberto');
  assert.equal(oferecerOutraData({ ...base, outraData: true }), false);
});

test('Já saiu, cartão e parcela de compra mantêm o que já eram', () => {
  assert.equal(dataUnicaEVencimento({ ...base, pending: false }), false);
  assert.equal(dataUnicaEVencimento({ ...base, podeAdiar: false }), false);
  assert.equal(dataUnicaEVencimento({ ...base, naCompra: true }), false);
});

test('Ocorrência de série: uma data, sem o link', () => {
  assert.equal(dataUnicaEVencimento({ ...base, serie: true, outraData: true }), true);
  assert.equal(oferecerOutraData({ ...base, serie: true }), false);
});

test('Editar: datas diferentes abrem os dois campos, iguais abrem um', () => {
  const r = { status: 'pending', occurred_at: '2026-10-01', due_at: '2026-10-15', recurring_id: null, invoice_id: null };
  assert.equal(abreComDuasDatas(r), true);
  assert.equal(abreComDuasDatas({ ...r, due_at: '2026-10-01' }), false);
  assert.equal(abreComDuasDatas({ ...r, due_at: null }), false);
  assert.equal(abreComDuasDatas({ ...r, status: 'cleared' }), false);
  assert.equal(abreComDuasDatas({ ...r, invoice_id: 'f1' }), false, 'no cartão o due_at é da fatura');
});

test('o link fala de compra no gasto e de lançamento na receita', () => {
  assert.equal(rotuloOutraData('expense'), 'Comprou em outra data?');
  assert.equal(rotuloOutraData('income'), 'Lançar em outra data?');
});
