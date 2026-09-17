import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Path, Skia, rect } from '@shopify/react-native-skia';
import { useDerivedValue, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { SkiaCanvas } from '@/components/ui/skia-canvas';
import type { ThemeColor } from '@/constants/theme';
import { Motion } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * Anel de progresso. Nasce no valor real e só anima quando ele muda — a mesma regra da
 * `ProgressBar` (uma mola parada no Android deixou uma barra em 0% que não existia).
 */
export function RingGauge({
  value,
  size = 56,
  stroke = 6,
  tone = 'text',
  track = 'backgroundElement',
  children,
  accessibilityLabel,
}: {
  /** 0..1. Acima de 1 o anel fica cheio. */
  value: number;
  size?: number;
  stroke?: number;
  tone?: ThemeColor;
  track?: ThemeColor;
  children?: ReactNode;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const alvo = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const fim = useSharedValue(alvo);
  const anterior = useRef(alvo);

  useEffect(() => {
    if (anterior.current === alvo) return;
    anterior.current = alvo;
    fim.set(reduzido ? alvo : withSpring(alvo, Motion.spring.encaixe));
  }, [alvo, fim, reduzido]);

  // Com o traço arredondado, um arco de tamanho zero desenha um ponto: some com o valor.
  const visivel = useDerivedValue(() => (fim.get() > 0.001 ? 1 : 0));

  const arco = useMemo(() => {
    const b = Skia.PathBuilder.Make();
    b.addArc(rect(stroke / 2, stroke / 2, size - stroke, size - stroke), -90, 359.9);
    return b.detach();
  }, [size, stroke]);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(alvo * 100) }}
      style={{ width: size, height: size }}>
      <SkiaCanvas style={StyleSheet.absoluteFill}>
        <Path path={arco} color={theme[track]} style="stroke" strokeWidth={stroke} />
        <Path
          path={arco}
          color={theme[tone]}
          style="stroke"
          strokeWidth={stroke}
          strokeCap="round"
          start={0}
          end={fim}
          opacity={visivel}
        />
      </SkiaCanvas>
      {children ? <View style={styles.centro}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centro: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
});
