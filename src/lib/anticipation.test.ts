import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dicaDasParcelas,
  adiantaveisNoMes,
  agruparHipoteses,
  quantasQueCabem,
  substituirGrupo,
  draftsDoAdiantamento,
  escolherParcelas,
  faltamDepois,
  parcelasJaAdiantadas,
  semAsJaAdiantadas,
  semCancelamentoRepetido,
  ultimoDia,
  valorSugerido,
  parcelasDoGrupo,
  pedidoDasParcelas,
  tituloDoAdiantamento,
  oQueOAdiantamentoCobriu,
  apoioDoAdiantamento,
  diaDoAplicar,
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

test('cada mês à frente tira UMA parcela, e ir e voltar dá sempre o mesmo número', () => {
  // a tv do print: 9 parcelas a vencer, a primeira em 10/10
  const tv: Adiantavel = {
    source: 'plan', ref_id: 'tv', title: 'tv', account_name: 'Nubank Cartão', total_n: 10, taxa: null,
    events: Array.from({ length: 9 }, (_, k) => {
      const mes = 10 + k;
      const ano = mes > 12 ? 2027 : 2026;
      const day = `${ano}-${String(((mes - 1) % 12) + 1).padStart(2, '0')}-10`;
      return { n: k + 2, day, cents: 30000, pv_cents: 30000 };
    }),
  };
  const n = (pagarEm: string) => adiantaveisNoMes([tv], pagarEm)[0]?.events.length ?? 0;
  assert.equal(n('2026-09-22'), 9, 'setembro (hoje): as 9');
  assert.equal(n('2026-10-01'), 8, 'outubro: a de 10/10 sai no próprio mês');
  assert.equal(n('2026-11-01'), 7);
  assert.equal(n('2026-10-01'), 8, 'voltar devolve o mesmo');
  assert.equal(n('2027-06-01'), 0, 'no mês da última, nada a adiantar');
  assert.equal(adiantaveisNoMes([tv], '2027-06-01').length, 0, 'item sem nada depois some');
  // e a quantidade pedida assenta junto, guardando a escolha
  assert.equal(quantasQueCabem(adiantaveisNoMes([tv], '2026-10-01')[0], 9), 8);
  assert.equal(quantasQueCabem(adiantaveisNoMes([tv], '2026-09-22')[0], 9), 9);
});

// 07/10/2026: "se eu já adiantei 3 parcelas no mês anterior e for adiantar mais no mês seguinte, no
// mesmo rascunho, ele tem que mostrar o que sobrou". A lista do banco não conhece o rascunho.
const tv: Adiantavel = {
  source: 'plan', ref_id: 'p', title: 'TV', account_name: null, total_n: 12, taxa: null,
  events: ['2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10', '2027-03-10', '2027-04-10']
    .map((day, i) => ({ n: 7 + i, day, cents: 100, pv_cents: 100 })),
};

test('o segundo adiantamento da mesma compra não reoferece as parcelas do primeiro', () => {
  const g1 = draftsDoAdiantamento(tv, tv.events.slice(-3), 300, '2026-11-01', 'g1', { quantas: 3, quais: 'ultimas' });
  const resto = semAsJaAdiantadas([tv], parcelasJaAdiantadas(g1));
  assert.deepEqual(resto[0].events.map((e) => e.n), [7, 8, 9]);
  // editando o próprio g1, as parcelas dele voltam a ser escolhíveis
  assert.equal(semAsJaAdiantadas([tv], parcelasJaAdiantadas(g1, 'g1'))[0].events.length, 6);
  // outra fonte com o mesmo dia não é afetada
  const outra = { ...tv, ref_id: 'outra' };
  assert.equal(semAsJaAdiantadas([outra], parcelasJaAdiantadas(g1))[0].events.length, 6);
});

test('fonte que ficou sem parcela nenhuma some da lista', () => {
  const tudo = draftsDoAdiantamento(tv, tv.events, 600, '2026-11-01', 'g1');
  assert.deepEqual(semAsJaAdiantadas([tv], parcelasJaAdiantadas(tudo)), []);
});

test('rascunho antigo com a mesma parcela cancelada em dois grupos é deduplicado no envio', () => {
  const g1 = draftsDoAdiantamento(tv, tv.events.slice(-3), 300, '2026-11-01', 'g1');
  const g2 = draftsDoAdiantamento(tv, tv.events.slice(-3), 300, '2026-12-01', 'g2');
  const limpo = semCancelamentoRepetido([...g1, ...g2]);
  assert.equal(limpo.filter((d) => d.mode === 'cancel').length, 3);
  assert.equal(limpo.filter((d) => d.mode === 'total').length, 2, 'os dois pagamentos ficam');
  // idempotente: limpar de novo não muda nada
  assert.deepEqual(semCancelamentoRepetido(limpo), limpo);
  // sem repetição, devolve igual
  assert.deepEqual(semCancelamentoRepetido(g1), g1);
});

test('faltam depois de cada adiantamento, na ordem dos pagamentos', () => {
  const g1 = draftsDoAdiantamento(tv, tv.events.slice(-3), 300, '2026-11-01', 'g1');
  const g2 = draftsDoAdiantamento(tv, tv.events.slice(1, 3), 200, '2026-12-01', 'g2');
  // a ordem no rascunho não importa: quem conta é a data do pagamento
  const f = faltamDepois([...g2, ...g1], [tv]);
  assert.equal(f.get('g1'), 3, 'depois de novembro: 7, 8 e 9 (10, 11 e 12 adiantadas)');
  assert.equal(f.get('g2'), 0, 'depois de dezembro: 8 e 9 adiantadas; a 7 vence em novembro');
  // fonte sem candidatos conhecidos (lista ainda carregando): sem número
  assert.equal(faltamDepois(g1, []).get('g1'), undefined);
  // conta fixa não tem fim: sem número
  const aluguel: Adiantavel = { ...tv, source: 'recurring', ref_id: 'r', total_n: null };
  const g3 = draftsDoAdiantamento(aluguel, aluguel.events.slice(0, 2), 200, '2026-11-01', 'g3');
  assert.equal(faltamDepois(g3, [aluguel]).get('g3'), undefined);
});

test('adiantar: a dica diz quantas faltam e quantas ficam depois de adiantar', () => {
  assert.equal(dicaDasParcelas(44, 12, 0), 'Faltam 44 parcelas. Adiantando 12, ficam 32 parcelas.');
  assert.equal(dicaDasParcelas(8, 7, 3), 'Faltam 8 parcelas (3 já adiantadas no rascunho). Adiantando 7, fica 1 parcela.');
  assert.equal(dicaDasParcelas(2, 2, 0), 'Faltam 2 parcelas. Adiantando 2, não fica nenhuma.');
});

test('aplicar: as parcelas do grupo saem da lista do banco pelo dia, e somem se mudaram', () => {
  const item: Adiantavel = {
    source: 'plan', ref_id: 'p', title: 'Fone', account_name: 'Conta', total_n: 6, taxa: null,
    events: [
      { n: 4, day: '2026-12-10', cents: 100, pv_cents: 100, id: 'a', on: '2026-11-20' },
      { n: 5, day: '2027-01-10', cents: 100, pv_cents: 100, id: 'b', on: '2026-12-20' },
      { n: 6, day: '2027-01-10', cents: 100, pv_cents: 100, id: 'c', on: '2027-01-02' },
    ],
  };
  assert.deepEqual(parcelasDoGrupo(item, ['2027-01-10', '2027-01-10'])?.map((p) => p.id), ['b', 'c']);
  assert.equal(parcelasDoGrupo(item, ['2027-02-10']), null);
  assert.equal(parcelasDoGrupo(item, ['2027-01-10', '2027-01-10', '2027-01-10']), null);
});

test('aplicar: o pedido leva a linha, o número da dívida ou a data da prevista', () => {
  const p = (x: Partial<{ n: number | null; id: string | null; on: string }>) =>
    ({ n: null, day: '2026-12-01', cents: 1, pv_cents: 1, ...x });
  assert.deepEqual(pedidoDasParcelas('plan', [p({ id: 'a', n: 2 })]), [{ id: 'a' }]);
  assert.deepEqual(pedidoDasParcelas('debt', [p({ n: 9 })]), [{ n: 9 }]);
  assert.deepEqual(pedidoDasParcelas('recurring', [p({ on: '2027-03-15' })]), [{ on: '2027-03-15' }]);
});

test('aplicar: título, o que cobriu e o desconto', () => {
  assert.equal(tituloDoAdiantamento('plan', 3, 'Fone'), 'Adiantamento de 3 parcelas de Fone');
  assert.equal(tituloDoAdiantamento('recurring', 1, 'Academia'), 'Adiantamento de 1 mês de Academia');
  assert.equal(oQueOAdiantamentoCobriu({ source: 'plan', ref_id: 'p', parcelas: [{ n: 12 }, { n: 10 }, { n: 11 }] }), 'parcelas 10 a 12');
  assert.equal(oQueOAdiantamentoCobriu({ source: 'debt', ref_id: 'd', parcelas: [{ n: 4 }] }), 'parcela 4');
  assert.equal(oQueOAdiantamentoCobriu({ source: 'recurring', ref_id: 'r', parcelas: [{}, {}] }), '2 meses');
  const brl = (c: number) => `R$ ${(c / 100).toFixed(2)}`;
  const a = { source: 'plan' as const, ref_id: 'p', parcelas: [{ n: 5 }, { n: 6 }] };
  assert.equal(apoioDoAdiantamento(a, 4500, 5000, brl), 'adiantamento · parcelas 5 a 6 · desconto de R$ 5.00');
  assert.equal(apoioDoAdiantamento(a, 5000, 5000, brl), 'adiantamento · parcelas 5 a 6');
  assert.equal(apoioDoAdiantamento(a, 5100, 5000, brl), 'adiantamento · parcelas 5 a 6 · R$ 1.00 a mais');
  assert.equal(diaDoAplicar('2026-09-01', '2026-10-08'), '2026-10-08');
  assert.equal(diaDoAplicar('2026-12-01', '2026-10-08'), '2026-12-01');
});
