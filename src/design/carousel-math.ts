/**
 * O carrossel da Carteira — puro, em worklet, testado em `node --test`.
 *
 * Tudo sai de UM número, o deslocamento horizontal. `d` é a distância de um item ao centro, em
 * passos: 0 no centro, +1 quando ele já foi um passo para a esquerda, −1 quando está chegando.
 *
 * O giro é um SENO de `d`: zero em repouso (vizinhos planos, como no vídeo) e máximo no meio da
 * troca, quando o cartão está "virando a página". Um giro linear deixaria os vizinhos tortos
 * para sempre e o cartão do centro quase sem movimento.
 */

const GIRO_MAX = 50;
const ESCALA_VIZINHO = 0.86;
const OPACIDADE_VIZINHO = 0.6;

export function indiceNoDeslocamento(x: number, passo: number, total: number): number {
  'worklet';
  if (total <= 0 || passo <= 0) return 0;
  return Math.min(total - 1, Math.max(0, Math.round(x / passo)));
}

export function distanciaDoItem(x: number, passo: number, indice: number): number {
  'worklet';
  return passo > 0 ? x / passo - indice : 0;
}

export function quadroDoItem(d: number, reduzir: boolean) {
  'worklet';
  const c = Math.min(1, Math.max(-1, d));
  const a = Math.abs(c);
  return {
    // Arredondado para não devolver `-0`, que o `deepEqual` distingue de `0`.
    giroY: reduzir ? 0 : Math.round(Math.sin(Math.PI * c) * GIRO_MAX * 1000) / 1000 || 0,
    escala: 1 - a * (1 - ESCALA_VIZINHO),
    opacidade: 1 - a * (1 - OPACIDADE_VIZINHO),
  };
}
