import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { ThemedText } from '@/components/themed-text';
import type { ThemeColor } from '@/constants/theme';
import { HitTarget, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

export type TodaySignal = {
  key: 'bills' | 'reminders' | 'budgets';
  count: number;
  label: string;
  detail: string;
  tone: Extract<ThemeColor, 'text' | 'danger' | 'warning'>;
  destination: string;
  onPress: () => void;
};

/**
 * O índice do que pede atenção na Hoje. Um número só entra aqui quando é acionável; um zero não
 * disputa espaço com uma pendência real. As linhas compartilham uma superfície, e o primeiro
 * sinal ganha a escala maior sem transformar cada contador em outro card do painel.
 */
export function TodaySignals({ signals }: { signals: readonly TodaySignal[] }) {
  const theme = useTheme();
  if (signals.length === 0) return null;

  return (
    <Card style={styles.card}>
      {signals.map((signal, index) => (
        <View key={signal.key}>
          {index > 0 ? <View style={[styles.divider, { backgroundColor: theme.separator }]} /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${signal.label}: ${signal.count}. ${signal.detail}`}
            accessibilityHint={`Abre ${signal.destination}`}
            onPress={() => {
              Haptics.selectionAsync();
              signal.onPress();
            }}
            style={({ pressed }) => [
              styles.row,
              index === 0 && styles.lead,
              { backgroundColor: pressed ? theme.cardFooterPress : 'transparent' },
            ]}>
            <ThemedText
              type={index === 0 ? 'title' : 'subtitle'}
              themeColor={signal.tone}
              style={[styles.count, tabular]}>
              {signal.count}
            </ThemedText>
            <View style={styles.copy}>
              <ThemedText type="headline">{signal.label}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {signal.detail}
              </ThemedText>
            </View>
            <Icon name="arrow.up.right" size="sm" color="textSecondary" />
          </Pressable>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 0, paddingHorizontal: 0, overflow: 'hidden' },
  row: {
    minHeight: HitTarget + Space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
  },
  lead: { minHeight: HitTarget + Space.xxl },
  count: { minWidth: 48, flexShrink: 0 },
  copy: { flex: 1, gap: Space.half },
  divider: { height: 1, marginLeft: Space.lg, marginRight: Space.lg },
});
