import { useEffect } from 'react';
import { StyleSheet, type DimensionValue } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
}

/**
 * Bloco de carregamento.
 *
 * Skeleton só existe se tiver **a forma do conteúdo final** — spinner de tela cheia para
 * atualização parcial é reprovação na regra de design §7. Componha vários para desenhar a tela.
 */
export function Skeleton({ width = '100%', height = 16, radius = Radius.xs }: SkeletonProps) {
  const theme = useTheme();
  const pulse = useSharedValue(0.4);

  useEffect(() => {
    pulse.set(withRepeat(withTiming(0.9, { duration: 700 }), -1, true));
  }, [pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        animated,
        {
          width,
          height,
          borderRadius: radius,
          borderCurve: 'continuous',
          backgroundColor: theme.backgroundElement,
        },
      ]}
    />
  );
}

/** Forma pronta de linha de lista: título curto + subtítulo. */
export function SkeletonRow() {
  return (
    <Animated.View style={styles.row}>
      <Skeleton width="60%" height={17} />
      <Skeleton width="35%" height={13} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: Space.sm,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
  },
});
