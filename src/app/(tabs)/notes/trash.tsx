import { Stack, router } from 'expo-router';
import { useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Space } from '@/design/tokens';
import { usePurgeNote, useRestoreNote, useNotesList, type Note } from '@/hooks/use-notes';
import { noteTitle, notePreview } from '@/lib/search';
import { showItemActions } from '@/lib/item-actions';

/**
 * Lixeira.
 *
 * Tela de baixa frequência e alta importância: quem abre está com um problema. O tom é de calma —
 * diz quanto tempo resta e restaura **sem perguntar nada**, porque pedir confirmação para desfazer
 * um erro é ruído. Só o irreversível (apagar de vez, esvaziar) passa por action sheet.
 *
 * A tela NÃO esconde item vencido: se está na lista, dá para restaurar. Mostrar uma data e depois
 * não restaurar seria pior do que não mostrar data nenhuma.
 */
const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

function daysLeft(deletedAt: string | null): number {
  if (!deletedAt) return RETENTION_DAYS;
  const purgeAt = new Date(deletedAt).getTime() + RETENTION_DAYS * DAY_MS;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / DAY_MS));
}

function deadlineLabel(note: Note): string {
  const days = daysLeft(note.deleted_at);
  if (days === 0) return 'apaga hoje';
  if (days === 1) return 'apaga amanhã';
  return `apaga em ${days} dias`;
}

function notesLabel(count: number): string {
  return `${count} nota${count === 1 ? '' : 's'}`;
}

/**
 * Delega para o helper único do projeto (`src/lib/item-actions.ts`).
 *
 * A cópia local caía na armadilha do `Alert` do Android, que renderiza no máximo 3 botões e some
 * com o resto — inclusive a ação destrutiva. O helper compartilhado usa um sheet próprio no
 * Android, sem limite de opções.
 */
function actionSheet(
  config: { title?: string; message?: string; options: string[]; destructiveIndex?: number },
  onPick: (index: number) => void
) {
  const { title, message, options, destructiveIndex } = config;
  showItemActions(
    title ?? '',
    options.map((label, index) => ({
      label,
      destructive: index === destructiveIndex,
      onPress: () => onPick(index),
    })),
    message
  );
}

export default function TrashScreen() {
  const toast = useToast();
  const list = useNotesList({ trash: true });
  const restore = useRestoreNote();
  const purge = usePurgeNote();

  // A query ordena por `pinned, updated_at` (é a mesma da lista); aqui o que importa é o que acabou
  // de ser apagado. Ordenar no cliente é ordenar só o que já foi paginado — a lixeira é pequena por
  // definição, e lixeira grande é sintoma, não caso de uso.
  const notes = useMemo(() => {
    const all = (list.data?.pages ?? []).flat();
    return [...all].sort((a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? ''));
  }, [list.data]);

  const onRestore = (note: Note) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    restore.mutate(note.id, {
      onSuccess: () => toast({ message: 'Nota restaurada', tone: 'success' }),
      onError: () => toast({ message: 'Não deu para restaurar a nota.', tone: 'error' }),
    });
  };

  const confirmPurge = (note: Note) => {
    actionSheet(
      {
        title: noteTitle(note.content) || 'Esta nota',
        message: 'Isso não tem volta.',
        options: ['Apagar de vez'],
        destructiveIndex: 0,
      },
      () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        purge.mutate([note.id], {
          onError: () => toast({ message: 'Não deu para apagar a nota.', tone: 'error' }),
        });
      }
    );
  };

  const showActions = (note: Note) => {
    Haptics.selectionAsync();
    actionSheet(
      {
        title: noteTitle(note.content) || 'Nota',
        options: ['Ver conteúdo', 'Apagar de vez'],
        destructiveIndex: 1,
      },
      (index) => {
        if (index === 0) router.push(`/notes/${note.id}`);
        if (index === 1) confirmPurge(note);
      }
    );
  };

  const confirmEmpty = () => {
    // ponytail: esvazia o que já foi paginado. Com mais de uma página o usuário toca de novo —
    // um loop de fetchNextPage só para apagar tudo de uma vez não paga o custo.
    const ids = notes.map((n) => n.id);
    actionSheet(
      {
        title: `Apagar ${notesLabel(ids.length)} de vez?`,
        message: 'Isso não tem volta.',
        options: [`Apagar ${notesLabel(ids.length)}`],
        destructiveIndex: 0,
      },
      () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        purge.mutate(ids, {
          onError: () => toast({ message: 'Não deu para esvaziar a lixeira.', tone: 'error' }),
        });
      }
    );
  };

  return (
    <Screen grouped>
      <Stack.Screen
        options={{
          title: 'Lixeira',
          headerRight: () =>
            notes.length === 0 ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Esvaziar lixeira, ${notesLabel(notes.length)}`}
                hitSlop={12}
                onPress={confirmEmpty}>
                <ThemedText type="smallBold" themeColor="danger">
                  Esvaziar
                </ThemedText>
              </Pressable>
            ),
        }}
      />

      {/* Antes da lista: a pessoa precisa saber o prazo ANTES de decidir se corre. */}
      <ThemedText type="small" themeColor="textSecondary">
        Notas na lixeira são apagadas de vez depois de 30 dias.
      </ThemedText>

      {list.isError ? (
        <Card>
          <View style={styles.errorCard}>
            <Icon name="exclamationmark.triangle" size="xl" color="danger" />
            <ThemedText type="smallBold">Não deu para abrir a lixeira</ThemedText>
            <Button
              label="Tentar de novo"
              variant="secondary"
              size="sm"
              onPress={() => list.refetch()}
            />
          </View>
        </Card>
      ) : list.isLoading ? (
        <Section>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </Section>
      ) : notes.length === 0 ? (
        <EmptyState
          icon="trash"
          title="Lixeira vazia"
          hint="Nada apagado nos últimos 30 dias."
        />
      ) : (
        <Section>
          {notes.map((note, index) => (
            <Animated.View
              key={note.id}
              layout={LinearTransition.duration(Motion.duration.base)}
              entering={FadeInDown.duration(Motion.duration.slow).delay(
                Math.min(index * Motion.stagger.step, Motion.stagger.cap)
              )}>
              <Row
                title={noteTitle(note.content) || 'Nota sem título'}
                subtitle={notePreview(note.content) || undefined}
                icon="note.text"
                chevron={false}
                trailing={
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {deadlineLabel(note)}
                  </ThemedText>
                }
                accessibilityLabel={`${noteTitle(note.content) || 'Nota sem título'}, ${deadlineLabel(note)}. Toque para restaurar.`}
                onPress={() => onRestore(note)}
                onLongPress={() => showActions(note)}
              />
            </Animated.View>
          ))}
        </Section>
      )}

      {list.hasNextPage ? (
        <Button
          label="Carregar mais"
          variant="secondary"
          size="sm"
          loading={list.isFetchingNextPage}
          onPress={() => void list.fetchNextPage()}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  errorCard: {
    alignItems: 'center',
    gap: Space.md,
  },
});
