import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';

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
  /**
   * O valor é dinheiro em tamanho de título. Com a fonte do sistema grande, o ladrilho `fill`
   * passa a ocupar a linha inteira: dividida em dois, a coluna não comporta o número e ele
   * partiria no meio ("R$ 12.333,2 / 0", medido a 384dp × 1,3).
   */
  valorGrande?: boolean;
}

const LAYOUT: Record<NonNullable<TileProps['layout']>, ViewStyle> = {
  /*
    `minWidth` é a válvula da régua 384dp × fonte 1,3: abaixo dela o rótulo partiria no meio da
    palavra ("Vencend/o", medido no emulador). Com a fileira em `flexWrap`, o terceiro ladrilho
    desce de linha antes disso.
  */
  fill: { flexGrow: 1, flexBasis: 0, minWidth: 96 },
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
  valorGrande = false,
}: TileProps) {
  const theme = useTheme();
  const scheme = useScheme();
  const { fontScale } = useWindowDimensions();
  const forma = valorGrande && layout === 'fill' && fontScale > 1.15 ? LAYOUT.wide : LAYOUT[layout];

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
        <ThemedText type={compact ? 'caption' : 'footnote'} themeColor="textSecondary">
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

  if (!onPress) return <View style={forma}>{corpo}</View>;
  return (
    <PressableScale
      haptic="selection"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={forma}>
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
    /*
      O conteúdo desce logo abaixo do ícone; a sobra fica no PÉ do ladrilho. Com
      `space-between`, dois ladrilhos lado a lado de alturas iguais e conteúdos de tamanhos
      diferentes empurravam o par de números para linhas de base diferentes — e abriam um vão
      no meio do mais curto (medido nos dois: "Entra R$ 0,00" ao lado de "Sai", que tem legenda
      e barra). Alinhados pelo topo, os dois valores ficam na mesma linha.
    */
    justifyContent: 'flex-start',
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  compacto: { minHeight: 0, paddingVertical: Space.md, paddingHorizontal: Space.md, gap: Space.xs },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  selo: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  base: { gap: Space.half },
  linha: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
});
