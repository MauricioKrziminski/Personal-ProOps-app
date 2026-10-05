import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ajustarMemoria, celebracao, centavosDaLinha, centavosParaPercentual, diferencaDosMarcos, etapaDaMeta, lerPercentual,
  linhasDosMarcos, percentualParaCentavos, recusaDosMarcos, separarMarcos, sugestaoDeMarcos,
} from './goal-milestones.ts';

const ALVO = 100000;
const MARCOS = [25000, 50000, 75000];

test('etapa derivada: atingidos, próximo e quanto falta', () => {
  const e = etapaDaMeta(30000, ALVO, MARCOS);
  assert.deepEqual(e.atingidos, [25000]);
  assert.equal(e.proximo, 50000);
  assert.equal(e.faltaProximo, 20000);
  assert.equal(e.faltaAlvo, 70000);
  assert.equal(etapaDaMeta(50000, ALVO, MARCOS).maiorAtingido, 50000, 'marco igual ao guardado já foi atingido');
});

test('sem marcos ou com todos passados não há próximo; concluída é o alvo', () => {
  assert.equal(etapaDaMeta(10, ALVO, []).proximo, null);
  const todos = etapaDaMeta(80000, ALVO, MARCOS);
  assert.equal(todos.proximo, null);
  assert.equal(todos.faltaAlvo, 20000);
  assert.equal(etapaDaMeta(ALVO, ALVO, MARCOS).concluida, true);
});

test('retirada que desce abaixo de um marco o devolve a "a seguir"', () => {
  assert.equal(etapaDaMeta(60000, ALVO, MARCOS).proximo, 75000);
  const depois = etapaDaMeta(40000, ALVO, MARCOS);
  assert.equal(depois.maiorAtingido, 25000);
  assert.equal(depois.proximo, 50000);
});

test('alvo reduzido esconde os marcos acima dele; aumentado os devolve', () => {
  const reduzido = separarMarcos(MARCOS, 60000);
  assert.deepEqual(reduzido.visiveis, [25000, 50000]);
  assert.deepEqual(reduzido.acima, [75000]);
  assert.equal(etapaDaMeta(70000, 60000, MARCOS).maiorAtingido, 50000);
  assert.deepEqual(separarMarcos(MARCOS, 200000).visiveis, MARCOS);
  assert.deepEqual(separarMarcos(MARCOS, 75000).acima, [75000], '100% é o alvo, nunca marco');
});

test('percentual em alvo ímpar arredonda ao centavo e volta com uma casa', () => {
  assert.equal(percentualParaCentavos(33.3, 100001), 33300); // 33300,333
  assert.equal(percentualParaCentavos(33.3, 100005), 33302); // 33301,665 sobe
  assert.equal(percentualParaCentavos(25, 100001), 25000); // 25000,25
  assert.equal(centavosParaPercentual(33300, 100001), 33.3);
  assert.equal(centavosParaPercentual(25000, ALVO), 25);
  assert.equal(percentualParaCentavos(50, 0), 0);
});

test('lerPercentual aceita vírgula e recusa o que não é percentual', () => {
  assert.equal(lerPercentual('33,3'), 33.3);
  assert.equal(lerPercentual('25%'), 25);
  for (const ruim of ['', '0', '100', '101', 'abc', '12,34', '-5']) assert.equal(lerPercentual(ruim), null, ruim);
});

test('um aporte que cruza vários marcos celebra UMA vez, o maior', () => {
  const c = celebracao(10000, 80000, ALVO, MARCOS, 0);
  assert.deepEqual(c, { marco: 75000, gravado: 75000 });
});

test('não celebra sem travessia nem o que já foi celebrado', () => {
  assert.equal(celebracao(30000, 40000, ALVO, MARCOS, 0).marco, null, 'sem cruzar marco novo (abrir a tela, aporte pequeno)');
  assert.equal(celebracao(40000, 55000, ALVO, MARCOS, 50000).marco, null, 'já celebrado');
  assert.equal(celebracao(10000, 30000, ALVO, [], 0).marco, null, 'meta sem marcos');
});

test('descer baixa a memória e subir de novo celebra de novo', () => {
  const desceu = celebracao(60000, 40000, ALVO, MARCOS, 50000);
  assert.deepEqual(desceu, { marco: null, gravado: 25000 });
  const subiu = celebracao(40000, 60000, ALVO, MARCOS, desceu.gravado);
  assert.deepEqual(subiu, { marco: 50000, gravado: 50000 });
  assert.equal(ajustarMemoria(75000, 25000), 25000);
  assert.equal(ajustarMemoria(0, 25000), 0, 'a memória nunca sobe sozinha: abrir a tela não celebra');
});

test('linhas do formulário: % vira centavos com o alvo final; a sugestão acompanha o alvo', () => {
  const sugestao = sugestaoDeMarcos();
  assert.deepEqual(sugestao.map((l) => centavosDaLinha(l, ALVO)), [25000, 50000, 75000]);
  assert.deepEqual(sugestao.map((l) => centavosDaLinha(l, 200000)), [50000, 100000, 150000]);
  assert.equal(centavosDaLinha({ key: 'x', cents: 0, pct: 'abc' }, ALVO), 0, 'percentual inválido não vira marco');
  assert.equal(centavosDaLinha({ key: 'x', cents: 777, pct: null }, ALVO), 777);
  assert.deepEqual(linhasDosMarcos([50000, 25000]).map((l) => l.cents), [25000, 50000]);
});

test('recusa marco repetido e marco no alvo; a diferença é só o que mudou', () => {
  assert.match(recusaDosMarcos([25000], [25000, 25000], ALVO) ?? '', /repetido/);
  assert.match(recusaDosMarcos([ALVO], [ALVO], ALVO) ?? '', /abaixo do alvo/);
  assert.equal(recusaDosMarcos([25000], [25000, 90000], ALVO), null);
  assert.deepEqual(diferencaDosMarcos([25000, 50000], [50000, 75000]), { apagar: [25000], inserir: [75000] });
});
