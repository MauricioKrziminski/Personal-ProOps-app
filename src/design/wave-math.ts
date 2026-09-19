/**
 * A geometria da cortina curva — pura, em worklet, testada em `node --test`.
 *
 * A cortina é uma forma de tinta cuja borda é uma curva: começa mais baixa à esquerda, faz uma
 * barriga e sobe para a direita, como a dos vídeos de referência. `p` é o progresso da cortina
 * (0 = tela coberta, 1 = tela livre) e as duas fases andam PARA CIMA:
 *
 * - **cobrir** (`p` de 1 a 0): a região ABAIXO da curva, com a borda subindo do pé da tela;
 * - **revelar** (`p` de 0 a 1): a região ACIMA da curva, com a borda subindo até sumir no topo.
 *
 * Nas pontas as duas formas coincidem (tudo ou nada), então trocar de fase com a cortina parada
 * não aparece. A onda `down` é a mesma geometria espelhada na vertical — quem espelha é o
 * componente.
 */

export type WaveMode = 'up' | 'down' | 'radial';
export type FaseDaOnda = 'cobrir' | 'revelar';

export function easeInOut(t: number): number {
  'worklet';
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Profundidade da barriga: mais funda no meio do movimento, mais rasa nas pontas. */
export function amplitude(p: number, altura: number): number {
  'worklet';
  return altura * 0.16 * (0.55 + 0.45 * Math.sin(Math.PI * easeInOut(p)));
}

/** Os pontos da borda a partir da linha de base. O casco vai de `base - A/2` a `base + 1,25A`. */
export function pontosDaCurva(base: number, largura: number, A: number) {
  'worklet';
  return {
    y0: base + A * 0.5,
    c1x: largura * 0.3,
    c1y: base + A * 1.25,
    c2x: largura * 0.72,
    c2y: base - A * 0.1,
    y1: base - A * 0.5,
  };
}

/**
 * A linha de base da borda. Ela corre de `altura + 0,6A` (curva inteira abaixo da tela) a `-1,3A`
 * (curva inteira acima), que são as folgas do casco de `pontosDaCurva`.
 */
export function bordaDaOnda(p: number, fase: FaseDaOnda, altura: number, A: number): number {
  'worklet';
  const e = easeInOut(p);
  const embaixo = altura + A * 0.6;
  const emCima = -A * 1.3;
  return fase === 'cobrir' ? emCima + (embaixo - emCima) * e : embaixo + (emCima - embaixo) * e;
}

/** O círculo que cobre a partir de um ponto (fração da tela): zero em `p = 1`, a tela em `p = 0`. */
export function raioDaCobertura(
  p: number,
  ox: number,
  oy: number,
  largura: number,
  altura: number
): number {
  'worklet';
  const cx = ox * largura;
  const cy = oy * altura;
  const longe = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(largura - cx, cy),
    Math.hypot(cx, altura - cy),
    Math.hypot(largura - cx, altura - cy)
  );
  return (1 - easeInOut(p)) * (longe + 2);
}

/** Onde a borda da capa do login descansa: uma faixa curta no topo, em 17% da altura da tela. */
export const CAPA = 0.17;

/**
 * O progresso de REVELAR em que a linha de base cai em `CAPA`. A amplitude depende do progresso,
 * então não há fórmula fechada: bisseção, que converge em 30 passos para bem menos de um pixel.
 * A borda de revelar só sobe com `p`, então a função é monotônica e a bisseção é segura.
 */
export function progressoDaCapa(altura: number): number {
  'worklet';
  const alvo = altura * CAPA;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const meio = (lo + hi) / 2;
    const base = bordaDaOnda(meio, 'revelar', altura, amplitude(meio, altura));
    if (base > alvo) lo = meio;
    else hi = meio;
  }
  return (lo + hi) / 2;
}

/**
 * O ponto mais BAIXO da borda da capa — o fundo da barriga, que desce abaixo da ponta esquerda.
 * O conteúdo da tela de conta começa depois dele. A cúbica não tem máximo fechado barato: 64
 * amostras dão menos de meio pixel de erro nas alturas de tela reais.
 */
export function alturaDaCapa(altura: number): number {
  'worklet';
  const p = progressoDaCapa(altura);
  const A = amplitude(p, altura);
  const c = pontosDaCurva(bordaDaOnda(p, 'revelar', altura, A), 0, A);
  let fundo = c.y0;
  for (let i = 1; i <= 64; i++) {
    const t = i / 64;
    const u = 1 - t;
    const y = u * u * u * c.y0 + 3 * u * u * t * c.c1y + 3 * u * t * t * c.c2y + t * t * t * c.y1;
    if (y > fundo) fundo = y;
  }
  return fundo;
}
