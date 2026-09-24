import type { ItemAction } from './item-actions';

/**
 * Divide as ações de um card nos dois lados do arrasto (spec `2026-09-23-arrastar-card`).
 *
 * Direita = a ação rápida do item; esquerda = tirar da lista. "Mais" aparece quando sobra ação
 * sem lado — ele abre o mesmo menu do toque longo, com a lista inteira. Arrastar até o fim
 * executa só a PRIMEIRA ação do lado, e só quando ela tem `desfaz`: Apagar nunca vai sozinho.
 */
export function ladosDoArrasto(acoes: ItemAction[]) {
  const usavel = (x: ItemAction) => !x.disabled && Boolean(x.onPress);
  const direita = acoes.filter((x) => x.arrasto === 'direita' && usavel(x));
  const esquerda = acoes.filter((x) => x.arrasto === 'esquerda' && usavel(x));
  const mais = acoes.some(
    (x) => !x.arrasto && !x.disabled && (Boolean(x.onPress) || Boolean(x.actions?.length)),
  );
  const ponta = (lado: ItemAction[]) => (lado[0]?.desfaz ? lado[0] : null);
  return { direita, esquerda, mais, pontaDireita: ponta(direita), pontaEsquerda: ponta(esquerda) };
}

/** O card tem algo para mostrar ao arrastar? Sem nada, o `Deslizavel` nem monta o gesto. */
export function temArrasto(acoes: ItemAction[]): boolean {
  const lados = ladosDoArrasto(acoes);
  return lados.direita.length > 0 || lados.esquerda.length > 0 || lados.mais;
}

/** Largura de cada botão revelado: cabe "Arquivar" a 1,3× sem partir a palavra. */
export const BOTAO = 88;

/**
 * Onde "arrastar até o fim" passa a executar: 55% do card, mas nunca antes do painel inteiro
 * mais um botão de folga. Só com 55%, um card de 328dp com Mais + Arquivar (176dp) arquivava a
 * 4dp de só abrir o lado. Lado sem ponta nunca executa.
 */
export function limiarAteOFim(largura: number, botoes: number, temPonta: boolean): number {
  'worklet';
  if (!temPonta) return Infinity;
  return Math.max(largura * 0.55, (botoes + 1) * BOTAO);
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
