/**
 * Quanto um ladrilho encolhe o valor antes de preferir a linha inteira. Abaixo disso o número
 * fica pequeno demais para o bloco que existe para mostrá-lo (29/09/2026: a 2,14× o "Sai" ficava a
 * 50% lado a lado; o dono do produto pediu a linha inteira "somente quando realmente for
 * necessário").
 */
export const ENCOLHE_ATE = 0.7;

/**
 * A menor largura em que o ladrilho se lê sem partir palavra nem encolher o valor além do
 * limite. `palavraMaisLarga` e `valorNatural` são medidos sem restrição de largura; `respiro` é o
 * padding horizontal de cada lado.
 */
export function larguraMinimaDoLadrilho(palavraMaisLarga: number, valorNatural: number, respiro: number): number {
  return Math.ceil(Math.max(palavraMaisLarga, valorNatural * ENCOLHE_ATE) + 2 * respiro);
}

/**
 * A fileira (ou grade) empilha: TODOS os ladrilhos ocupam a linha inteira quando o maior mínimo
 * não cabe na metade dela. Um por um daria larguras diferentes no par; e antes de a fileira medir
 * a própria largura (`0`) não se decide nada.
 */
export function empilhaLadrilhos(maiorMinimo: number, larguraDaFileira: number, vao: number): boolean {
  return larguraDaFileira > 0 && maiorMinimo > (larguraDaFileira - vao) / 2;
}
