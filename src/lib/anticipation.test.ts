import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  agruparHipoteses,
  quantasQueCabem,
  substituirGrupo,
  draftsDoAdiantamento,
  escolherParcelas,
  ultimoDia,
  valorSugerido,
  type Adiantavel,
} from './anticipation.ts';

const carro: Adiantavel = {
  source: 'debt', ref_id: 'd1', title: 'Carro', account_name: 'Nubank', total_n: 48, taxa: 0.0199,
  events: [
    { n: 9, day: '2026-10-10', cents: 148500, pv_cents: 145603 },
    { n: 10, day: '2026-11-10', cents: 148500, pv_cents: 142762 },
    { n: 11, day: '2026-12-10', cents: 148500, pv_cents: 139976 },
  ],
};

test('as últimas pegam do fim; as próximas, do começo', () => {
  assert.deepEqual(escolherParcelas(carro, 2, 'ultimas').map((p) => p.n), [10, 11]);
  assert.deepEqual(escolherParcelas(carro, 2, 'proximas').map((p) => p.n), [9, 10]);
});

test('pedir mais do que existe devolve todas; zero não devolve nada', () => {
  assert.equal(escolherParcelas(carro, 99, 'ultimas').length, 3);
  assert.equal(escolherParcelas(carro, 0, 'ultimas').length, 0);
});

test('recorrente não tem fim: "as últimas" vira as próximas', () => {
  const netflix = { ...carro, source: 'recurring' as const, total_n: null };
  assert.deepEqual(escolherParcelas(netflix, 1, 'ultimas').map((p) => p.day), ['2026-10-10']);
});

test('o valor sugerido é a soma dos valores presentes, em centavos inteiros', () => {
  assert.equal(valorSugerido(escolherParcelas(carro, 2, 'ultimas')), 142762 + 139976);
});

test('a hipótese é um pagamento e um cancelamento por parcela, no dia de cada uma', () => {
  const parcelas = escolherParcelas(carro, 2, 'ultimas');
  const drafts = draftsDoAdiantamento(carro, parcelas, 280000, '2026-10-01', 'g1');
  assert.deepEqual(drafts, [
    { kind: 'expense', amount_cents: 280000, start: '2026-10-01', installments: 1, mode: 'total',
      grupo: 'g1', rotulo: 'adianta 2 parcelas de Carro',
      adiantar: { ref_id: 'd1', quantas: 2, quais: 'ultimas' } },
    { kind: 'expense', amount_cents: 148500, start: '2026-11-10', installments: 1, mode: 'cancel', grupo: 'g1' },
    { kind: 'expense', amount_cents: 148500, start: '2026-12-10', installments: 1, mode: 'cancel', grupo: 'g1' },
  ]);
});

test('sem parcela ou sem valor, não há hipótese', () => {
  assert.deepEqual(draftsDoAdiantamento(carro, [], 1000, '2026-10-01', 'g'), []);
  assert.deepEqual(draftsDoAdiantamento(carro, carro.events, 0, '2026-10-01', 'g'), []);
});

test('o horizonte precisa ir até a última parcela tirada', () => {
  assert.equal(ultimoDia(carro.events, '2026-10-01'), '2026-12-10');
  assert.equal(ultimoDia([], '2026-10-01'), '2026-10-01');
});

test('a lista mostra um adiantamento como UMA hipótese, e tirar leva o grupo inteiro', () => {
  const drafts = [
    { amount_cents: 100 },
    ...draftsDoAdiantamento(carro, carro.events.slice(0, 2), 290000, '2026-10-01', 'g1'),
    { amount_cents: 200 },
  ];
  const lista = agruparHipoteses(drafts);
  assert.equal(lista.length, 3);
  assert.equal(lista[1].principal.rotulo, 'adianta 2 parcelas de Carro');
  assert.deepEqual(lista[1].indices, [1, 2, 3]);
  assert.deepEqual(lista[2].indices, [4]);
});

test('editar troca a hipótese no mesmo lugar da lista, e grupo sumido entra no fim', () => {
  const lista = [
    { grupo: 'a', v: 1 }, { grupo: 'b', v: 2 }, { grupo: 'b', v: 3 }, { grupo: 'c', v: 4 },
  ];
  assert.deepEqual(substituirGrupo(lista, 'b', [{ grupo: 'b', v: 9 }]).map((d) => d.v), [1, 9, 4]);
  assert.deepEqual(substituirGrupo(lista, 'a', [{ grupo: 'a', v: 7 }, { grupo: 'a', v: 8 }]).map((d) => d.v), [7, 8, 2, 3, 4]);
  assert.deepEqual(substituirGrupo(lista, 'z', [{ grupo: 'z', v: 5 }]).map((d) => d.v), [1, 2, 3, 4, 5]);
});

test('a escolha do adiantamento viaja no draft do pagamento, para a edição voltar a ela', () => {
  const d = draftsDoAdiantamento(carro, carro.events.slice(0, 1), 1000, '2026-10-01', 'g', { quantas: 1, quais: 'proximas' });
  assert.deepEqual(JSON.parse(JSON.stringify(d[0].adiantar)), { ref_id: 'd1', quantas: 1, quais: 'proximas' });
  assert.equal('adiantar' in d[1], false);
});

test('8 parcelas escolhidas em setembro assentam no que cabe em dezembro, sem erro', () => {
  assert.equal(quantasQueCabem(carro, 3), 3);
  assert.equal(quantasQueCabem(carro, 8), carro.events.length);
  assert.equal(quantasQueCabem({ ...carro, events: carro.events.slice(0, 1) }, 2), 1);
  assert.equal(quantasQueCabem(carro, 0), 1, 'nunca abaixo de 1');
  assert.equal(quantasQueCabem(null, 99), 99, 'sem item, guarda o que foi pedido');
});
