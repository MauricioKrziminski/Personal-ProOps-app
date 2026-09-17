import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Uma travessia: um ponto passa por cima do outro e os dois trocam de lugar. */
const TRAVESSIA_MS = 520;

/**
 * O indicador de carregamento do app: dois pontos que trocam de lugar, um passando por cima do
 * outro — o loader dos vídeos de referência.
 *
 * Um relógio só (ida e volta) e a posição de cada ponto é aritmética no worklet: o da frente
 * cresce ao cruzar, o de trás encolhe, e a troca lê como um ponto atravessando o outro. Com
 * Reduce Motion os dois ficam parados — quem hospeda (o botão) já anuncia `busy`.
 */
export function DotsLoader({
  size = 7,
  color = 'onTint',
}: {
  size?: number;
  color?: ThemeColor;
}) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const relogio = useSharedValue(0);

  useEffect(() => {
    if (reduzido) return;
    relogio.set(
      withRepeat(
        withTiming(1, { duration: TRAVESSIA_MS, easing: Easing.inOut(Easing.cubic) }),
        -1,
        true
      )
    );
    return () => cancelAnimation(relogio);
  }, [relogio, reduzido]);

  const passo = size * 0.9;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.palco, { width: size * 4, height: size * 2 }]}>
      <Ponto relogio={relogio} lado={-1} passo={passo} size={size} cor={theme[color]} />
      <Ponto relogio={relogio} lado={1} passo={passo} size={size} cor={theme[color]} />
    </View>
  );
}

function Ponto({
  relogio,
  lado,
  passo,
  size,
  cor,
}: {
  relogio: SharedValue<number>;
  lado: -1 | 1;
  passo: number;
  size: number;
  cor: string;
}) {
  const estilo = useAnimatedStyle(() => {
    const t = relogio.get();
    // Sai de um lado e chega ao outro; no meio do caminho, quem vai à frente cresce.
    const x = lado * passo * (1 - 2 * t);
    const cruzando = Math.sin(Math.PI * t);
    const escala = 1 + lado * 0.28 * cruzando;
    return {
      zIndex: lado > 0 ? 1 : 0,
      transform: [{ translateX: x }, { scale: escala }],
    };
  });
  return (
    <Animated.View
      style={[
        styles.ponto,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: cor },
        estilo,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  palco: { alignItems: 'center', justifyContent: 'center' },
  ponto: { position: 'absolute' },
});
