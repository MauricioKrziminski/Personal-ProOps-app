import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { ThemeColor } from '@/constants/theme';
import { quarterStep } from '@/design/tile-math';
import { useTheme } from '@/hooks/use-theme';

/** Um quarto de volta: 60% girando, 40% assentado (`quarterStep`). */
const PASSO_MS = 420;

/**
 * O indicador de carregamento do Concreto: um azulejo (quarto de círculo) que gira em quartos de
 * volta e ENCAIXA a cada passo.
 *
 * Um spinner contínuo diz "espere"; o degrau diz "estou trabalhando" com o mesmo gesto da onda
 * de azulejos. A forma é a peça 1 de `tile-math` — o mesmo arco da espiral da marca.
 *
 * Um relógio linear só, e o degrau é aritmética dentro do worklet: nada de `withSequence`
 * encadeado, que acumula erro de ângulo a cada volta.
 *
 * Com Reduce Motion ele não gira — fica parado, e quem hospeda (o botão) já anuncia `busy`.
 */
export function TileSpinner({
  size = 16,
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
      withRepeat(withTiming(4, { duration: PASSO_MS * 4, easing: Easing.linear }), -1, false)
    );
    return () => cancelAnimation(relogio);
  }, [relogio, reduzido]);

  const giro = useAnimatedStyle(() => ({
    transform: [{ rotate: `${quarterStep(relogio.get()) * 90}deg` }],
  }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}>
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            backgroundColor: theme[color],
            borderTopLeftRadius: size,
          },
          giro,
        ]}
      />
    </View>
  );
}
