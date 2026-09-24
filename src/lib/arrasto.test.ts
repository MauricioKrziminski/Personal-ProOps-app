import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BOTAO, abriuOLado, cardAberto, ladosDoArrasto, larguraDoBotao, limiarAteOFim, passouAteOFim, passouHaPouco, temArrasto } from './arrasto.ts';

const a = (label: string, extra: Record<string, unknown> = {}) => ({ label, onPress: () => {}, ...extra });

test('cada ação vai para o lado marcado, na ordem declarada', () => {
  const lados = ladosDoArrasto([a('Editar', { arrasto: 'direita' }), a('Apagar', { arrasto: 'esquerda', destructive: true })]);
  assert.deepEqual(lados.direita.map((x) => x.label), ['Editar']);
  assert.deepEqual(lados.esquerda.map((x) => x.label), ['Apagar']);
  assert.equal(lados.mais, false, 'nada sobrou: sem "Mais"');
});

test('"Mais" aparece quando sobra ação sem lado, e "fora" não conta', () => {
  assert.equal(ladosDoArrasto([a('Fixar', { arrasto: 'direita' }), a('Cor')]).mais, true);
  assert.equal(ladosDoArrasto([a('Editar', { arrasto: 'direita' }), a('Ver detalhe', { arrasto: 'fora' })]).mais, false);
});

test('submenu sem lado conta para o "Mais" (é assim que "Mover para" chega)', () => {
  assert.equal(ladosDoArrasto([a('Fixar', { arrasto: 'direita' }), { label: 'Mover para', actions: [a('Casa')] }]).mais, true);
});

test('ação desligada ou sem onPress não entra no arrasto nem no "Mais"', () => {
  const lados = ladosDoArrasto([a('Paguei', { arrasto: 'direita', disabled: true }), { label: 'Mover para', arrasto: 'esquerda' }]);
  assert.deepEqual(lados.direita, []);
  assert.deepEqual(lados.esquerda, []);
  assert.equal(lados.mais, false);
});

test('até o fim só com desfaz: a ponta é a primeira do lado', () => {
  const lados = ladosDoArrasto([
    a('Fixar', { arrasto: 'direita', desfaz: true }),
    a('Apagar', { arrasto: 'esquerda', destructive: true }),
  ]);
  assert.equal(lados.pontaDireita?.label, 'Fixar');
  assert.equal(lados.pontaEsquerda, null, 'Apagar nunca vai sozinho');
});

test('temArrasto: só quando há algo para mostrar', () => {
  assert.equal(temArrasto([a('Ver', { arrasto: 'fora' })]), false);
  assert.equal(temArrasto([a('Editar', { arrasto: 'direita' })]), true);
  assert.equal(temArrasto([]), false);
});

test('arrastar até o fim só vale depois do painel inteiro, e só onde há ponta', () => {
  // Card de 328dp (Android 360) com Mais + Arquivar: 55% dava 180, a 4dp de só abrir o lado.
  assert.equal(limiarAteOFim(328, 2, true, BOTAO), 264);
  assert.equal(limiarAteOFim(600, 1, true, BOTAO), 330);
  assert.equal(limiarAteOFim(328, 2, false, BOTAO), Infinity);
});

const card = () => {
  const c = { fechou: 0, close: () => { c.fechou++; } };
  return c;
};

test('um aberto por vez: abrir outro fecha o anterior, e o toque em outro só fecha', () => {
  const a = card();
  const b = card();
  cardAberto.abriu(a);
  cardAberto.abriu(b);
  assert.equal(a.fechou, 1);
  assert.equal(cardAberto.toqueEmOutro(a), true, 'toque em outro card com um aberto só fecha');
  assert.equal(b.fechou, 1);
  assert.equal(cardAberto.toqueEmOutro(a), false, 'fechado, o próximo toque passa');
});

test('card que saiu da tela não engole o primeiro toque da próxima', () => {
  const a = card();
  const b = card();
  cardAberto.abriu(a);
  cardAberto.esquecer(a); // perdeu o foco ou desmontou
  assert.equal(a.fechou, 1);
  assert.equal(cardAberto.toqueEmOutro(b), false);
});

test('até o fim olha o LADO: arrastar à esquerda nunca dispara a ação da direita', () => {
  // Nota num card de 352dp: Fixar à direita (1 botão), Mais + Arquivar à esquerda (2 botões).
  // Os dois painéis leem o mesmo deslocamento; sem o lado, −200 "passava" do limiar de Fixar.
  assert.equal(passouAteOFim(-200, 'direita', 352, 1, true, BOTAO), false);
  assert.equal(passouAteOFim(-270, 'direita', 352, 1, true, BOTAO), false);
  assert.equal(passouAteOFim(-270, 'esquerda', 352, 2, true, BOTAO), true);
  assert.equal(passouAteOFim(-200, 'esquerda', 352, 2, true, BOTAO), false, 'só abre o lado');
  assert.equal(passouAteOFim(200, 'direita', 352, 1, true, BOTAO), true);
  assert.equal(passouAteOFim(200, 'esquerda', 352, 2, true, BOTAO), false);
  assert.equal(passouAteOFim(400, 'direita', 352, 1, false, BOTAO), false, 'sem ponta nunca executa');
});

test('a ponta da esquerda é o botão da BORDA (o último), não o primeiro', () => {
  const lados = ladosDoArrasto([
    a('Mover', { arrasto: 'esquerda' }),
    a('Arquivar', { arrasto: 'esquerda', desfaz: true }),
  ]);
  assert.equal(lados.pontaEsquerda?.label, 'Arquivar');
  // A da direita continua sendo a primeira: é ela que fica na borda esquerda da tela.
  assert.equal(ladosDoArrasto([a('Fixar', { arrasto: 'direita', desfaz: true }), a('Cor', { arrasto: 'direita' })]).pontaDireita?.label, 'Fixar');
});

test('o botão cresce com a fonte até 1,6× — acima disso o rótulo de uma palavra ainda cabe', () => {
  assert.equal(larguraDoBotao(1), 88);
  assert.equal(larguraDoBotao(0.85), 88, 'fonte menor não encolhe o alvo de toque');
  assert.equal(larguraDoBotao(1.3), 114);
  assert.equal(larguraDoBotao(2), 141);
  assert.equal(limiarAteOFim(328, 2, true, 114), 342, 'o limiar acompanha a largura do botão');
});

test('o ponto de abrir é meio botão, e de um lado só', () => {
  assert.equal(abriuOLado(50, 'direita', 88), true);
  assert.equal(abriuOLado(40, 'direita', 88), false);
  assert.equal(abriuOLado(-50, 'direita', 88), false);
  assert.equal(abriuOLado(-50, 'esquerda', 88), true);
});

test('"até o fim" que a mola desligou há instantes ainda vale; de propósito, não', () => {
  assert.equal(passouHaPouco(true, 0, 1000), true);
  assert.equal(passouHaPouco(false, 950, 1000), true, 'a mola puxou para dentro no quadro seguinte ao soltar');
  assert.equal(passouHaPouco(false, 700, 1000), false, 'a pessoa voltou o dedo e segurou antes de soltar');
  assert.equal(passouHaPouco(false, 0, 1000), false);
});
