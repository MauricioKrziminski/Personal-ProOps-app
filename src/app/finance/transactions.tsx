import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { Chip } from '@/components/finance/chip';
import { ScreenHeader } from '@/components/finance/screen-header';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { formatBRL, localISODate } from '@/hooks/use-items';
import { useTransactions, type Transaction, type TransactionKind } from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

const KIND_META: Record<TransactionKind, { emoji: string; sign: string }> = {
  expense: { emoji: '💸', sign: '-' },
  income: { emoji: '💰', sign: '+' },
  transfer: { emoji: '🔄', sign: '' },
};

const SOURCE_LABEL: Record<Transaction['source'], string> = {
  whatsapp: 'via WhatsApp',
  app: '',
  import: 'importado',
  recurring: 'recorrente',
};

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function TransactionRow({ tx, index, month }: { tx: Transaction; index: number; month: string }) {
  const theme = useTheme();
  const meta = KIND_META[tx.kind];
  const day = tx.occurred_at.slice(8, 10);
  const sourceLabel = SOURCE_LABEL[tx.source];

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(Math.min(index * 40, 400))}>
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push({ pathname: '/finance/transaction-form', params: { id: tx.id, month } });
        }}>
        <GlassCard style={styles.row}>
          <ThemedText style={styles.rowEmoji}>{meta.emoji}</ThemedText>
          <View style={styles.rowBody}>
            <ThemedText numberOfLines={1}>
              {tx.description || tx.category || (tx.kind === 'transfer' ? 'Transferência' : 'Sem descrição')}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              dia {day}
              {tx.category ? ` · #${tx.category}` : ''}
              {sourceLabel ? ` · ${sourceLabel}` : ''}
            </ThemedText>
          </View>
          <ThemedText
            type="smallBold"
            style={{ color: tx.kind === 'income' ? theme.success : tx.kind === 'expense' ? theme.danger : theme.textSecondary }}>
            {meta.sign}
            {formatBRL(tx.amount_cents)}
          </ThemedText>
        </GlassCard>
      </Pressable>
    </Animated.View>
  );
}

export default function TransactionsScreen() {
  const theme = useTheme();
  const [month, setMonth] = useState(() => localISODate().slice(0, 7));
  const [kind, setKind] = useState<TransactionKind | undefined>(undefined);
  const { data: transactions, isLoading, isError, refetch } = useTransactions({ month, kind });

  const totals = useMemo(() => {
    const list = transactions ?? [];
    return {
      expense: list.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amount_cents, 0),
      income: list.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount_cents, 0),
    };
  }, [transactions]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader title="Lançamentos" />

        <View style={styles.monthRow}>
          <Pressable
            hitSlop={12}
            onPress={() => {
              Haptics.selectionAsync();
              setMonth((m) => shiftMonth(m, -1));
            }}
            style={[styles.monthArrow, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">‹</ThemedText>
          </Pressable>
          <ThemedText type="smallBold" style={styles.monthLabel}>
            {monthLabel(month)}
          </ThemedText>
          <Pressable
            hitSlop={12}
            onPress={() => {
              Haptics.selectionAsync();
              setMonth((m) => shiftMonth(m, 1));
            }}
            style={[styles.monthArrow, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">›</ThemedText>
          </Pressable>
        </View>

        <View style={styles.filterRow}>
          <Chip label="Tudo" selected={!kind} onPress={() => setKind(undefined)} />
          <Chip label="💸 Gastos" selected={kind === 'expense'} onPress={() => setKind('expense')} />
          <Chip label="💰 Receitas" selected={kind === 'income'} onPress={() => setKind('income')} />
          <Chip label="🔄 Transfer." selected={kind === 'transfer'} onPress={() => setKind('transfer')} />
        </View>

        {isError ? (
          <ErrorCard onRetry={refetch} />
        ) : (
          <FlatList
            data={transactions ?? []}
            keyExtractor={(tx) => tx.id}
            renderItem={({ item, index }) => <TransactionRow tx={item} index={index} month={month} />}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              (transactions ?? []).length > 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.totals}>
                  💰 {formatBRL(totals.income)} · 💸 {formatBRL(totals.expense)}
                </ThemedText>
              ) : null
            }
            ListEmptyComponent={
              isLoading ? (
                <LoadingCard />
              ) : (
                <GlassCard style={styles.empty}>
                  <ThemedText style={styles.emptyEmoji}>🧾</ThemedText>
                  <ThemedText type="smallBold">Nada em {monthLabel(month)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                    Adicione pelo “+” ou manda no WhatsApp:{'\n'}“gastei 45 no mercado”
                  </ThemedText>
                </GlassCard>
              )
            }
          />
        )}

        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push({ pathname: '/finance/transaction-form', params: { month } });
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
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.three,
  },
  monthArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: {
    textTransform: 'capitalize',
    fontSize: 16,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingBottom: Spacing.three,
  },
  totals: {
    textAlign: 'center',
    paddingBottom: Spacing.one,
  },
  list: {
    gap: Spacing.two,
    paddingBottom: Spacing.six,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  rowEmoji: {
    fontSize: 22,
  },
  rowBody: {
    flex: 1,
    gap: Spacing.half,
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
    bottom: Spacing.five,
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
