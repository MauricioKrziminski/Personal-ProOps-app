import { FlatList, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useReminders, type Reminder } from '@/hooks/use-items';

function describeRecurrence(recurrence: string | null): string | null {
  if (!recurrence) return null;
  if (recurrence.includes('FREQ=DAILY')) return 'Diário';
  if (recurrence.includes('FREQ=WEEKLY')) return 'Semanal';
  if (recurrence.includes('FREQ=MONTHLY')) return 'Mensal';
  if (recurrence.includes('FREQ=YEARLY')) return 'Anual';
  return 'Recorrente';
}

function ReminderCard({ reminder, index }: { reminder: Reminder; index: number }) {
  const recurrenceLabel = describeRecurrence(reminder.recurrence);
  const next = new Date(reminder.next_run_at);

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(Math.min(index * 60, 400))}>
      <GlassCard style={styles.card}>
        <ThemedText type="smallBold">{reminder.title}</ThemedText>
        <ThemedView style={styles.meta}>
          <ThemedText type="small" themeColor="tint">
            ⏰ {next.toLocaleDateString('pt-BR')}{' '}
            {next.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </ThemedText>
          {recurrenceLabel && (
            <ThemedText type="small" themeColor="textSecondary">
              🔁 {recurrenceLabel}
            </ThemedText>
          )}
        </ThemedView>
      </GlassCard>
    </Animated.View>
  );
}

export default function RemindersScreen() {
  const { data: reminders, isLoading } = useReminders();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.heading}>
          Lembretes
        </ThemedText>

        <FlatList
          data={reminders ?? []}
          keyExtractor={(reminder) => reminder.id}
          renderItem={({ item, index }) => <ReminderCard reminder={item} index={index} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            isLoading ? null : (
              <GlassCard style={styles.empty}>
                <ThemedText style={styles.emptyEmoji}>⏰</ThemedText>
                <ThemedText type="smallBold">Nenhum lembrete ativo</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                  Manda no WhatsApp:{'\n'}“me lembra de pagar o aluguel todo dia 5”
                </ThemedText>
              </GlassCard>
            )
          }
        />
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
});
