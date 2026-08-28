import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { HitTarget, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface RowProps {
  title: string;
  subtitle?: string;
  icon?: SymbolViewProps['name'];
  /** Valor, badge ou qualquer coisa à direita. Chevron é automático quando há `onPress`. */
  trailing?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  /** Rótulo de acessibilidade completo. Sem ele, cai em `title` + `subtitle`. */
  accessibilityLabel?: string;
}

/**
 * Linha de lista no padrão iOS.
 *
 * Feedback de press é **highlight de fundo**, nunca `scale` — escalar linha de lista é o tell
 * mais comum de UI que não é nativa (regra de design §5).
 */
export function Row({
  title,
  subtitle,
  icon,
  trailing,
  onPress,
  destructive = false,
  accessibilityLabel,
}: RowProps) {
  const theme = useTheme();

  const content = (pressed: boolean) => (
    <View style={[styles.row, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
      {icon ? <Icon name={icon} size="lg" color={destructive ? 'danger' : 'tint'} /> : null}
      <View style={styles.labels}>
        <ThemedText type="default" themeColor={destructive ? 'danger' : 'text'} numberOfLines={1}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {trailing}
      {onPress ? <Icon name="chevron.right" size="sm" color="textSecondary" /> : null}
    </View>
  );

  if (!onPress) return content(false);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(', ')}>
      {({ pressed }) => content(pressed)}
    </Pressable>
  );
}

/**
 * Agrupa `Row`s com hairline entre elas — o container de lista agrupada do iOS.
 * O separador começa depois do ícone, como no sistema.
 */
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  const theme = useTheme();
  const items = Children.toArray(children);

  return (
    <View style={styles.section}>
      {title ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionTitle}>
          {title.toUpperCase()}
        </ThemedText>
      ) : null}
      <View style={[styles.group, { backgroundColor: theme.surface }]}>
        {items.map((child, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={[styles.separator, { backgroundColor: theme.separator }]} /> : null}
            {child}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: HitTarget,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
  },
  labels: {
    flex: 1,
    gap: 2,
  },
  section: {
    gap: Space.sm,
  },
  sectionTitle: {
    paddingHorizontal: Space.lg,
    letterSpacing: 0.5,
  },
  group: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Space.lg,
  },
});
