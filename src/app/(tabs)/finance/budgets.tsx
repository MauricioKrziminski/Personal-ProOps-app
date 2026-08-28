import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { Chip } from '@/components/finance/chip';
import { MoneyInput } from '@/components/finance/money-input';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { formatBRL, localISODate } from '@/hooks/use-items';
import {
  INCOME_CATEGORIES,
  SUGGESTED_CATEGORIES,
  useBudgets,
  useBudgetsStatus,
  useDeleteBudget,
  useSaveBudget,
} from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

/** 'YYYY-MM' + n meses. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

export default function BudgetsScreen() {
  const theme = useTheme();
  const [month, setMonth] = useState(() => localISODate().slice(0, 7));
  const [rollover, setRollover] = useState(false);
  // limite só deste mês vs limite padrão que vale para todos
  const [soEsteMes, setSoEsteMes] = useState(false);
  const { data: status, isLoading, isError, refetch } = useBudgetsStatus(month);
  const { data: budgets } = useBudgets();
  const save = useSaveBudget();
  const remove = useDeleteBudget();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [limitCents, setLimitCents] = useState(0);

  const showForm = creating || editing !== null;

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setCategory(null);
    setLimitCents(0);
    setRollover(false);
    setSoEsteMes(false);
  };

  /** Editar é o mesmo upsert: a identidade do orçamento é (workspace_id, category). */
  const startEdit = (cat: string, limit: number) => {
    Haptics.selectionAsync();
    const atual = (status ?? []).find((b) => b.category === cat);
    setCreating(false);
    setEditing(cat);
    setCategory(cat);
    // edita o limite BASE, não o efetivo (que já inclui o rollover)
    setLimitCents(Number(atual?.base_limit_cents ?? limit));
    setRollover(Boolean(atual?.rollover));
    setSoEsteMes(Boolean(atual?.month));
  };

  const onSubmit = () => {
    if (!category || limitCents <= 0) return;
    save.mutate(
      { category, limit_cents: limitCents, rollover, month: soEsteMes ? month : null },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          closeForm();
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

          {isError && <ErrorCard onRetry={refetch} />}
          {isLoading && !isError && <LoadingCard />}

          {(status ?? []).map((item, index) => {
            const pct = Math.round((item.spent_cents / item.limit_cents) * 100);
            const color = pct >= 100 ? theme.danger : pct >= 80 ? theme.warning : theme.success;
            return (
              <Animated.View
                key={item.category}
                entering={FadeInDown.duration(400).delay(Math.min(index * 60, 400))}>
                <Pressable
                  onLongPress={() => confirmDelete(item.category)}
                  onPress={() => startEdit(item.category, Number(item.limit_cents))}>
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
                      {formatBRL(item.spent_cents)} de {formatBRL(item.limit_cents)}
                      {Number(item.rollover_cents) > 0
                        ? ` (${formatBRL(Number(item.base_limit_cents))} + ${formatBRL(Number(item.rollover_cents))} que sobrou)`
                        : ''}
                      {item.month ? ' · só este mês' : ''}
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

          {showForm ? (
            <GlassCard style={styles.form}>
              <ThemedText type="smallBold">
                {editing ? `Editando limite de “${editing}”` : 'Novo orçamento'}
              </ThemedText>
              <ThemedText type="smallBold">Categoria</ThemedText>
              <View style={styles.chipRow}>
                {SUGGESTED_CATEGORIES.filter((c) => !INCOME_CATEGORIES.includes(c)).map((cat) => (
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
              <View style={styles.chipRow}>
                <Chip
                  label="↩︎ Acumula sobra"
                  selected={rollover}
                  onPress={() => setRollover((v) => !v)}
                />
                <Chip
                  label="📅 Só este mês"
                  selected={soEsteMes}
                  onPress={() => setSoEsteMes((v) => !v)}
                />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {rollover
                  ? 'O que sobrar do mês anterior soma neste limite.'
                  : 'Sem acúmulo: cada mês começa do zero.'}
              </ThemedText>
              <Pressable
                onPress={onSubmit}
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
              <Pressable onPress={closeForm} hitSlop={8} style={styles.cancel}>
                <ThemedText type="small" themeColor="textSecondary">
                  Cancelar
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
            Toque num orçamento para mudar o limite. Segure para remover.
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
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  monthArrow: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  monthLabel: {
    flex: 1,
    textAlign: 'center',
    textTransform: 'capitalize',
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
  cancel: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
});
