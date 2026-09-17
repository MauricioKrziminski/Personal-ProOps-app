/**
 * A escala de uma série de dinheiro — uma só para o desenho (`Sparkline`) e para o dedo
 * (`ScrubChart`). Duas cópias poriam o ponto do arraste fora da curva.
 *
 * O domínio vertical sai dos DADOS, não de zero (uma série de 2.500–2.800 esmagada em 6px lia
 * como divisor), com um span mínimo para ruído de centavos não virar onda.
 */
export const PAD = 6;
const MIN_SPAN_RATIO = 0.05;

export type EscalaDaSerie = {
  lo: number;
  hi: number;
  x: (i: number) => number;
  y: (v: number) => number;
};

export function escalaDaSerie(values: readonly number[], width: number, height: number): EscalaDaSerie | null {
  if (values.length < 2 || width <= 0) return null;
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const span = Math.max(dataMax - dataMin, Math.abs(dataMax) * MIN_SPAN_RATIO, 1);
  const mid = (dataMin + dataMax) / 2;
  const lo = mid - span / 2;
  const hi = mid + span / 2;
  const plot = height - PAD * 2;
  const passo = (width - PAD * 2) / (values.length - 1);
  return {
    lo,
    hi,
    x: (i) => PAD + i * passo,
    y: (v) => PAD + ((hi - v) / (hi - lo)) * plot,
  };
}

/** O ponto da série mais perto do dedo. */
export function indiceNoX(x: number, n: number, width: number): number {
  'worklet';
  if (n < 2) return 0;
  const passo = (width - PAD * 2) / (n - 1);
  return Math.min(n - 1, Math.max(0, Math.round((x - PAD) / passo)));
}

/** Onde o rótulo começa: centrado no ponto, preso às bordas. */
export function posicaoDoRotulo(px: number, largura: number, larguraRotulo: number): number {
  'worklet';
  return Math.min(Math.max(px - larguraRotulo / 2, 0), Math.max(0, largura - larguraRotulo));
}
