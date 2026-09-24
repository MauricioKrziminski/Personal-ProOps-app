import type { ItemAction } from './item-actions';

/**
 * Divide as ações de um card nos dois lados do arrasto (spec `2026-09-23-arrastar-card`).
 *
 * Direita = a ação rápida do item; esquerda = tirar da lista. "Mais" aparece quando sobra ação
 * sem lado — ele abre o mesmo menu do toque longo, com a lista inteira. Arrastar até o fim
 * executa só a ação da BORDA do lado, e só quando ela tem `desfaz`: Apagar nunca vai sozinho.
 */
export function ladosDoArrasto(acoes: ItemAction[]) {
  const usavel = (x: ItemAction) => !x.disabled && Boolean(x.onPress);
  const direita = acoes.filter((x) => x.arrasto === 'direita' && usavel(x));
  const esquerda = acoes.filter((x) => x.arrasto === 'esquerda' && usavel(x));
  const mais = acoes.some(
    (x) => !x.arrasto && !x.disabled && (Boolean(x.onPress) || Boolean(x.actions?.length)),
  );
  // A ponta é o botão da BORDA: o primeiro na direita (encostado na borda esquerda da tela), o
  // último na esquerda (o "Mais" entra por dentro, antes dele).
  const ponta = (acao: ItemAction | undefined) => (acao?.desfaz ? acao : null);
  return { direita, esquerda, mais, pontaDireita: ponta(direita[0]), pontaEsquerda: ponta(esquerda.at(-1)) };
}

/** O card tem algo para mostrar ao arrastar? Sem nada, o `Deslizavel` nem monta o gesto. */
export function temArrasto(acoes: ItemAction[]): boolean {
  const lados = ladosDoArrasto(acoes);
  return lados.direita.length > 0 || lados.esquerda.length > 0 || lados.mais;
}

/** Largura de cada botão revelado com a fonte padrão: cabe "Arquivar" sem partir a palavra. */
export const BOTAO = 88;

/**
 * A largura cresce com a fonte do sistema até 1,6×. Com 88 fixos, "Desafixar" partia no meio a
 * partir de ~1,6; o rótulo do arrasto tem uma palavra de até 10 letras (teste de tela), e 141dp
 * ainda a cabem a 2×. Fonte menor que a padrão não encolhe o alvo de toque.
 */
export function larguraDoBotao(fontScale: number): number {
  return Math.round(BOTAO * Math.min(Math.max(fontScale, 1), 1.6));
}

/**
 * Onde "arrastar até o fim" passa a executar: 55% do card, mas nunca antes do painel inteiro
 * mais um botão de folga. Só com 55%, um card de 328dp com Mais + Arquivar (176dp) arquivava a
 * 4dp de só abrir o lado. Lado sem ponta nunca executa.
 */
export function limiarAteOFim(largura: number, botoes: number, temPonta: boolean, botao: number): number {
  'worklet';
  if (!temPonta) return Infinity;
  return Math.max(largura * 0.55, (botoes + 1) * botao);
}

/** O dedo passou do ponto de ABRIR deste lado (meio botão) — é onde o toque de seleção vibra. */
export function abriuOLado(translation: number, lado: 'direita' | 'esquerda', botao: number): boolean {
  'worklet';
  return (lado === 'direita' ? translation : -translation) > botao / 2;
}

/**
 * Ao soltar, a mola já começa a puxar o card de volta ao painel, e o "passou do fim" pode ter
 * desligado um quadro antes de a decisão chegar à thread do JS. Desligado há menos de
 * `janela` ms ainda vale; desligado há mais, foi a pessoa voltando o dedo antes de soltar.
 */
export function passouHaPouco(passou: boolean, desligouEm: number, agora: number, janela = 150): boolean {
  return passou || (desligouEm > 0 && agora - desligouEm < janela);
}

/**
 * O dedo passou do "até o fim" DESTE lado? `translation` positivo = arrastou para a direita.
 *
 * O `ReanimatedSwipeable` desenha os DOIS painéis em todo arrasto e os dois leem o mesmo
 * deslocamento; olhando o valor absoluto, arrastar a nota para a esquerda passava do limiar do
 * Fixar (o lado direito, mais curto) e fixava em vez de arquivar (revisão final, 23/09/2026).
 */
export function passouAteOFim(
  translation: number,
  lado: 'direita' | 'esquerda',
  largura: number,
  botoes: number,
  temPonta: boolean,
  // Sem valor padrão: estas funções rodam como worklet, e um padrão que aponta para `BOTAO` não
  // viaja para a thread de UI ("Property 'BOTAO' doesn't exist", medido no emulador).
  botao: number,
): boolean {
  'worklet';
  const andou = lado === 'direita' ? translation : -translation;
  return largura > 0 && andou > limiarAteOFim(largura, botoes, temPonta, botao);
}

type Fechavel = { close: () => void };
let aberto: Fechavel | null = null;

/**
 * O card aberto AGORA — um por vez, no app inteiro. A tela que perde o foco ou desmonta ESQUECE
 * o seu: guardado, ele fazia o primeiro toque na tela seguinte só "fechar o outro" e sumir.
 */
export const cardAberto = {
  abriu(c: Fechavel) {
    if (aberto && aberto !== c) aberto.close();
    aberto = c;
  },
  fechou(c: Fechavel) {
    if (aberto === c) aberto = null;
  },
  esquecer(c: Fechavel) {
    if (aberto === c) fecharCardAberto();
  },
  /** Toque num card com OUTRO aberto: fecha o aberto e diz que o toque foi gasto nisso. */
  toqueEmOutro(c: Fechavel): boolean {
    if (!aberto || aberto === c) return false;
    fecharCardAberto();
    return true;
  },
};

export function fecharCardAberto() {
  const c = aberto;
  aberto = null;
  c?.close();
}
