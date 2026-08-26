import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const DURATION = 600;

// A marca é monocromática: preta sobre fundo claro, branca sobre fundo escuro.
// require() precisa ser estático no Metro — por isso as duas fontes ficam no topo.
const MARK_ON_LIGHT = require('@/assets/images/brand/mark-black.png');
const MARK_ON_DARK = require('@/assets/images/brand/mark-white.png');

/**
 * Cobre a splash nativa e dissolve quando o app está pronto, evitando o corte seco
 * entre a splash do sistema e a primeira tela. O fundo e a variante da marca
 * acompanham o tema — e batem com o `expo-splash-screen` do app.json, senão
 * aparece um flash de cor errada na troca.
 */
export function AnimatedSplashOverlay() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  const splashKeyframe = new Keyframe({
    0: { transform: [{ scale: 1 }], opacity: 1 },
    20: { opacity: 1 },
    70: { opacity: 0, easing: Easing.elastic(0.7) },
    100: { opacity: 0, transform: [{ scale: 1 }], easing: Easing.elastic(0.7) },
  });

  const mark = (
    <Image
      style={styles.mark}
      contentFit="contain"
      source={scheme === 'dark' ? MARK_ON_DARK : MARK_ON_LIGHT}
    />
  );

  return animate ? (
    <Animated.View
      entering={splashKeyframe.duration(DURATION).withCallback((finished) => {
        'worklet';
        if (finished) {
          scheduleOnRN(setVisible, false);
        }
      })}
      style={[styles.splashOverlay, { backgroundColor: theme.background }]}>
      {mark}
    </Animated.View>
  ) : (
    <View
      onLayout={() => {
        SplashScreen.hideAsync().finally(() => {
          setAnimate(true);
        });
      }}
      style={[styles.splashOverlay, { backgroundColor: theme.background }]}>
      {mark}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    width: 96,
    height: 96,
  },
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
