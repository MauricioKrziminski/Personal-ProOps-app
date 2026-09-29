/**
 * A geometria do cartão — um desenho só, em qualquer tamanho.
 *
 * A face é desenhada numa largura fixa (`LARGURA_DE_DESENHO`) e ESCALADA para a largura real. É o
 * que deixa o voo sem salto: o clone voando e o cartão onde ele pousa são o mesmo desenho, só em
 * escalas diferentes, e o voo inteiro é translação + giro + escala.
 *
 * A proporção é a de um cartão de verdade (ISO 7810, 85,6 × 53,98 mm) e DIMINUI com a fonte do
 * sistema: o conteúdo é texto, e a 1,3× ele não cabe na altura de fábrica (§1 do design — a face
 * cresce com a fonte). A raiz quadrada amacia o crescimento para o cartão não virar um quadrado.
 * Como origem e destino usam a MESMA conta, o voo continua sendo escala uniforme.
 */

export const PROPORCAO_DO_CARTAO = 1.586;
export const LARGURA_DE_DESENHO = 340;

/** O cartão cabe no painel que o contém, inclusive após Split View ou rotação. */
export function walletStageWidth(windowWidthDp: number, availableWidthDp = windowWidthDp): number {
  if (!Number.isFinite(windowWidthDp)) return 0;
  const available = Number.isFinite(availableWidthDp) ? availableWidthDp : windowWidthDp;
  return Math.min(640, Math.max(0, windowWidthDp), Math.max(0, available));
}

/*
  O que a face precisa de altura, no desenho de 340, MEDIDO no iPhone em 29/09/2026 no pior caso
  (nome em duas linhas + "Atrasada" + fatura, limite e vencimento): 158 a 1× e ~265 a mais por
  unidade de escala (251 a 1,35×, 431 a 2,14×, 821 a 3,57×). A raiz quadrada sozinha cortava a
  base inteira de XXXL para cima — no accessibility-large sobrava "Fat/ura/atu/al".
  ponytail: conta calibrada no pior caso medido, com 10% de folga; nome em três linhas a 3,5×
  pode passar — o próximo passo seria a face medir o próprio conteúdo.
*/
const CONTEUDO_A_1X = 158;
const CONTEUDO_POR_ESCALA = 265;
const FOLGA = 1.1;

/** Largura ÷ altura da face. */
export function proporcaoDoCartao(fontScale: number): number {
  'worklet';
  const escala = Math.max(1, fontScale);
  const alturaDeFabrica = LARGURA_DE_DESENHO / PROPORCAO_DO_CARTAO;
  const conteudo = (CONTEUDO_A_1X + CONTEUDO_POR_ESCALA * (escala - 1)) * FOLGA;
  // A raiz amacia no tamanho normal (a face não vira quadrado à toa); o conteúdo manda quando
  // passa dela — o texto é identificador e não pode ser cortado (§7).
  return PROPORCAO_DO_CARTAO / Math.max(Math.sqrt(escala), conteudo / alturaDeFabrica);
}

export function alturaDoCartao(largura: number, fontScale: number): number {
  'worklet';
  return largura / proporcaoDoCartao(fontScale);
}
