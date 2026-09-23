import { StyleSheet, View } from 'react-native';
import { Stack, router } from 'expo-router';

import { ErrorCard } from '@/components/error-card';
import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { Deslizavel } from '@/components/ui/deslizavel';
import { EmptyState } from '@/components/ui/empty-state';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import {
  formatDateBR,
  useDeleteReminder,
  useReminders,
  useToggleReminder,
  type Reminder,
} from '@/hooks/use-items';
import { showItemActions, type ItemAction } from '@/lib/item-actions';
import { describeRRule } from '@/lib/rrule-text';

/**
 * Lista completa de lembretes.
 *
 * Deixou de ser aba: lembrete não é um destino, é algo que vence — o que vence hoje aparece na aba
 * **Hoje**. Esta tela é o arquivo completo, incluindo os pausados, e vive no Stack raiz.
 */
export default function RemindersScreen() {
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const { data, isLoading, isError, refetch } = useReminders();
  const toggle = useToggleReminder();
  const remove = useDeleteReminder();
  const toast = useToast();

  // `isError` e não só `data`: o TanStack guarda o resultado anterior quando o refetch
  // falha, e sem este corte a tela seguia afirmando números embaixo da faixa de erro.
  const reminders = isError ? [] : (data ?? []);
  const active = reminders.filter((r) => r.active);
  const paused = reminders.filter((r) => !r.active);

  /** O menu do lembrete, declarado UMA vez: o toque longo e o arrasto leem a mesma lista. */
  const acoesDoLembrete = (r: Reminder): ItemAction[] => {
    const alternar = (active: boolean, desfazendo = false) =>
      toggle.mutate(
        { id: r.id, active },
        {
          onSuccess: () =>
            desfazendo
              ? undefined
              : toast({
                  message: active ? 'Lembrete retomado.' : 'Lembrete pausado.',
                  tone: 'success',
                  action: { label: 'Desfazer', onPress: () => alternar(!active, true) },
                }),
          onError: () => toast({ message: 'Não deu para mudar o lembrete.', tone: 'error' }),
        },
      );
    const onDelete = () =>
      remove.mutate(r.id, {
        onSuccess: () => toast({ message: 'Lembrete apagado.', tone: 'success' }),
        onError: () => toast({ message: 'Não deu para apagar.', tone: 'error' }),
      });

    return [
      { label: 'Editar', arrasto: 'fora', onPress: () => router.push(`/reminder-form?id=${r.id}`) },
      {
        label: r.active ? 'Pausar' : 'Retomar',
        arrasto: 'direita',
        desfaz: true,
        onPress: () => alternar(!r.active),
      },
      { label: 'Apagar', destructive: true, arrasto: 'esquerda', onPress: onDelete },
    ];
  };

  const line = (r: Reminder) => (
    <Deslizavel key={r.id} titulo={r.title} acoes={acoesDoLembrete(r)}>
      <Row
        title={r.title}
        subtitle={
          r.recurrence
            ? `${describeRRule(r.recurrence)} · próximo ${formatDateBR(r.next_run_at)}`
            : formatDateBR(r.next_run_at)
        }
        icon={r.active ? 'bell' : 'bell.slash'}
        accessibilityLabel={`${r.title}, ${r.active ? 'ativo' : 'pausado'}`}
        onPress={() => router.push(`/reminder-form?id=${r.id}`)}
        onLongPress={() => showItemActions(r.title, acoesDoLembrete(r))}
      />
    </Deslizavel>
  );

  const activeSection =
    active.length > 0 ? <Section title="Ativos">{active.map(line)}</Section> : null;
  const pausedSection =
    paused.length > 0 ? (
      <View style={styles.pausedPane}>
        <Section title="Pausados">{paused.map(line)}</Section>
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          Lembrete pausado não dispara e não gasta mensagem.
        </ThemedText>
      </View>
    ) : null;
  const list = (
    <>
      {activeSection}
      {pausedSection}
    </>
  );

  return (
    <Screen grouped wide={tablet} onRefresh={refetch}>
      <Stack.Screen
        options={{
          title: 'Lembretes',
        }}
      />

      {/* Criar é `+` no header, como em Contas, Cartões, Orçamentos, Metas, Dívidas, Recorrentes
          e Regras. Aqui era um botão de bloco no CORPO, e esta era a única tela de lista do app
          sem ação nenhuma no header — mesma intenção, dois lugares diferentes. */}
      <HeaderActions
        actions={[
          { label: 'Novo lembrete', icon: 'plus', onPress: () => router.push('/reminder-form') },
        ]}
      />

      {isError ? <ErrorCard onRetry={refetch} /> : null}

      {isLoading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {tablet && activeSection && pausedSection ? (
        <AdaptivePanes
          main={activeSection}
          support={pausedSection}
          singlePaneContent={list}
          testID="reminders-tablet-workspace"
        />
      ) : (
        list
      )}

      {!isLoading && !isError && reminders.length === 0 ? (
        <EmptyState
          icon="bell"
          title="Nenhum lembrete ainda"
          hint={'Manda “me lembra de pagar o aluguel dia 5”\nno WhatsApp — ou crie um aqui.'}
          action={{ label: 'Novo lembrete', onPress: () => router.push('/reminder-form') }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pausedPane: { gap: Space.lg, minWidth: 0 },
  hint: {
    textAlign: 'center',
  },
});
