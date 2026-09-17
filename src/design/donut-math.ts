/**
 * A rosca de "Para onde foi": até seis fatias com nome e o resto junto.
 *
 * `CHAVE_OUTRAS` é sentinela, não palavra — uma categoria de verdade pode se chamar "outras".
 * Ângulos em fração de volta, 0 no topo, sentido horário; o respiro entre fatias nunca passa de
 * um terço da própria fatia (uma fatia fina não pode sumir no respiro).
 */
export const CHAVE_OUTRAS = '__outras__';

export type Fatia = { chave: string; valor: number; inicio: number; fim: number; tom: number };

export function fatias(itens: readonly { chave: string; valor: number }[], max = 6, respiro = 0.006): Fatia[] {
  const positivos = itens.filter((i) => i.valor > 0).sort((a, b) => b.valor - a.valor);
  const cabeca = positivos.slice(0, max);
  const resto = positivos.slice(max).reduce((s, i) => s + i.valor, 0);
  const lista = resto > 0 ? [...cabeca, { chave: CHAVE_OUTRAS, valor: resto }] : cabeca;
  const total = lista.reduce((s, i) => s + i.valor, 0);
  if (total <= 0) return [];

  let acumulado = 0;
  return lista.map((item, indice) => {
    const fracao = item.valor / total;
    const gap = lista.length > 1 ? Math.min(respiro, fracao / 3) : 0;
    const fatia = {
      chave: item.chave,
      valor: item.valor,
      inicio: acumulado + gap / 2,
      fim: acumulado + fracao - gap / 2,
      tom: Math.min(indice, 5),
    };
    acumulado += fracao;
    return fatia;
  });
}

/** A fatia sob o toque, ou -1 (fora do anel, no furo ou no respiro). */
export function fatiaNoPonto(
  x: number,
  y: number,
  centro: number,
  raioInterno: number,
  raioExterno: number,
  lista: readonly Fatia[]
): number {
  'worklet';
  const dx = x - centro;
  const dy = y - centro;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < raioInterno || d > raioExterno) return -1;
  let a = Math.atan2(dx, -dy) / (2 * Math.PI);
  if (a < 0) a += 1;
  for (let i = 0; i < lista.length; i++) {
    if (a >= lista[i].inicio && a <= lista[i].fim) return i;
  }
  return -1;
}
