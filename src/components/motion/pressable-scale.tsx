import * as Haptics from 'expo-haptics';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Motion } from '@/design/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressableScaleProps = Omit<PressableProps, 'style'> & {
  /** Escala no press-in. Padrão: `Motion.pressScale`. */
  scaleTo?: number;
  /** Háptico disparado no `onPress`, no mesmo quadro do efeito. */
  haptic?: 'selection' | 'light';
  /** Estilo ESTÁTICO — a escala é a única coisa animada aqui. */
  style?: StyleProp<ViewStyle>;
};

/**
 * O press-in de bloco: botão, card, cartão, ladrilho.
 *
 * Existia copiado em `Button`, `QuickActions`, `PressCard` e no `HeroPanel` — quatro cópias do
 * mesmo `useSharedValue` + `withTiming`, cada uma com a sua duração de volta. Um lugar só decide
 * a curva: entra em `fast` com ease-out forte e volta em `base`, mais devagar que a ida, para o
 * soltar ler como assentar e não como mola.
 *
 * Linha de lista NÃO usa isto — lá o feedback é highlight de fundo (`Row`), não escala.
 */
export function PressableScale({
  scaleTo = Motion.pressScale,
  haptic,
  style,
  onPressIn,
  onPressOut,
  onPress,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animado = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        scale.set(withTiming(scaleTo, { duration: Motion.duration.fast, easing: Motion.easing.out }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withTiming(1, { duration: Motion.duration.base, easing: Motion.easing.out }));
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic === 'selection') Haptics.selectionAsync();
        else if (haptic === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
      style={[style, animado]}
    />
  );
}
