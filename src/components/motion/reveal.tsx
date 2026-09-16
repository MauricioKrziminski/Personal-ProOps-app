import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { Motion } from '@/design/tokens';

/** Atraso de um item numa cascata: um passo por posição, com teto (`Motion.stagger`). */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(0, index) * Motion.stagger.step, Motion.stagger.cap);
}

/**
 * A entrada de um bloco: sobe 12pt e aparece, ou só aparece.
 *
 * `index` põe o bloco numa cascata sem que a tela precise fazer a conta do atraso — e sem passar
 * do teto, que é o que impede "abrir a tela" de virar "assistir a uma animação". `from="fade"` é
 * a troca de esqueleto por conteúdo: nada se move, só a substituição acontece.
 *
 * Os builders do Reanimated respeitam Reduce Motion sozinhos (`ReduceMotion.System`).
 *
 * ⚠️ Texto que é IDENTIFICADOR dentro de um `Reveal` leva `flexShrink: 0` (design.md §3): medido
 * enquanto o bloco ainda está entrando, o `ThemedText` encolhe e não se remede nunca mais — foi
 * assim que "App bloqueado" virou "App" na trava.
 */
export function Reveal({
  index = 0,
  delay = 0,
  from = 'up',
  children,
  style,
}: {
  index?: number;
  delay?: number;
  from?: 'up' | 'fade';
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const atraso = staggerDelay(index) + delay;
  const entering =
    from === 'fade'
      ? FadeIn.duration(180).delay(atraso).reduceMotion(ReduceMotion.System)
      : FadeInDown.withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] })
          .duration(Motion.duration.slow + 60)
          .easing(Motion.easing.out)
          .delay(atraso)
          .reduceMotion(ReduceMotion.System);

  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}
