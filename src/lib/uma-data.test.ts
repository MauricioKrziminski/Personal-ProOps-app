import assert from 'node:assert/strict';
import { test } from 'node:test';
import { abreComDuasDatas, abreComDuasDatasGuardado, aoTrocarDeConta, vencimentoAGravar, dataUnicaEVencimento, oferecerOutraData, rotuloOutraData } from './uma-data.ts';

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

test('Estado restaurado com duas datas diferentes reabre o par (Uma vez > Recorrente > Uma vez)', () => {
  assert.equal(abreComDuasDatasGuardado({ pending: true, occurred_at: '10/10/2026', due_at: '20/10/2026' }), true);
  assert.equal(abreComDuasDatasGuardado({ pending: true, occurred_at: '10/10/2026', due_at: '10/10/2026' }), false);
  assert.equal(abreComDuasDatasGuardado({ pending: false, occurred_at: '10/10/2026', due_at: '20/10/2026' }), false);
  assert.equal(abreComDuasDatasGuardado(undefined), false);
});

test('Conta > cartão > conta devolve "Ainda vai sair" e o vencimento; em cartão nada é escrito', () => {
  const emCartao = aoTrocarDeConta({ paraCartao: true, pending: true, due_at: '20/10/2026', reservada: null });
  assert.deepEqual(emCartao, { pending: false, due_at: null, reservada: { pending: true, due_at: '20/10/2026' } });
  // cartão > outro cartão: continua guardado
  const outroCartao = aoTrocarDeConta({ paraCartao: true, pending: false, due_at: null, reservada: emCartao.reservada });
  assert.deepEqual(outroCartao.reservada, { pending: true, due_at: '20/10/2026' });
  const volta = aoTrocarDeConta({ paraCartao: false, pending: false, due_at: null, reservada: outroCartao.reservada });
  assert.deepEqual(volta, { pending: true, due_at: '20/10/2026', reservada: null });
  // sem nada guardado, trocar de conta não mexe
  assert.deepEqual(aoTrocarDeConta({ paraCartao: false, pending: false, due_at: null, reservada: null }), { pending: false, due_at: null, reservada: null });
});

test('Pendente antigo sem vencimento: salvar sem mexer não grava due_at = data', () => {
  const ed = { due_at: null, occurred_at: '2026-09-01' };
  assert.equal(vencimentoAGravar(ed, '2026-09-01'), null);
  assert.equal(vencimentoAGravar(ed, '2026-09-15'), '2026-09-15');
  assert.equal(vencimentoAGravar({ due_at: '2026-09-10', occurred_at: '2026-09-01' }, '2026-09-01'), '2026-09-01');
});
