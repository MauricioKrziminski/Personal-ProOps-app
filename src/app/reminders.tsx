import { StyleSheet, View } from 'react-native';
import { Stack, router } from 'expo-router';

import { ErrorCard } from '@/components/error-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import {
  formatDateBR,
  useDeleteReminder,
  useReminders,
  useToggleReminder,
  type Reminder,
} from '@/hooks/use-items';
import { showItemActions } from '@/lib/item-actions';
import { describeRRule } from '@/lib/rrule-text';

/**
 * Lista completa de lembretes.
 *
 * Deixou de ser aba: lembrete não é um destino, é algo que vence — o que vence hoje aparece na aba
 * **Hoje**. Esta tela é o arquivo completo, incluindo os pausados, e vive no Stack raiz.
 */
export default function RemindersScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useReminders();
  const toggle = useToggleReminder();
  const remove = useDeleteReminder();
  const toast = useToast();

  const reminders = data ?? [];
  const active = reminders.filter((r) => r.active);
  const paused = reminders.filter((r) => !r.active);

  const actions = (r: Reminder) => {
    const pauseLabel = r.active ? 'Pausar' : 'Retomar';
    const onPause = () =>
      toggle.mutate(
        { id: r.id, active: !r.active },
        {
          onSuccess: () =>
            toast({ message: r.active ? 'Lembrete pausado.' : 'Lembrete retomado.', tone: 'success' }),
          onError: () => toast({ message: 'Não deu para mudar o lembrete.', tone: 'error' }),
        }
      );
    const onDelete = () =>
      remove.mutate(r.id, {
        onSuccess: () => toast({ message: 'Lembrete apagado.', tone: 'success' }),
        onError: () => toast({ message: 'Não deu para apagar.', tone: 'error' }),
      });

    showItemActions(r.title, [
      { label: 'Editar', onPress: () => router.push(`/reminder-form?id=${r.id}`) },
      { label: pauseLabel, onPress: onPause },
      { label: 'Apagar', destructive: true, onPress: onDelete },
    ]);
  };

  const line = (r: Reminder) => (
    <Row
      key={r.id}
      title={r.title}
      subtitle={
        r.recurrence
          ? `${describeRRule(r.recurrence)} · próximo ${formatDateBR(r.next_run_at)}`
          : formatDateBR(r.next_run_at)
      }
      icon={r.active ? 'bell' : 'bell.slash'}
      accessibilityLabel={`${r.title}, ${r.active ? 'ativo' : 'pausado'}`}
      onPress={() => router.push(`/reminder-form?id=${r.id}`)}
      onLongPress={() => actions(r)}
    />
  );

  return (
    <Screen grouped onRefresh={refetch} refreshing={isRefetching}>
      <Stack.Screen
        options={{
          title: 'Lembretes',
          headerLargeTitle: true,
        }}
      />

      {isError ? <ErrorCard onRetry={refetch} /> : null}

      {isLoading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {active.length > 0 ? <Section title="Ativos">{active.map(line)}</Section> : null}
      {paused.length > 0 ? <Section title="Pausados">{paused.map(line)}</Section> : null}

      {!isLoading && !isError && reminders.length === 0 ? (
        <EmptyState
          icon="bell"
          title="Nenhum lembrete ainda"
          hint={'Manda “me lembra de pagar o aluguel dia 5”\nno WhatsApp — ou crie um aqui.'}
          action={{ label: 'Novo lembrete', onPress: () => router.push('/reminder-form') }}
        />
      ) : null}

      {reminders.length > 0 ? (
        <View style={styles.footer}>
          <Button label="Novo lembrete" icon="plus" onPress={() => router.push('/reminder-form')} block />
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            Lembrete pausado não dispara e não gasta mensagem.
          </ThemedText>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: {
    gap: Space.md,
  },
  hint: {
    textAlign: 'center',
  },
});
