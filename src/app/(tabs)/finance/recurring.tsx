import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { formatBRL, formatDateBR } from '@/hooks/use-items';
import {
  useDeleteRecurring,
  useRecurringTransactions,
  useToggleRecurring,
  type RecurringTransaction,
} from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';
import { describeRRule } from '@/lib/rrule-text';

function RecurringCard({ item, index }: { item: RecurringTransaction; index: number }) {
  const theme = useTheme();
  const toggle = useToggleRecurring();
  const remove = useDeleteRecurring();

  const isIncome = item.kind === 'income';
  const label = item.description || item.category || (isIncome ? 'Receita' : 'Despesa');
  const failing = Boolean(item.last_error);

  const confirmDelete = () => {
    Alert.alert(
      'Apagar recorrência',
      `Apagar "${label}"? Os lançamentos já criados continuam no histórico.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Apagar',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            remove.mutate(item.id);
          },
        },
      ],
    );
  };

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(Math.min(index * 60, 400))}>
      <GlassCard style={[styles.card, !item.active && styles.paused]}>
        <Pressable onLongPress={confirmDelete}>
          <View style={styles.cardHeader}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
              {isIncome ? '🔁💰' : '🔁💸'} {label}
            </ThemedText>
            <ThemedText
              type="smallBold"
              style={{ color: isIncome ? theme.success : theme.danger }}>
              {isIncome ? '+' : '-'}
              {formatBRL(item.amount_cents)}
            </ThemedText>
          </View>

          <ThemedText type="small" themeColor="textSecondary">
            {describeRRule(item.rrule)}
            {item.category ? ` · ${item.category}` : ''}
          </ThemedText>

          <ThemedText type="small" themeColor="textSecondary">
            {item.active ? `Próximo em ${formatDateBR(item.next_run_at)}` : 'Pausado'}
          </ThemedText>
        </Pressable>

        {failing && (
          <View style={[styles.errorBox, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" themeColor="warning">
              ⚠️ Última execução falhou
              {item.run_attempts > 0 ? ` (tentativa ${item.run_attempts} de 5)` : ''}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
              {item.last_error}
            </ThemedText>
          </View>
        )}

        <Pressable
          hitSlop={8}
          disabled={toggle.isPending}
          onPress={() => {
            Haptics.selectionAsync();
            toggle.mutate({ id: item.id, active: !item.active });
          }}
          style={[styles.action, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">{item.active ? '⏸ Pausar' : '▶️ Retomar'}</ThemedText>
        </Pressable>
      </GlassCard>
    </Animated.View>
  );
}

export default function RecurringScreen() {
  const { data: items, isLoading, isError, refetch } = useRecurringTransactions();
  const list = items ?? [];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {isError && <ErrorCard onRetry={refetch} />}
          {isLoading && !isError && <LoadingCard />}

          {list.map((item, index) => (
            <RecurringCard key={item.id} item={item} index={index} />
          ))}

          {!isLoading && !isError && list.length === 0 && (
            <GlassCard style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>🔁</ThemedText>
              <ThemedText type="smallBold">Nenhum lançamento recorrente</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                Manda no WhatsApp:{'\n'}“todo dia 5 pago 1200 de aluguel”
              </ThemedText>
            </GlassCard>
          )}

          {!isLoading && !isError && list.length > 0 && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
              Segure um card para apagar. Séries são criadas pelo WhatsApp e lançadas
              automaticamente na data.
            </ThemedText>
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
    width: '100%',
  },
  scroll: {
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  card: {
    gap: Spacing.two,
  },
  paused: {
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginBottom: Spacing.one,
  },
  title: {
    flex: 1,
  },
  errorBox: {
    borderRadius: Spacing.two,
    padding: Spacing.two,
    gap: Spacing.half,
  },
  action: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    alignItems: 'center',
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
  footnote: {
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
  },
});
