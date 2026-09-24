import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BOTAO, abriuOLado, executaAoSoltar, cardAberto, ladosDoArrasto, larguraDoBotao, limiarAteOFim, passouAteOFim, passouHaPouco, temArrasto, traducaoNoSoltar, ladoDoSoltar } from './arrasto.ts';

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
  // O limiar acompanha a largura do botão (264 com 88dp), mas a folga encolhe para caber no card.
  assert.equal(limiarAteOFim(328, 2, true, 114), 228 + 57, 'o limiar acompanha a largura do botão');
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

test('ao soltar, vale o deslocamento REAL do soltar — o quadro pode não ter visto o fim', () => {
  // Arrasto que acelera no fim: o último quadro mostrou 210dp, o dedo soltou em 280dp.
  const base = { lado: 'direita' as const, largura: 350, botoes: 1, temPonta: true, botao: 114, desligouEm: 0, agora: 1000 };
  assert.equal(executaAoSoltar({ ...base, passou: false, traducao: 280 }), true);
  assert.equal(executaAoSoltar({ ...base, passou: false, traducao: 200 }), false, 'soltou antes do fim: só abre');
  assert.equal(executaAoSoltar({ ...base, passou: true, traducao: 200 }), true, 'o quadro viu o fim');
  assert.equal(executaAoSoltar({ ...base, passou: false, traducao: 150, desligouEm: 950 }), true, 'a mola desligou há pouco');
  assert.equal(executaAoSoltar({ ...base, temPonta: false, passou: true, traducao: 400 }), false, 'sem ação que se desfaz, nunca');
  assert.equal(executaAoSoltar({ ...base, lado: 'esquerda', botoes: 2, passou: false, traducao: 280 }), false, 'lado errado');
});

// Medido no emulador (24/09/2026): num arrasto RÁPIDO, ler o deslocamento do card quando o aviso
// "vai abrir" chega ao JS dava 131 a 355 para o mesmo dedo de 300 — a mola da biblioteca já tinha
// partido com a velocidade do dedo. O deslocamento vem do DEDO no soltar, mais onde o card estava.
test('no soltar, o deslocamento é o do dedo mais a posição em que o card já estava', () => {
  const paineis = { direita: 114, esquerda: 228 };
  assert.equal(traducaoNoSoltar(null, 280, paineis), 280);
  assert.equal(traducaoNoSoltar('direita', 150, paineis), 264);
  assert.equal(traducaoNoSoltar('esquerda', 300, paineis), 72);
  assert.equal(traducaoNoSoltar('esquerda', -100, paineis), -328);
});

// Medido no emulador a 384dp × fonte 1,3 (24/09/2026): Mais + Arquivar de 114dp num card de
// 350dp punham o "até o fim" em 342dp — 98% do card, e arquivar arrastando não acontecia nunca.
test('até o fim cabe no card: a folga encolhe até meio botão para ficar em 85% da largura', () => {
  const limiar = limiarAteOFim(350, 2, true, 114);
  assert.ok(limiar <= 350 * 0.85, `limiar ${limiar} passa de 85% do card`);
  assert.ok(limiar >= 228 + 57, 'e continua meio botão depois do painel aberto');
  // Onde o botão inteiro de folga cabe, ele continua (o caso de 328dp com 88dp).
  assert.equal(limiarAteOFim(328, 2, true, 88), 264);
  assert.equal(limiarAteOFim(416, 1, true, 88), 416 * 0.55);
});

// Com um painel aberto, arrastar para o lado OPOSTO só fecha o card (a biblioteca não abre o outro
// lado). Executar ali seria arquivar com a pessoa vendo só o "Fixar" fechar.
test('soltar do lado oposto ao painel aberto nunca executa; do mesmo lado, continua valendo', () => {
  assert.equal(ladoDoSoltar(null, 300), 'direita');
  assert.equal(ladoDoSoltar(null, -300), 'esquerda');
  assert.equal(ladoDoSoltar('direita', 250), 'direita');
  assert.equal(ladoDoSoltar('direita', -300), null);
  assert.equal(ladoDoSoltar('esquerda', 120), null);
});
