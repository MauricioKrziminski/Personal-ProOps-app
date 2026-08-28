import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { Chip } from '@/components/finance/chip';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useReminders, useSaveReminder, type Reminder } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';
import { isValidBRDate, isValidTime, isoToBR, localDateTime, localISODate, timeBR } from '@/lib/dates';

/**
 * Data e hora por texto + chips, sem `datetimepicker` — mesma abordagem do form de
 * transação. Evita dependência nativa (que exigiria rebuild) e mantém as duas telas
 * com a mesma cara.
 */

const RECURRENCES: { label: string; value: string | null }[] = [
  { label: 'Não repete', value: null },
  { label: 'Todo dia', value: 'FREQ=DAILY' },
  { label: 'Toda semana', value: 'FREQ=WEEKLY' },
  { label: 'Todo mês', value: 'FREQ=MONTHLY' },
  { label: 'Todo ano', value: 'FREQ=YEARLY' },
];

const CHANNELS: { label: string; value: Reminder['channel'] }[] = [
  { label: '🔔 Push', value: 'push' },
  { label: '💬 WhatsApp', value: 'whatsapp' },
  { label: 'Os dois', value: 'both' },
];

const HOURS = ['08:00', '09:00', '12:00', '18:00', '21:00'];

const deviceTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  } catch {
    return 'America/Sao_Paulo';
  }
};

export default function ReminderFormScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const { data: reminders } = useReminders();
  const editing = params.id ? reminders?.find((r) => r.id === params.id) : undefined;
  const save = useSaveReminder();

  // Estado inicial calculado uma vez: ler o relógio a cada render é impuro.
  const [initial] = useState(() => {
    const base = editing ? new Date(editing.next_run_at) : new Date(Date.now() + 60 * 60 * 1000);
    return {
      title: editing?.title ?? '',
      date: isoToBR(localISODate(base)),
      time: timeBR(base),
      recurrence: editing?.recurrence ?? null,
      channel: editing?.channel ?? ('both' as Reminder['channel']),
      today: isoToBR(localISODate()),
      tomorrow: isoToBR(localISODate(new Date(Date.now() + 24 * 60 * 60 * 1000))),
      openedAt: Date.now(),
    };
  });

  const [title, setTitle] = useState(initial.title);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [recurrence, setRecurrence] = useState<string | null>(initial.recurrence);
  const [channel, setChannel] = useState<Reminder['channel']>(initial.channel);

  const when = localDateTime(date, time);
  const dateError = date.length > 0 && !isValidBRDate(date) ? 'Data em dd/mm/aaaa' : null;
  const timeError = time.length > 0 && !isValidTime(time) ? 'Hora em HH:MM' : null;
  // compara com o momento em que o modal abriu — ler o relógio no render é impuro
  const isPast = when !== null && when.getTime() < initial.openedAt;
  const canSave = title.trim().length > 0 && when !== null && !save.isPending;

  const onSubmit = () => {
    if (!canSave || !when) return;
    save.mutate(
      {
        id: editing?.id,
        title: title.trim(),
        recurrence,
        next_run_at: when.toISOString(),
        channel,
        timezone: deviceTimezone(),
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        },
      },
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: editing ? 'Editar lembrete' : 'Novo lembrete' }} />

            <GlassCard style={styles.card}>
              <ThemedText type="smallBold">O que lembrar</ThemedText>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Ex.: pagar o aluguel"
                placeholderTextColor={theme.textSecondary}
                autoFocus={!editing}
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              />
            </GlassCard>

            <GlassCard style={styles.card}>
              <ThemedText type="smallBold">Quando</ThemedText>
              <View style={styles.chipRow}>
                <Chip
                  label="Hoje"
                  selected={date === initial.today}
                  onPress={() => setDate(initial.today)}
                />
                <Chip
                  label="Amanhã"
                  selected={date === initial.tomorrow}
                  onPress={() => setDate(initial.tomorrow)}
                />
                <TextInput
                  value={date}
                  onChangeText={setDate}
                  placeholder="dd/mm/aaaa"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
                  maxLength={10}
                  style={[styles.dateInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
                />
              </View>
              {dateError && (
                <ThemedText type="small" themeColor="danger">
                  {dateError}
                </ThemedText>
              )}

              <View style={styles.chipRow}>
                {HOURS.map((h) => (
                  <Chip key={h} label={h} selected={time === h} onPress={() => setTime(h)} />
                ))}
                <TextInput
                  value={time}
                  onChangeText={setTime}
                  placeholder="HH:MM"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
                  maxLength={5}
                  style={[styles.timeInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
                />
              </View>
              {timeError && (
                <ThemedText type="small" themeColor="danger">
                  {timeError}
                </ThemedText>
              )}
              {isPast && !dateError && !timeError && (
                <ThemedText type="small" themeColor="warning">
                  ⚠️ Esse horário já passou — o lembrete dispara no próximo minuto.
                </ThemedText>
              )}
            </GlassCard>

            <GlassCard style={styles.card}>
              <ThemedText type="smallBold">Repetir</ThemedText>
              <View style={styles.chipRow}>
                {RECURRENCES.map((r) => (
                  <Chip
                    key={r.label}
                    label={r.label}
                    selected={recurrence === r.value}
                    onPress={() => setRecurrence(r.value)}
                  />
                ))}
              </View>
              {recurrence && (
                <ThemedText type="small" themeColor="textSecondary">
                  A repetição usa a data e a hora escolhidas como ponto de partida.
                </ThemedText>
              )}
            </GlassCard>

            <GlassCard style={styles.card}>
              <ThemedText type="smallBold">Onde avisar</ThemedText>
              <View style={styles.chipRow}>
                {CHANNELS.map((c) => (
                  <Chip
                    key={c.value}
                    label={c.label}
                    selected={channel === c.value}
                    onPress={() => setChannel(c.value)}
                  />
                ))}
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                Push é grátis; WhatsApp usa um template pago.
              </ThemedText>
            </GlassCard>

            <Pressable
              onPress={onSubmit}
              disabled={!canSave}
              style={({ pressed }) => [
                styles.submit,
                { backgroundColor: theme.tint, opacity: pressed || !canSave ? 0.6 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.submitLabel}>
                {save.isPending ? 'Salvando…' : editing ? 'Salvar' : 'Criar lembrete'}
              </ThemedText>
            </Pressable>

            {save.isError && (
              <ThemedText type="small" themeColor="danger" style={styles.centered}>
                Não deu para salvar. Tenta de novo.
              </ThemedText>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
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
  flex: {
    flex: 1,
  },
  scroll: {
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  card: {
    gap: Spacing.two,
  },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    alignItems: 'center',
  },
  dateInput: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
    minWidth: 128,
  },
  timeInput: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
    minWidth: 84,
  },
  submit: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  submitLabel: {
    color: '#fff',
  },
  centered: {
    textAlign: 'center',
  },
});
