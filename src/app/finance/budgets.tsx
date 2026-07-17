import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { Chip } from '@/components/finance/chip';
import { MoneyInput } from '@/components/finance/money-input';
import { ScreenHeader } from '@/components/finance/screen-header';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { formatBRL } from '@/hooks/use-items';
import {
  SUGGESTED_CATEGORIES,
  useBudgets,
  useBudgetsStatus,
  useDeleteBudget,
  useSaveBudget,
} from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

export default function BudgetsScreen() {
  const theme = useTheme();
  const { data: status, isLoading, isError, refetch } = useBudgetsStatus();
  const { data: budgets } = useBudgets();
  const save = useSaveBudget();
  const remove = useDeleteBudget();
  const [creating, setCreating] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [limitCents, setLimitCents] = useState(0);

  const onCreate = () => {
    if (!category || limitCents <= 0) return;
    save.mutate(
      { category, limit_cents: limitCents },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setCreating(false);
          setCategory(null);
          setLimitCents(0);
        },
      },
    );
  };

  const confirmDelete = (cat: string) => {
    const budget = (budgets ?? []).find((b) => b.category === cat);
    if (!budget) return;
    Alert.alert('Remover orçamento', `Remover o limite de "${cat}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          remove.mutate(budget.id);
        },
      },
    ]);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Orçamentos" />

          {isError && <ErrorCard onRetry={refetch} />}
          {isLoading && !isError && <LoadingCard />}

          {(status ?? []).map((item, index) => {
            const pct = Math.round((item.spent_cents / item.limit_cents) * 100);
            const color = pct >= 100 ? theme.danger : pct >= 80 ? theme.warning : theme.success;
            return (
              <Animated.View
                key={item.category}
                entering={FadeInDown.duration(400).delay(Math.min(index * 60, 400))}>
                <Pressable onLongPress={() => confirmDelete(item.category)}>
                  <GlassCard style={styles.budgetCard}>
                    <View style={styles.budgetHeader}>
                      <ThemedText type="smallBold">{item.category}</ThemedText>
                      <ThemedText type="small" style={{ color }}>
                        {pct}%
                      </ThemedText>
                    </View>
                    <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
                      <View
                        style={[
                          styles.fill,
                          { backgroundColor: color, width: `${Math.min(Math.max(pct, 3), 100)}%` },
                        ]}
                      />
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatBRL(item.spent_cents)} de {formatBRL(item.limit_cents)} este mês
                    </ThemedText>
                  </GlassCard>
                </Pressable>
              </Animated.View>
            );
          })}

          {!isLoading && !isError && (status ?? []).length === 0 && (
            <GlassCard style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>📉</ThemedText>
              <ThemedText type="smallBold">Nenhum orçamento definido</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                Defina um limite mensal por categoria{'\n'}e acompanhe quanto já foi.
              </ThemedText>
            </GlassCard>
          )}

          {creating ? (
            <GlassCard style={styles.form}>
              <ThemedText type="smallBold">Categoria</ThemedText>
              <View style={styles.chipRow}>
                {SUGGESTED_CATEGORIES.filter((c) => c !== 'salário' && c !== 'freela').map((cat) => (
                  <Chip
                    key={cat}
                    label={cat}
                    selected={category === cat}
                    onPress={() => setCategory(category === cat ? null : cat)}
                  />
                ))}
              </View>
              <ThemedText type="smallBold">Limite mensal</ThemedText>
              <MoneyInput valueCents={limitCents} onChangeCents={setLimitCents} />
              <Pressable
                onPress={onCreate}
                disabled={save.isPending || !category || limitCents <= 0}
                style={({ pressed }) => [
                  styles.submit,
                  {
                    backgroundColor: theme.tint,
                    opacity: pressed || save.isPending || !category || limitCents <= 0 ? 0.6 : 1,
                  },
                ]}>
                <ThemedText type="smallBold" style={styles.buttonLabel}>
                  {save.isPending ? 'Salvando…' : 'Salvar orçamento'}
                </ThemedText>
              </Pressable>
              {save.isError && (
                <ThemedText type="small" themeColor="danger" style={styles.centered}>
                  Não deu para salvar. Tenta de novo.
                </ThemedText>
              )}
            </GlassCard>
          ) : (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setCreating(true);
              }}
              style={({ pressed }) => [
                styles.submit,
                { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.buttonLabel}>
                ＋ Novo orçamento
              </ThemedText>
            </Pressable>
          )}

          <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
            Toque e segure um orçamento para removê-lo.
          </ThemedText>
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
    width: '100%',
  },
  scroll: {
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  budgetCard: {
    gap: Spacing.one,
  },
  budgetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  track: {
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 5,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  form: {
    gap: Spacing.three,
  },
  submit: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  buttonLabel: {
    color: '#fff',
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
  centered: {
    textAlign: 'center',
  },
});
