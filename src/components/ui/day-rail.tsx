import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * Um grupo da agenda preso a um trilho vertical: o nó marca o dia, o fio liga ao próximo.
 *
 * O tom do nó é semântico (tijolo para atraso, verde para dinheiro que entra); o fio é sempre
 * `rail`. `last` corta o fio no último grupo.
 */
export function DayRail({
  label,
  tone = 'neutral',
  last = false,
  children,
}: {
  label: string;
  tone?: 'neutral' | 'danger' | 'success';
  last?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const cor = tone === 'danger' ? theme.danger : tone === 'success' ? theme.success : theme.text;
  return (
    <View style={styles.linha}>
      <View style={styles.coluna}>
        <View style={[styles.no, { borderColor: cor, backgroundColor: theme.background }]} />
        {last ? null : <View style={[styles.fio, { backgroundColor: theme.rail }]} />}
      </View>
      <View style={[styles.corpo, last && styles.ultimo]}>
        <ThemedText type="caption" themeColor={tone === 'neutral' ? 'textSecondary' : tone}>
          {label}
        </ThemedText>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', gap: Space.md },
  coluna: { width: 12, alignItems: 'center' },
  no: { width: 12, height: 12, marginTop: 2, borderRadius: Radius.pill, borderWidth: 2 },
  fio: { width: 2, flex: 1, marginTop: Space.xs, borderRadius: Radius.pill },
  corpo: { flex: 1, minWidth: 0, gap: Space.sm, paddingBottom: Space.lg },
  ultimo: { paddingBottom: 0 },
});
