/**
 * A aritmética de slot do `Reorderable` — worklets puros, sem React e sem Reanimated.
 *
 * Mora aqui e não dentro do componente porque é O QUE ERRA: um off-by-one no cálculo do slot não
 * dá erro nenhum, só solta o cartão no lugar errado. Fora do componente, dá para testar em
 * `node --test` como o resto dos helpers do projeto (`tab-cradle.ts` é o precedente).
 */

/** Onde o topo do slot `i` cai, em px, contando do começo do container. */
export function posY(
  i: number,
  ids: readonly string[],
  alturas: Record<string, number>,
  tileHeight: number,
  gap: number,
  columns: number
): number {
  'worklet';
  if (columns > 1) return Math.floor(i / columns) * (tileHeight + gap);
  let y = 0;
  for (let k = 0; k < i; k++) y += (alturas[ids[k]] ?? 0) + gap;
  return y;
}

/** Onde a esquerda do slot `i` cai. Numa lista é sempre 0. */
export function posX(i: number, larguraLadrilho: number, gap: number, columns: number): number {
  'worklet';
  return columns > 1 ? (i % columns) * (larguraLadrilho + gap) : 0;
}

/**
 * Qual slot está sob o dedo.
 *
 * ⚠️ Na LISTA o critério é o CENTRO do item arrastado, não o topo dele. Com o topo, um cartão
 * alto passando por cima de dois baixos escolhe o slot errado no meio do caminho e o leque
 * "pisca" — o vizinho abre e fecha espaço sem o dedo ter mudado de direção.
 */
export function slotSobODedo(
  de: number,
  total: number,
  x: number,
  y: number,
  ids: readonly string[],
  alturas: Record<string, number>,
  tileHeight: number,
  larguraLadrilho: number,
  gap: number,
  columns: number
): number {
  'worklet';
  if (columns > 1) {
    const col = Math.min(columns - 1, Math.max(0, Math.round(x / (larguraLadrilho + gap))));
    const lin = Math.max(0, Math.round(y / (tileHeight + gap)));
    return Math.min(total - 1, Math.max(0, lin * columns + col));
  }
  const centro = y + (alturas[ids[de]] ?? 0) / 2;
  let acumulado = 0;
  for (let k = 0; k < total; k++) {
    const h = (alturas[ids[k]] ?? 0) + gap;
    if (centro < acumulado + h) return k;
    acumulado += h;
  }
  return total - 1;
}

/**
 * Para que slot o irmão `index` anda enquanto `de` está sendo arrastado para `para`.
 *
 * Um slot, nunca mais, e só quem está ENTRE a origem e o destino se mexe — é o que impede a
 * lista inteira de deslizar junto quando o dedo atravessa a tela.
 */
export function slotDoIrmao(index: number, de: number, para: number): number {
  'worklet';
  if (de < 0 || para < 0) return index;
  if (de < index && index <= para) return index - 1;
  if (para <= index && index < de) return index + 1;
  return index;
}

/** A ordem nova depois de mover `de` para `para`. */
export function reordenar<T>(itens: readonly T[], de: number, para: number): T[] {
  const nova = [...itens];
  const [movido] = nova.splice(de, 1);
  nova.splice(para, 0, movido);
  return nova;
}

/**
 * Quanto o auto-scroll rola neste quadro, em px — negativo sobe, positivo desce, 0 não mexe.
 *
 * ⚠️ **`bottomInset` é o que torna a faixa de baixo ALCANÇÁVEL, e sem ele a falha é muda**
 * (14/09/2026). Nas raízes de aba o scroll passa POR BAIXO da dock flutuante: ele mede 888dp de
 * altura, mas os últimos ~98dp são a pílula e, abaixo dela, a área de gesto do sistema — que nem
 * entrega o `MOVE` ao app. A faixa começava em `888 - 88 = 800` e o dedo só alcançava 777:
 * `v` dava 0 para sempre, sem erro nenhum, e arrastar uma pasta para o fim de uma grade de 20
 * era impossível.
 *
 * É função pura e fica aqui, ao lado do resto da aritmética de slot, pelo mesmo motivo: um
 * off-by-one nesta conta não levanta exceção, só deixa de fazer uma coisa que ninguém testa.
 */
export function velocidadeAutoScroll(
  y: number,
  altura: number,
  janela: number,
  bottomInset: number,
  borda: number,
  velocidade: number
): number {
  'worklet';
  const pe = janela - bottomInset;
  if (y < borda) return -velocidade * ((borda - y) / borda);
  if (y + altura > pe - borda) return velocidade * ((y + altura - (pe - borda)) / borda);
  return 0;
}
