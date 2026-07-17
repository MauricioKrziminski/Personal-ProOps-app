import { router, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { formatBRL, localISODate } from '@/hooks/use-items';
import {
  useAccountBalances,
  useBudgetsStatus,
  useGoals,
  useMonthlyCashflow,
  useRecentTransactions,
  useTransactionsSummary,
} from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

function monthRange(): { from: string; to: string; label: string } {
  const now = new Date();
  return {
    from: localISODate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: localISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    label: now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
  };
}

function SectionLink({ title, href, index }: { title: string; href: Href; index: number }) {
  return (
    <Animated.View entering={FadeInDown.duration(400).delay(Math.min(index * 60, 400))}>
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push(href);
        }}>
        <GlassCard style={styles.linkCard}>
          <ThemedText type="smallBold">{title}</ThemedText>
          <ThemedText type="smallBold" themeColor="textSecondary">
            ›
          </ThemedText>
        </GlassCard>
      </Pressable>
    </Animated.View>
  );
}

/** Barras pareadas receita x gasto por mês (Views puras — consistente com o resto do app). */
function CashflowChart() {
  const theme = useTheme();
  const { data: cashflow } = useMonthlyCashflow(6);
  const rows = cashflow ?? [];
  if (rows.length === 0) return null;

  const max = Math.max(...rows.flatMap((r) => [Number(r.income_cents), Number(r.expense_cents)]), 1);

  return (
    <GlassCard style={styles.sectionCard}>
      <ThemedText type="smallBold">Receitas x Gastos</ThemedText>
      <View style={styles.chartRow}>
        {rows.map((row) => {
          const monthLabel = new Date(`${row.month}T12:00:00`).toLocaleDateString('pt-BR', {
            month: 'short',
          });
          return (
            <View key={row.month} style={styles.chartColumn}>
              <View style={styles.chartBars}>
                <View
                  style={[
                    styles.chartBar,
                    {
                      backgroundColor: theme.success,
                      height: `${Math.max((Number(row.income_cents) / max) * 100, 2)}%`,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.chartBar,
                    {
                      backgroundColor: theme.danger,
                      height: `${Math.max((Number(row.expense_cents) / max) * 100, 2)}%`,
                    },
                  ]}
                />
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.chartLabel}>
                {monthLabel.replace('.', '')}
              </ThemedText>
            </View>
          );
        })}
      </View>
      <View style={styles.legend}>
        <View style={[styles.legendDot, { backgroundColor: theme.success }]} />
        <ThemedText type="small" themeColor="textSecondary">
          receitas
        </ThemedText>
        <View style={[styles.legendDot, { backgroundColor: theme.danger }]} />
        <ThemedText type="small" themeColor="textSecondary">
          gastos
        </ThemedText>
      </View>
    </GlassCard>
  );
}

export default function FinanceScreen() {
  const theme = useTheme();
  const range = useMemo(() => monthRange(), []);
  const balances = useAccountBalances();
  const summary = useTransactionsSummary(range.from, range.to);
  const budgets = useBudgetsStatus();
  const goals = useGoals();
  const recent = useRecentTransactions(5);

  const totalBalance = (balances.data ?? []).reduce((s, b) => s + Number(b.balance_cents), 0);
  const monthExpenses = (summary.data ?? [])
    .filter((r) => r.kind === 'expense')
    .reduce((s, r) => s + Number(r.total_cents), 0);
  const monthIncome = (summary.data ?? [])
    .filter((r) => r.kind === 'income')
    .reduce((s, r) => s + Number(r.total_cents), 0);
  const expenseRows = (summary.data ?? []).filter((r) => r.kind === 'expense');
  const maxCategory = Math.max(...expenseRows.map((r) => Number(r.total_cents)), 0);
  const riskyBudgets = (budgets.data ?? []).filter(
    (b) => Number(b.spent_cents) / Number(b.limit_cents) >= 0.8,
  );

  const hasError =
    balances.isError || summary.isError || budgets.isError || goals.isError || recent.isError;
  const isLoading = balances.isLoading || summary.isLoading;
  const isEmpty =
    !isLoading &&
    totalBalance === 0 &&
    (summary.data ?? []).length === 0 &&
    (recent.data ?? []).length === 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <ThemedText type="subtitle" style={styles.heading}>
            Financeiro
          </ThemedText>

          {hasError ? (
            <ErrorCard
              onRetry={() => {
                balances.refetch();
                summary.refetch();
                budgets.refetch();
                goals.refetch();
                recent.refetch();
              }}
            />
          ) : isLoading ? (
            <LoadingCard />
          ) : (
            <>
              <Animated.View entering={FadeInDown.duration(400)}>
                <GlassCard style={styles.totalCard}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Saldo total
                  </ThemedText>
                  <ThemedText type="title" style={styles.totalValue}>
                    {formatBRL(totalBalance)}
                  </ThemedText>
                  <View style={styles.monthSummary}>
                    <ThemedText type="small" style={{ color: theme.success }}>
                      ↑ {formatBRL(monthIncome)}
                    </ThemedText>
                    <ThemedText type="small" style={{ color: theme.danger }}>
                      ↓ {formatBRL(monthExpenses)}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.monthLabel}>
                      {range.label}
                    </ThemedText>
                  </View>
                </GlassCard>
              </Animated.View>

              <CashflowChart />

              {expenseRows.length > 0 && (
                <GlassCard style={styles.sectionCard}>
                  <ThemedText type="smallBold">Gastos por categoria</ThemedText>
                  {expenseRows.map((row) => (
                    <View key={row.category} style={styles.categoryRow}>
                      <View style={styles.categoryHeader}>
                        <ThemedText type="smallBold">{row.category}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {formatBRL(Number(row.total_cents))}
                        </ThemedText>
                      </View>
                      <View style={[styles.barTrack, { backgroundColor: theme.backgroundElement }]}>
                        <View
                          style={[
                            styles.barFill,
                            {
                              backgroundColor: theme.tint,
                              width: `${Math.max((Number(row.total_cents) / maxCategory) * 100, 4)}%`,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  ))}
                </GlassCard>
              )}

              {riskyBudgets.length > 0 && (
                <GlassCard style={styles.sectionCard}>
                  <ThemedText type="smallBold">⚠️ Orçamentos no limite</ThemedText>
                  {riskyBudgets.map((b) => {
                    const pct = Math.round((Number(b.spent_cents) / Number(b.limit_cents)) * 100);
                    return (
                      <View key={b.category} style={styles.categoryHeader}>
                        <ThemedText type="small">
                          {pct >= 100 ? '🔴' : '🟡'} {b.category}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {pct}% de {formatBRL(Number(b.limit_cents))}
                        </ThemedText>
                      </View>
                    );
                  })}
                </GlassCard>
              )}

              {(goals.data ?? []).length > 0 && (
                <GlassCard style={styles.sectionCard}>
                  <ThemedText type="smallBold">Metas</ThemedText>
                  {(goals.data ?? []).slice(0, 3).map((goal) => {
                    const pct = Math.min(
                      100,
                      Math.round((goal.saved_cents / goal.target_cents) * 100),
                    );
                    return (
                      <View key={goal.id} style={styles.categoryRow}>
                        <View style={styles.categoryHeader}>
                          <ThemedText type="small">🎯 {goal.name}</ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            {pct}%
                          </ThemedText>
                        </View>
                        <View style={[styles.barTrack, { backgroundColor: theme.backgroundElement }]}>
                          <View
                            style={[
                              styles.barFill,
                              {
                                backgroundColor: pct >= 100 ? theme.success : theme.tint,
                                width: `${Math.max(pct, 3)}%`,
                              },
                            ]}
                          />
                        </View>
                      </View>
                    );
                  })}
                </GlassCard>
              )}

              {(recent.data ?? []).length > 0 && (
                <GlassCard style={styles.sectionCard}>
                  <ThemedText type="smallBold">Últimos lançamentos</ThemedText>
                  {(recent.data ?? []).map((tx) => (
                    <View key={tx.id} style={styles.categoryHeader}>
                      <ThemedText type="small" numberOfLines={1} style={styles.recentLabel}>
                        {tx.kind === 'income' ? '💰' : tx.kind === 'transfer' ? '🔄' : '💸'}{' '}
                        {tx.description || tx.category || 'Sem descrição'}
                      </ThemedText>
                      <ThemedText
                        type="small"
                        style={{
                          color:
                            tx.kind === 'income'
                              ? theme.success
                              : tx.kind === 'expense'
                                ? theme.danger
                                : theme.textSecondary,
                        }}>
                        {tx.kind === 'income' ? '+' : tx.kind === 'expense' ? '-' : ''}
                        {formatBRL(tx.amount_cents)}
                      </ThemedText>
                    </View>
                  ))}
                </GlassCard>
              )}

              {isEmpty && (
                <GlassCard style={styles.empty}>
                  <ThemedText style={styles.emptyEmoji}>💸</ThemedText>
                  <ThemedText type="smallBold">Seu financeiro começa aqui</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                    Manda no WhatsApp: “gastei 45 no mercado”{'\n'}ou toque no “+” para lançar por
                    aqui.
                  </ThemedText>
                </GlassCard>
              )}

              <SectionLink title="🧾 Todos os lançamentos" href="/finance/transactions" index={0} />
              <SectionLink title="💼 Contas e carteiras" href="/finance/accounts" index={1} />
              <SectionLink title="🎯 Metas" href="/finance/goals" index={2} />
              <SectionLink title="📉 Orçamentos" href="/finance/budgets" index={3} />
            </>
          )}
        </ScrollView>

        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push('/finance/transaction-form');
          }}
          accessibilityLabel="Novo lançamento"
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
          ]}>
          <ThemedText style={styles.fabLabel}>＋</ThemedText>
        </Pressable>
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
    width: '100%',
  },
  scroll: {
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.six,
  },
  heading: {
    paddingVertical: Spacing.three,
  },
  totalCard: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.four,
  },
  totalValue: {
    fontSize: 40,
    lineHeight: 48,
  },
  monthSummary: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
  },
  monthLabel: {
    textTransform: 'capitalize',
  },
  sectionCard: {
    gap: Spacing.three,
  },
  chartRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
    height: 120,
  },
  chartColumn: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.one,
  },
  chartBars: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  chartBar: {
    width: 10,
    borderRadius: 5,
  },
  chartLabel: {
    fontSize: 11,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    justifyContent: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  categoryRow: {
    gap: Spacing.one,
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  recentLabel: {
    flex: 1,
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
  linkCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.three,
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
  fab: {
    position: 'absolute',
    right: Spacing.four,
    bottom: BottomTabInset + Spacing.three,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabLabel: {
    color: '#fff',
    fontSize: 26,
    lineHeight: 30,
  },
});
