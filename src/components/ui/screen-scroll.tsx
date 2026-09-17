import { createContext, useContext } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

/**
 * O deslocamento vertical da rolagem da tela, na UI thread.
 *
 * Existe para a luz do herói e o FAB reagirem à rolagem SEM passar pelo JS: um `onScroll`
 * comum custaria um render por quadro. Quem está fora de um `Screen` lê um valor parado em 0.
 */
export const RolagemDaTela = createContext<SharedValue<number> | null>(null);

export function useRolagemDaTela(): SharedValue<number> {
  const daTela = useContext(RolagemDaTela);
  const parado = useSharedValue(0);
  return daTela ?? parado;
}
