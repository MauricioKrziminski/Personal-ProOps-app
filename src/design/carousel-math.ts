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

/** Quanto de inércia entra na escolha do destino: a posição onde o dedo "jogaria" o cartão. */
const INERCIA_S = 0.12;
/** Quanto a borda cede quando se puxa além do primeiro ou do último cartão. */
const ELASTICO = 0.35;

/**
 * Para onde o carrossel vai quando o dedo solta: a posição projetada com um pouco da velocidade,
 * arredondada ao passo, e no máximo UM cartão a partir de onde o deslize começou — como a tela
 * inicial do iOS. `velocidade` é a do deslocamento (px/s, positiva indo para o próximo).
 */
export function alvoDoDeslize(
  inicio: number,
  x: number,
  velocidade: number,
  passo: number,
  total: number
): number {
  'worklet';
  if (total <= 0 || passo <= 0) return 0;
  const origem = Math.round(inicio / passo);
  const projetado = Math.round((x + velocidade * INERCIA_S) / passo);
  const umPasso = Math.min(origem + 1, Math.max(origem - 1, projetado));
  return Math.min(total - 1, Math.max(0, umPasso));
}

/** O deslocamento com a borda elástica: além das pontas o dedo anda, o carrossel cede um terço. */
export function comElastico(x: number, passo: number, total: number): number {
  'worklet';
  const fim = Math.max(0, total - 1) * passo;
  if (x < 0) return x * ELASTICO;
  if (x > fim) return fim + (x - fim) * ELASTICO;
  return x;
}

/**
 * Qual cartão está debaixo de um toque, com o carrossel onde ele está AGORA (inclusive no meio
 * da mola). `xLocal` é o ponto no palco, que tem `largura` e o cartão do centro no meio dele.
 *
 * O cartão `i` é desenhado com `translateX = -d·passo = i·passo − deslocamento` a partir do
 * lugar do centro, então o centro dele fica em `largura/2 + i·passo − deslocamento`. Invertendo,
 * `i = (deslocamento + xLocal − largura/2) / passo`, arredondado: o vão entre dois cartões conta
 * para o mais perto. A escala dos vizinhos (0,86, em volta do próprio centro) não muda o centro.
 */
export function indiceTocado(
  xLocal: number,
  largura: number,
  deslocamento: number,
  passo: number,
  total: number
): number {
  'worklet';
  if (total <= 0 || passo <= 0) return 0;
  return Math.min(total - 1, Math.max(0, Math.round((deslocamento + xLocal - largura / 2) / passo)));
}
