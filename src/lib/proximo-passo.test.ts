/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { proximoPasso, type ProximoId } from './proximo-passo.ts';

const nada = new Set<ProximoId>();
const novo = { cartaoId: 'c1', importou: false, lembretes: 0, parceladas: 0, notas: 0 };

test('a ordem: importar, projeção, lembrete, parcelada, nota', () => {
  const ordem: ProximoId[] = [];
  const dispensados = new Set<ProximoId>();
  for (let p = proximoPasso(novo, dispensados); p; p = proximoPasso(novo, dispensados)) {
    ordem.push(p.id);
    dispensados.add(p.id);
  }
  assert.deepEqual(ordem, ['importar', 'projecao', 'lembrete', 'parcelada', 'nota']);
});

test('importar leva à importação com o cartão já escolhido', () => {
  assert.equal(proximoPasso(novo, nada)?.href, '/import?conta=c1');
});

test('sem cartão não oferece importar a fatura nem compra parcelada', () => {
  const ordem: ProximoId[] = [];
  const dispensados = new Set<ProximoId>();
  const semCartao = { ...novo, cartaoId: null };
  for (let p = proximoPasso(semCartao, dispensados); p; p = proximoPasso(semCartao, dispensados)) {
    ordem.push(p.id);
    dispensados.add(p.id);
  }
  assert.deepEqual(ordem, ['projecao', 'lembrete', 'nota']);
});

test('o que já foi feito não volta, e sem passo aplicável é null', () => {
  const feito = { cartaoId: 'c1', importou: true, lembretes: 2, parceladas: 1, notas: 5 };
  assert.equal(proximoPasso(feito, nada)?.id, 'projecao');
  assert.equal(proximoPasso(feito, new Set<ProximoId>(['projecao'])), null);
});
