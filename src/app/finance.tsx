import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { formatBRL, useExpensesSummary, type CategorySummary } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';

function monthRange(): { from: string; to: string; label: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    from: iso(from),
    to: iso(to),
    label: now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  };
}

function CategoryBar({
  item,
  maxCents,
  index,
}: {
  item: CategorySummary;
  maxCents: number;
  index: number;
}) {
  const theme = useTheme();
  const ratio = maxCents > 0 ? item.total_cents / maxCents : 0;

  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(Math.min(index * 60, 400))}
      style={styles.categoryRow}>
      <View style={styles.categoryHeader}>
        <ThemedText type="smallBold">{item.category}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatBRL(item.total_cents)}
        </ThemedText>
      </View>
      <View style={[styles.barTrack, { backgroundColor: theme.backgroundElement }]}>
        <View
          style={[
            styles.barFill,
            { backgroundColor: theme.tint, width: `${Math.max(ratio * 100, 4)}%` },
          ]}
        />
      </View>
    </Animated.View>
  );
}

export default function FinanceScreen() {
  const range = useMemo(monthRange, []);
  const { data: summary, isLoading } = useExpensesSummary(range.from, range.to);

  const totalCents = (summary ?? []).reduce((sum, item) => sum + item.total_cents, 0);
  const maxCents = Math.max(...(summary ?? []).map((item) => item.total_cents), 0);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <ThemedText type="subtitle" style={styles.heading}>
            Financeiro
          </ThemedText>

          <Animated.View entering={FadeInDown.duration(400)}>
            <GlassCard style={styles.totalCard}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.totalLabel}>
                Gastos de {range.label}
              </ThemedText>
              <ThemedText type="title" style={styles.totalValue}>
                {formatBRL(totalCents)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {(summary ?? []).reduce((count, item) => count + item.expense_count, 0)} lançamentos
              </ThemedText>
            </GlassCard>
          </Animated.View>

          {(summary ?? []).length > 0 && (
            <GlassCard style={styles.categoriesCard}>
              <ThemedText type="smallBold" style={styles.categoriesTitle}>
                Por categoria
              </ThemedText>
              {(summary ?? []).map((item, index) => (
                <CategoryBar key={item.category} item={item} maxCents={maxCents} index={index} />
              ))}
            </GlassCard>
          )}

          {!isLoading && (summary ?? []).length === 0 && (
            <GlassCard style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>💸</ThemedText>
              <ThemedText type="smallBold">Nenhum gasto este mês</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                Manda no WhatsApp: “gastei 45 no mercado”{'\n'}e o app registra sozinho.
              </ThemedText>
            </GlassCard>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
  },
  scroll: {
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
  },
  heading: {
    paddingVertical: Spacing.three,
  },
  totalCard: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.four,
  },
  totalLabel: {
    textTransform: 'capitalize',
  },
  totalValue: {
    fontSize: 40,
    lineHeight: 48,
  },
  categoriesCard: {
    gap: Spacing.three,
  },
  categoriesTitle: {
    marginBottom: Spacing.one,
  },
  categoryRow: {
    gap: Spacing.one,
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  barTrack: {
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
  emptyEmoji: {
    fontSize: 40,
  },
  emptyHint: {
    textAlign: 'center',
  },
});
