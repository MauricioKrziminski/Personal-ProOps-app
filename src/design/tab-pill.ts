/**
 * A geometria da barra de abas do Android — pura, em worklet, testada em `node --test`.
 *
 * A barra é uma pílula escura com um círculo claro atrás do ícone da aba ativa (o vídeo de
 * referência). O círculo anda numa mola com quique (`Motion.spring.tab`, decisão do dono do
 * produto em §5 do design), e a ultrapassagem de uma mola é proporcional à DISTÂNCIA: ir da
 * primeira à quinta aba jogaria o círculo para fora da pílula. A folga abaixo prende o desenho
 * na faixa em que ele ainda cabe — calculada da geometria, não escolhida a dedo.
 */

/** Quanto, em slots, a mola pode passar do alvo sem o círculo sair da pílula. */
export function folgaDaMola(slot: number, diametro: number, margem: number): number {
  'worklet';
  if (slot <= 0) return 0;
  return Math.max(0, (slot / 2 + margem - diametro / 2 - 1) / slot);
}

/** A posição que se desenha: a da mola, presa entre as duas pontas com a folga. */
export function posicaoDesenhada(progresso: number, total: number, folga: number): number {
  'worklet';
  return Math.min(Math.max(progresso, -folga), Math.max(0, total - 1) + folga);
}

/** O centro do círculo, em dp a partir da borda interna da pílula. */
export function centroDoSlot(posicao: number, slot: number): number {
  'worklet';
  return slot * (posicao + 0.5);
}

/** No tablet, o espaço entre os destinos não faz parte do alvo de toque. */
export function larguraDoAlvo(slot: number): number {
  return Math.max(0, Math.min(slot, 96));
}

/** Quanto uma aba está "sob" o círculo: 0 embaixo dele, 1 a um slot ou mais de distância. */
export function distanciaDaAba(posicao: number, indice: number): number {
  'worklet';
  return Math.min(1, Math.abs(posicao - indice));
}
