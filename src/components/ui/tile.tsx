import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/motion/pressable-scale';
import { Icon, type IconName } from '@/components/ui/icon';
import { Elevation, Radius, Space } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';

export interface TileProps {
  /** `fill` divide uma `TileRow`; `half` e `wide` são células da `TileGrid`. */
  layout?: 'fill' | 'half' | 'wide';
  /** Ladrilho baixo, só rótulo e valor (os contadores da Hoje). */
  compact?: boolean;
  icon?: IconName;
  label: string;
  value?: ReactNode;
  caption?: string;
  /** Minigráfico no canto (anel, minicurva). Toma o lugar da seta. */
  visual?: ReactNode;
  /** Faixa embaixo do valor (a barra do "já caiu"). */
  footer?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}

const LAYOUT: Record<NonNullable<TileProps['layout']>, ViewStyle> = {
  fill: { flex: 1, minWidth: 0 },
  // `flexBasis` 40% + `flexGrow`: duas por linha repartindo o `gap`, e a última ímpar ocupa a linha.
  half: { flexGrow: 1, flexBasis: '40%', minWidth: 0 },
  wide: { flexBasis: '100%' },
};

/**
 * O ladrilho do mosaico: superfície branca, canto 18, ícone num selo, rótulo, valor e um slot de
 * minigráfico. Press em escala (é bloco, não linha — §5).
 */
export function Tile({
  layout = 'fill',
  compact = false,
  icon,
  label,
  value,
  caption,
  visual,
  footer,
  onPress,
  accessibilityLabel,
}: TileProps) {
  const theme = useTheme();
  const scheme = useScheme();

  const corpo = (
    <View
      style={[
        styles.tile,
        compact && styles.compacto,
        { backgroundColor: theme.surface, borderColor: theme.cardBorder, boxShadow: Elevation[scheme].raised },
      ]}>
      {compact ? null : (
        <View style={styles.topo}>
          {icon ? (
            <View style={[styles.selo, { backgroundColor: theme.backgroundElement }]}>
              <Icon name={icon} size="sm" color="text" />
            </View>
          ) : (
            <View />
          )}
          {visual ?? (onPress ? <Icon name="arrow.up.right" size="xs" color="textSecondary" /> : null)}
        </View>
      )}
      <View style={styles.base}>
        <ThemedText type="footnote" themeColor="textSecondary">
          {label}
        </ThemedText>
        {value}
        {caption ? (
          <ThemedText type="caption" themeColor="textSecondary">
            {caption}
          </ThemedText>
        ) : null}
      </View>
      {footer}
    </View>
  );

  if (!onPress) return <View style={LAYOUT[layout]}>{corpo}</View>;
  return (
    <PressableScale
      haptic="selection"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={LAYOUT[layout]}>
      {corpo}
    </PressableScale>
  );
}

/** Ladrilhos lado a lado, repartindo a largura. */
export function TileRow({ children }: { children: ReactNode }) {
  return <View style={styles.linha}>{children}</View>;
}

/** O mosaico: duas colunas, `wide` ocupa a linha. */
export function TileGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grade}>{children}</View>;
}

const styles = StyleSheet.create({
  tile: {
    flexGrow: 1,
    gap: Space.md,
    padding: Space.lg,
    minHeight: 112,
    justifyContent: 'space-between',
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  compacto: { minHeight: 0, paddingVertical: Space.md, gap: Space.xs },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  selo: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  base: { gap: Space.half },
  linha: { flexDirection: 'row', gap: Space.md },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
});
