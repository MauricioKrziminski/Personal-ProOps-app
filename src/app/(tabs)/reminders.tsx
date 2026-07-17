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
  usePauseReminder,
  useReminders,
  type Reminder,
} from '@/hooks/use-items';

function describeRecurrence(recurrence: string | null): string | null {
  if (!recurrence) return null;
  if (recurrence.includes('FREQ=DAILY')) return 'Diário';
  if (recurrence.includes('FREQ=WEEKLY')) return 'Semanal';
  if (recurrence.includes('FREQ=MONTHLY')) return 'Mensal';
  if (recurrence.includes('FREQ=YEARLY')) return 'Anual';
  return 'Recorrente';
}

function ReminderCard({
  reminder,
  index,
  onPause,
  onDelete,
}: {
  reminder: Reminder;
  index: number;
  onPause: () => void;
  onDelete: () => void;
}) {
  const recurrenceLabel = describeRecurrence(reminder.recurrence);
  const next = new Date(reminder.next_run_at);

  const showActions = () => {
    Haptics.selectionAsync();
    Alert.alert(reminder.title, 'O que fazer com este lembrete?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Pausar',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onPause();
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
      <Pressable onLongPress={showActions}>
        <GlassCard style={styles.card}>
          <ThemedText type="smallBold">{reminder.title}</ThemedText>
          <ThemedView style={styles.meta}>
            <ThemedText type="small" themeColor="tint">
              ⏰ {formatDateBR(next)}{' '}
              {next.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </ThemedText>
            {recurrenceLabel && (
              <ThemedText type="small" themeColor="textSecondary">
                🔁 {recurrenceLabel}
              </ThemedText>
            )}
          </ThemedView>
        </GlassCard>
      </Pressable>
    </Animated.View>
  );
}

export default function RemindersScreen() {
  const { data: reminders, isLoading, isError, refetch } = useReminders();
  const pause = usePauseReminder();
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
                onPause={() => pause.mutate(item.id)}
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
                  <ThemedText type="smallBold">Nenhum lembrete ativo</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                    Manda no WhatsApp:{'\n'}“me lembra de pagar o aluguel todo dia 5”
                  </ThemedText>
                </GlassCard>
              )
            }
            ListFooterComponent={
              (reminders ?? []).length > 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.footerHint}>
                  Toque e segure um lembrete para pausar ou apagar.
                </ThemedText>
              ) : null
            }
          />
        )}
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
    paddingBottom: BottomTabInset + Spacing.three,
  },
  card: {
    gap: Spacing.two,
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
});
