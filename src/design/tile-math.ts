/**
 * A geometria do campo de azulejos — a assinatura visual do mundo Concreto.
 *
 * Pura de propósito: roda em `node --test` e, com a diretiva `'worklet'`, dentro do
 * `useRSXformBuffer` do Skia, na thread de UI, a cada quadro.
 *
 * ## O azulejo
 *
 * Quatro peças — 0 quadrado, 1 quarto de círculo, 2 meio círculo, 3 triângulo — giradas em
 * quartos de volta. É o vocabulário dos painéis do Athos Bulcão em Brasília, e o quarto de
 * círculo é o mesmo arco que forma a espiral da marca.
 *
 * ## Por que SEMENTE e não `Math.random`
 *
 * A cortina da abertura e o friso do login precisam desenhar **os mesmos azulejos no mesmo
 * lugar**: a abertura para no meio da onda e entrega a tela para o login, que redesenha o friso
 * sozinho. Com sorteio de verdade, os dois discordariam e a troca apareceria como um salto. O
 * "assentado ao acaso" do Bulcão continua — só que o acaso é reproduzível.
 *
 * ## A onda
 *
 * `progress` vai de 0 (tudo coberto) a 1 (revelado). Cada azulejo tem uma janela dentro desse
 * intervalo, e a posição da janela é a `ordem` dele na onda. As janelas se sobrepõem
 * (`overlap`), então muitos azulejos giram ao mesmo tempo — é o que faz a onda ler como um
 * movimento só e não como uma fila.
 */

export type WaveMode = 'diagonal' | 'radial' | 'up' | 'down';

export interface TileGrid {
  cols: number;
  rows: number;
  /** lado do azulejo, em dp — a largura divide por ele sem sobra */
  size: number;
  count: number;
}

/**
 * Grade que cobre a área inteira. A largura manda (divide sem sobra, para as colunas baterem com
 * as bordas da tela); a altura arredonda para cima e a última linha pode passar da borda.
 */
export function tileGrid(width: number, height: number, target = 48): TileGrid {
  'worklet';
  const cols = Math.max(1, Math.round(width / target));
  const size = Math.max(1, width) / cols;
  const rows = Math.max(1, Math.ceil(Math.max(1, height) / size));
  return { cols, rows, size, count: cols * rows };
}

/** Hash inteiro → [0, 1). Mesma entrada, mesmo número, em qualquer thread. */
export function seeded(i: number, seed: number): number {
  'worklet';
  let h = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(seed + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Qual das quatro peças mora no azulejo `i`. */
export function tilePiece(i: number, seed: number): number {
  'worklet';
  return Math.floor(seeded(i, seed) * 4);
}

/** Quantos quartos de volta a peça do azulejo `i` está girada. */
export function tileTurns(i: number, seed: number): number {
  'worklet';
  return Math.floor(seeded(i, seed + 101) * 4);
}

/** Um terço dos azulejos PARADOS (o friso) mostra o motivo; o resto é tinta lisa. */
export function patterned(i: number, seed: number): boolean {
  'worklet';
  return seeded(i, seed + 202) < 0.34;
}

/**
 * Em que ponto da onda o azulejo (col, row) entra: 0 é o primeiro, 1 o último.
 *
 * `ox`/`oy` são a origem em fração da área (0..1). Com `seed`, um fio de ruído (15%) quebra a
 * régua para a onda não parecer uma persiana; as pontas (0 e 1) ficam exatas, porque é por elas
 * que a onda começa e termina no tempo certo.
 */
export function waveOrder(
  col: number,
  row: number,
  cols: number,
  rows: number,
  mode: WaveMode,
  ox = 0.5,
  oy = 0.5,
  seed = 0
): number {
  'worklet';
  const x = cols > 1 ? col / (cols - 1) : 0.5;
  const y = rows > 1 ? row / (rows - 1) : 0.5;
  let base: number;
  if (mode === 'up') {
    base = 1 - y;
  } else if (mode === 'down') {
    base = y;
  } else if (mode === 'radial') {
    const far = Math.max(
      Math.hypot(ox, oy),
      Math.hypot(1 - ox, oy),
      Math.hypot(ox, 1 - oy),
      Math.hypot(1 - ox, 1 - oy)
    );
    base = far > 0 ? Math.min(1, Math.hypot(x - ox, y - oy) / far) : 0;
  } else {
    const sx = ox <= 0.5 ? x : 1 - x;
    const sy = oy <= 0.5 ? y : 1 - y;
    base = (sx + sy) / 2;
  }
  if (seed === 0 || base <= 0 || base >= 1) return base;
  const ruido = seeded(row * cols + col, seed + 303) * 0.15;
  return Math.min(1, Math.max(0, base * 0.85 + ruido));
}

/** Progresso local do azulejo. Cada janela tem largura `1 - overlap`, e todas cabem em [0, 1]. */
export function tilePhase(progress: number, order: number, overlap = 0.6): number {
  'worklet';
  const w = 1 - overlap;
  const start = order * (1 - w);
  return Math.min(1, Math.max(0, (progress - start) / w));
}

function easeInOut(t: number): number {
  'worklet';
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** A tinta encolhe e gira até 45° na primeira metade da janela, e fica fora dali em diante. */
export function inkPose(t: number): { scale: number; angle: number } {
  'worklet';
  const e = easeInOut(Math.min(1, Math.max(0, t) / 0.5));
  return { scale: 1 - e, angle: e * (Math.PI / 4) };
}

/**
 * O motivo floresce de 0,15 a 0,5 (enquanto a tinta encolhe por cima dele) e some de 0,5 a 1,
 * girando de 45° a 90°. Lido junto com a tinta, é o azulejo virando e mostrando o desenho.
 */
export function motifPose(t: number): { scale: number; angle: number } {
  'worklet';
  if (t <= 0.15) return { scale: 0, angle: 0 };
  if (t >= 1) return { scale: 0, angle: Math.PI / 2 };
  if (t < 0.5) {
    const e = easeInOut((t - 0.15) / 0.35);
    return { scale: e, angle: (Math.PI / 4) * e };
  }
  const e = easeInOut((t - 0.5) / 0.5);
  return { scale: 1 - e, angle: Math.PI / 4 + (Math.PI / 4) * e };
}

/**
 * Quantas linhas ficam no friso nesta coluna: um perfil em degraus que desce para a direita, com
 * um degrau extra aqui e ali pela semente. `depth` 0 = a onda limpa tudo.
 */
export function friezeDepth(col: number, cols: number, depth: number, seed: number): number {
  'worklet';
  if (depth <= 0) return 0;
  const queda = Math.floor((col / Math.max(1, cols - 1)) * (depth - 1) * 0.6);
  const salto = seeded(col, seed + 7) < 0.35 ? 1 : 0;
  return Math.max(1, Math.min(depth, depth - queda - salto));
}
