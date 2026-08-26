import { router } from 'expo-router';
import { Alert, FlatList, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  formatDateBR,
  useDeleteReminder,
  useReminders,
  useToggleReminder,
  type Reminder,
} from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';
import { describeRRule } from '@/lib/rrule-text';

function ReminderCard({
  reminder,
  index,
  onToggle,
  onDelete,
}: {
  reminder: Reminder;
  index: number;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const next = new Date(reminder.next_run_at);

  const showActions = () => {
    Haptics.selectionAsync();
    Alert.alert(reminder.title, 'O que fazer com este lembrete?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: reminder.active ? 'Pausar' : 'Retomar',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onToggle();
        },
      },
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          onDelete();
        },
      },
    ]);
  };

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(Math.min(index * 60, 400))}>
      <Pressable
        onLongPress={showActions}
        onPress={() => {
          Haptics.selectionAsync();
          router.push({ pathname: '/reminder-form', params: { id: reminder.id } });
        }}>
        <GlassCard style={[styles.card, !reminder.active && styles.paused]}>
          <ThemedText type="smallBold">{reminder.title}</ThemedText>
          <ThemedView style={styles.meta}>
            <ThemedText type="small" style={{ color: reminder.active ? theme.tint : theme.textSecondary }}>
              {reminder.active
                ? `⏰ ${formatDateBR(next)} ${next.toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : '⏸ Pausado'}
            </ThemedText>
            {reminder.recurrence && (
              <ThemedText type="small" themeColor="textSecondary">
                🔁 {describeRRule(reminder.recurrence)}
              </ThemedText>
            )}
          </ThemedView>
        </GlassCard>
      </Pressable>
    </Animated.View>
  );
}

export default function RemindersScreen() {
  const theme = useTheme();
  const { data: reminders, isLoading, isError, refetch } = useReminders();
  const toggle = useToggleReminder();
  const remove = useDeleteReminder();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.heading}>
          Lembretes
        </ThemedText>

        {isError ? (
          <ErrorCard onRetry={refetch} />
        ) : (
          <FlatList
            data={reminders ?? []}
            keyExtractor={(reminder) => reminder.id}
            renderItem={({ item, index }) => (
              <ReminderCard
                reminder={item}
                index={index}
                onToggle={() => toggle.mutate({ id: item.id, active: !item.active })}
                onDelete={() => remove.mutate(item.id)}
              />
            )}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              isLoading ? (
                <LoadingCard />
              ) : (
                <GlassCard style={styles.empty}>
                  <ThemedText style={styles.emptyEmoji}>⏰</ThemedText>
                  <ThemedText type="smallBold">Nenhum lembrete ainda</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                    Toque no “+” para criar{'\n'}ou manda no WhatsApp:{'\n'}“me lembra de pagar o
                    aluguel todo dia 5”
                  </ThemedText>
                </GlassCard>
              )
            }
            ListFooterComponent={
              (reminders ?? []).length > 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.footerHint}>
                  Toque para editar. Segure para pausar ou apagar.
                </ThemedText>
              ) : null
            }
          />
        )}

        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push('/reminder-form');
          }}
          accessibilityLabel="Novo lembrete"
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
  },
  heading: {
    paddingVertical: Spacing.three,
  },
  list: {
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.six,
  },
  card: {
    gap: Spacing.two,
  },
  paused: {
    opacity: 0.6,
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
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
  footerHint: {
    textAlign: 'center',
    paddingTop: Spacing.two,
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
  },
  fabLabel: {
    color: '#fff',
    fontSize: 28,
    lineHeight: 32,
  },
});
