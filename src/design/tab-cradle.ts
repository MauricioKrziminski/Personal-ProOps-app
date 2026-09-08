/**
 * Onde o berço da tab bar fica, quando ele cai perto da ponta da pílula.
 *
 * ## O defeito que isto corrige (07/09/2026)
 *
 * A mordida do berço é um disco de raio `CUT` centrado na aresta de cima da barra. Com CINCO
 * abas num aparelho de 384dp a conta fica assim (medida, não estimada):
 *
 * | | dp |
 * |---|---|
 * | largura da pílula (384 − 2×16) | 352 |
 * | slot (352 ÷ 5) | 70,4 |
 * | centro da última aba | 316,8 |
 * | borda direita do disco (316,8 + 33) | 349,8 |
 * | ponta da pílula | 352 |
 *
 * Sobram **2,2dp** de pílula depois do disco. Essa lasca é fina demais para ler como "a barra
 * termina arredondada" e grossa o bastante para o traço dela aparecer: o contorno saía da
 * mordida, dava um pulinho e recomeçava — um arco solto pendurado na ponta, que foi o que
 * apareceu na captura das abas Hoje e Perfil.
 *
 * ## Por que a saída é empurrar, e não afastar
 *
 * Afastar o berço da ponta exigiria recuar a faixa de slots em ~40dp de cada lado, e aí
 * "Financeiro" não caberia mais no rótulo. Encolher o disco não resolve (o centro do slot é que
 * está perto da ponta). Diminuir o raio da pílula também não: com r = 20 o centro precisaria
 * estar a 53dp da borda e ele está a 35.
 *
 * O que sobra é a direção contrária: **quando falta pouco, o disco vai até o fim**. A mordida
 * encosta na borda, o contorno passa a ser uma peça só, e o preço é o berço andar aqueles 2,2dp
 * — junto com a bolha, que continua concêntrica com ele.
 *
 * ## E numa tela larga?
 *
 * Num tablet o slot é maior e sobra MUITO pílula depois do disco (27dp e acima). Ali a sobra lê
 * como a ponta arredondada da barra, que é o desenho certo, e empurrar o berço até a borda
 * deslocaria a bolha para longe do rótulo dela — o defeito que a barra já teve uma vez. Por isso
 * o empurrão só existe abaixo de um limiar, e o limiar é `r / 4`: um quarto do canto ainda lê
 * como canto; menos que isso lê como lasca.
 *
 * Módulo PURO — sem React, sem Skia — pelo mesmo motivo de `dates.ts`: geometria que só dá para
 * conferir gravando a tela é geometria que ninguém confere.
 */

/** Acima disto a sobra lê como a ponta arredondada da barra e nada é empurrado. */
export const LIMIAR_LASCA = 1 / 4;

/**
 * O deslocamento (em dp) que o berço da aba da ponta precisa para encostar na borda da pílula.
 *
 * Devolve `0` quando não há lasca a corrigir: ou o disco já passa da borda, ou sobra tanto que
 * a sobra é o próprio canto arredondado.
 *
 * @param slot     largura de um slot (largura da pílula ÷ número de abas)
 * @param cut      raio do disco do berço
 * @param raioPilula raio do canto da pílula
 */
export function empurraoDaPonta(slot: number, cut: number, raioPilula: number): number {
  // Sobra entre a borda do disco e a ponta da barra, quando o berço está na aba da ponta.
  const lasca = slot / 2 - cut;
  if (lasca <= 0) return 0; // o disco já cobre a ponta
  if (lasca >= raioPilula * LIMIAR_LASCA) return 0; // sobra o suficiente para ler como canto
  return lasca;
}

/**
 * A posição do berço em SLOTS, já com o empurrão das pontas aplicado.
 *
 * O empurrão desaparece linearmente conforme a bolha se afasta da ponta, então não há salto no
 * meio da animação: na aba 0 ele vale inteiro, na aba 1 vale zero, e entre as duas interpola.
 *
 * @param posicao   posição contínua da mola, em slots (0 = primeira aba)
 * @param total     número de abas
 * @param empurrao  o valor de `empurraoDaPonta`, em dp
 * @param slot      largura de um slot, em dp
 */
export function posicaoDoBerco(
  posicao: number,
  total: number,
  empurrao: number,
  slot: number
): number {
  'worklet';
  if (empurrao === 0 || slot <= 0) return posicao;

  const emSlots = empurrao / slot;
  const perto_do_inicio = Math.max(0, 1 - posicao);
  const perto_do_fim = Math.max(0, posicao - (total - 2));

  return posicao - perto_do_inicio * emSlots + perto_do_fim * emSlots;
}
