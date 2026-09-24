import { createContext, useContext } from 'react';
import { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

/**
 * O quanto o card de `forma="card"` está arrastado (o `translation` do `Deslizavel`), para a
 * SUPERFÍCIE dele — `Card` e o cartão da nota. Fora de um arrasto de card, `null`.
 */
export const DeslocamentoDoArrasto = createContext<SharedValue<number> | null>(null);

/** Quantos dp de arrasto até o canto do lado que abre ficar reto. */
const ATE_O_CANTO_FICAR_RETO = 12;

/**
 * Os cantos da superfície do card durante o arrasto: o lado que ABRE perde o raio e o card
 * encosta no painel como uma peça só ("tudo junto", decisão do dono do produto em 24/09/2026 —
 * *"essa borda da primeira opção… está com borda reta e feia"*). As pontas de fora continuam
 * arredondadas pelo recorte do `Deslizavel`.
 *
 * Os quatro cantos saem SEMPRE no estilo: um estilo animado que deixa de escrever uma chave não a
 * devolve ao valor da base — o canto ficaria reto depois de fechar.
 */
export function useCantosDoArrasto(raio: number) {
  const deslocamento = useContext(DeslocamentoDoArrasto);
  return useAnimatedStyle(() => {
    const v = deslocamento ? deslocamento.get() : 0;
    const k = raio * (1 - Math.min(1, Math.abs(v) / ATE_O_CANTO_FICAR_RETO));
    return {
      borderTopLeftRadius: v > 0 ? k : raio,
      borderBottomLeftRadius: v > 0 ? k : raio,
      borderTopRightRadius: v < 0 ? k : raio,
      borderBottomRightRadius: v < 0 ? k : raio,
    };
  });
}
