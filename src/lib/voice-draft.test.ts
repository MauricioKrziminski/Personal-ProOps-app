import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hrefDoRascunho, perguntasDoParam, type FinanceDraft } from './voice-draft.ts';

const rascunho: FinanceDraft = {
  tipo: 'uma',
  params: { kind: 'expense', amount: '30000', data: '05/10/2026', parcelas: '3', conta: 'c1' },
  perguntas: ['Parcelas: o valor é o total ou o de cada parcela?'],
  entendido: 'Gasto de R$ 300,00',
};

test('o rascunho abre /finance/lancar no tipo certo, com os params do agente', () => {
  const href = hrefDoRascunho(rascunho);
  assert.equal(href.pathname, '/finance/lancar');
  assert.equal(href.params.tipo, 'uma');
  assert.equal(href.params.amount, '30000');
  assert.equal(href.params.conta, 'c1');
});

test('as perguntas viajam num param só e voltam inteiras', () => {
  const href = hrefDoRascunho({ ...rascunho, perguntas: ['Qual cartão?', ' ', 'Valor?'] });
  assert.deepEqual(perguntasDoParam(href.params.perguntas), ['Qual cartão?', 'Valor?']);
});

test('sem perguntas não há param, e o formulário não mostra nota', () => {
  const href = hrefDoRascunho({ ...rascunho, perguntas: [] });
  assert.ok(!('perguntas' in href.params));
  assert.deepEqual(perguntasDoParam(undefined), []);
});

test('o tipo recorrente leva start e account, como o formulário lê', () => {
  const href = hrefDoRascunho({ tipo: 'recorrente', params: { kind: 'expense', start: '05/10/2026', account: 'c1' }, perguntas: [], entendido: '' });
  assert.equal(href.params.tipo, 'recorrente');
  assert.equal(href.params.start, '05/10/2026');
});
