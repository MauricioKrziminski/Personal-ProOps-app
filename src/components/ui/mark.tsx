import { useEffect, useMemo } from 'react';
import { Canvas, Group, Path } from '@shopify/react-native-skia';
import {
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { StyleProp, ViewStyle } from 'react-native';

import type { ThemeColor } from '@/constants/theme';
import { markPath } from '@/design/mark-path';
import { useTheme } from '@/hooks/use-theme';

interface MarkProps {
  size?: number;
  /** Cor via token — a marca é monocromática e nunca leva hex. */
  color?: ThemeColor;
  /** Gira continuamente: é o indicador de carregamento do app. */
  spinning?: boolean;
  /** Marca d'água: opacidade baixa, para o fundo do painel de destaque. */
  watermark?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A marca do ProOps, desenhada em vetor.
 *
 * Existe porque a identidade é **monocromática**: sem cor de marca, a personalidade tem que vir
 * da forma — e a alavanca conhecida é **repetir a forma em papéis utilitários**, como a Vercel
 * faz com o ▲ (wordmark, prefixo de comando, indicador de carregamento, marcador de colapso).
 *
 * Daí os papéis previstos: `spinning` é o carregamento (no lugar do `ActivityIndicator`, que é
 * de todo mundo), `watermark` é o fundo do painel de destaque, e o tamanho grande é o ícone do
 * estado vazio. Cinco aparições da mesma forma, zero cor nova — e o app fica reconhecível num
 * screenshot sem logotipo.
 *
 * A geometria e a correção do `transform` herdado do SVG vivem em `@/design/mark-path`, que é a
 * **mesma** fonte usada pela animação de abertura.
 */
export function Mark({
  size = 24,
  color = 'text',
  spinning = false,
  watermark = false,
  style,
}: MarkProps) {
  const theme = useTheme();
  const path = useMemo(() => markPath(size), [size]);

  const angle = useSharedValue(0);

  useEffect(() => {
    if (!spinning) {
      angle.set(0);
      return;
    }
    angle.set(
      withRepeat(withTiming(Math.PI * 2, { duration: 1100, easing: Easing.linear }), -1, false)
    );
  }, [spinning, angle]);

  const transform = useDerivedValue(() => [{ rotate: angle.get() }]);
  const origin = useMemo(() => ({ x: size / 2, y: size / 2 }), [size]);

  return (
    <Canvas
      style={[{ width: size, height: size }, style]}
      // A marca é decoração quando não carrega informação; girando, quem anuncia o estado é o
      // componente que a hospeda (o Button já expõe `busy`).
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Group transform={transform} origin={origin}>
        <Path path={path} color={theme[color]} opacity={watermark ? 0.06 : 1} />
      </Group>
    </Canvas>
  );
}
