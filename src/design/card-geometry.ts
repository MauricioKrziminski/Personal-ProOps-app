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

/** Largura ÷ altura da face. */
export function proporcaoDoCartao(fontScale: number): number {
  'worklet';
  return PROPORCAO_DO_CARTAO / Math.sqrt(Math.max(1, fontScale));
}

export function alturaDoCartao(largura: number, fontScale: number): number {
  'worklet';
  return largura / proporcaoDoCartao(fontScale);
}
