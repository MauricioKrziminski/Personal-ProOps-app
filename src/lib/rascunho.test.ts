import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RASCUNHO_VAZIO, gravarRascunho, lerRascunho, motivoDaHipotese } from './rascunho.ts';

test('versão 2 volta como foi gravada; vazio grava texto vazio', () => {
  const r = { versao: 2 as const, hipoteses: [{ id: 'h1', kind: 'expense' as const, forma: 'uma' as const, valor_cents: 1, parcelas: 1, repete: 'monthly' as const, conta: null, data: '2026-10-01' }], adiantamentos: [] };
  assert.deepEqual(lerRascunho(gravarRascunho(r)), r);
  assert.equal(gravarRascunho(RASCUNHO_VAZIO), '');
});

test('formato estranho ou corrompido não quebra: vira vazio', () => {
  assert.deepEqual(lerRascunho(''), RASCUNHO_VAZIO);
  assert.deepEqual(lerRascunho('não é json'), RASCUNHO_VAZIO);
  assert.deepEqual(lerRascunho(JSON.stringify({ versao: 99 })), RASCUNHO_VAZIO);
  assert.deepEqual(lerRascunho('{"versao":2,"hipoteses":[null,{"id":1}],"adiantamentos":"x"}'), RASCUNHO_VAZIO);
});

test('item estragado da versão 2 sai; o resto continua', () => {
  const boa = { id: 'h1', kind: 'expense', forma: 'uma', valor_cents: 1, parcelas: 1, repete: 'monthly', conta: null, data: '2026-10-01' };
  const r = lerRascunho(JSON.stringify({ versao: 2, hipoteses: [boa, null, { id: 'x', forma: 'outra' }], adiantamentos: [null, { kind: 'x' }] }));
  assert.deepEqual(r.hipoteses.map((h) => h.id), ['h1']);
  assert.equal(r.adiantamentos.length, 0);
});

test('rascunho da versão 1 vira a versão 2', () => {
  const v1 = JSON.stringify({ versao: 1, detalhadas: [{ id: 'x', tipo: 'lancamento', titulo: 'X', entrada: {} }], rapidas: [
    { kind: 'income', amount_cents: 500, start: '2026-10-01', installments: 1, mode: 'monthly', grupo: 'g1' },
    { kind: 'expense', amount_cents: 900, start: '2026-10-02', installments: 3, mode: 'total', grupo: 'g2' },
    { kind: 'expense', amount_cents: 100, start: '2026-10-03', installments: 1, mode: 'total', grupo: 'g3' },
    { kind: 'expense', amount_cents: 700, start: '2026-11-01', installments: 1, mode: 'total', grupo: 'g4', rotulo: 'adianta a tv' },
    { kind: 'expense', amount_cents: -300, start: '2026-12-10', installments: 1, mode: 'cancel', grupo: 'g4' },
  ] });
  const r = lerRascunho(v1);
  assert.equal(r.versao, 2);
  assert.deepEqual(r.hipoteses.map((h) => [h.id, h.forma, h.kind, h.valor_cents, h.parcelas, h.conta, h.data]), [
    ['g1', 'repete', 'income', 500, 1, null, '2026-10-01'],
    ['g2', 'parcelado', 'expense', 900, 3, null, '2026-10-02'],
    ['g3', 'uma', 'expense', 100, 1, null, '2026-10-03'],
  ]);
  assert.deepEqual(r.adiantamentos.map((d) => d.amount_cents), [700, -300]);
});

test('o motivo: a frase NOSSA passa, o texto cru do Postgres não', () => {
  assert.equal(motivoDaHipotese({ mensagem: 'A conta foi arquivada.', codigo: 'P0001' }), 'A conta foi arquivada.');
  assert.equal(motivoDaHipotese({ mensagem: 'new row violates check constraint', codigo: '23514' }), 'o banco recusou esta hipótese. Abra e confira os campos.');
});
