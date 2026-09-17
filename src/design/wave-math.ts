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
