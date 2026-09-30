import { useLayoutEffect, useRef } from 'react';
import { cancelAnimation, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { Motion } from '@/design/tokens';

function useValorSuave<T extends string | number>(alvo: T) {
  const reduzir = useReducedMotion();
  const valor = useSharedValue(alvo);
  const montado = useRef(false);
  useLayoutEffect(() => {
    if (montado.current) {
      valor.set(reduzir ? alvo : withTiming(alvo, {
        duration: Motion.duration.morph,
        easing: Motion.easing.inOut,
        reduceMotion: ReduceMotion.System,
      }));
    }
    montado.current = true;
    return () => cancelAnimation(valor);
  }, [alvo, reduzir, valor]);
  return valor;
}

/** Estado nasce na cor final; mudanças retargetam do valor corrente, sem apagar o conteúdo. */
export function useCoresSuaves({ backgroundColor, borderColor, color }: {
  backgroundColor?: string;
  borderColor?: string;
  color?: string;
}) {
  const fundo = useValorSuave(backgroundColor ?? 'transparent');
  const borda = useValorSuave(borderColor ?? 'transparent');
  const texto = useValorSuave(color ?? 'transparent');
  return useAnimatedStyle(() => ({
    ...(backgroundColor != null ? { backgroundColor: fundo.get() } : {}),
    ...(borderColor != null ? { borderColor: borda.get() } : {}),
    ...(color != null ? { color: texto.get() } : {}),
  }));
}

/** Material nativo e glifos conservam props; a seleção revela suas camadas no mesmo timing. */
export function useOpacidadeSuave(alvo: number) {
  const opacidade = useValorSuave(alvo);
  return useAnimatedStyle(() => ({ opacity: opacidade.get() }));
}
