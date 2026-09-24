import { Stack, router } from 'expo-router';
import { useMemo } from 'react';
import {
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { HeaderActions } from '@/components/ui/header-actions';
import { Button } from '@/components/ui/button';
import { VerMais } from '@/components/ui/ver-mais';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Deslizavel } from '@/components/ui/deslizavel';
import { showItemActions, type ItemAction } from '@/lib/item-actions';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Space } from '@/design/tokens';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { usePurgeNote, useRestoreNote, useNotesList, type Note } from '@/hooks/use-notes';
import { noteTitle, notePreview } from '@/lib/search';
import { actionSheet } from '@/components/notes/note-actions';
import { transicaoDeLayout } from '@/components/motion/transicao';

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


export default function TrashScreen() {
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
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

  /** O menu da nota na lixeira, UMA lista para o toque longo e o arrasto. */
  const acoesDaNota = (note: Note): ItemAction[] => [
    { label: 'Ver conteúdo', arrasto: 'fora', onPress: () => router.push(`/notes/${note.id}`) },
    { label: 'Apagar de vez', curto: 'Apagar', icon: 'trash', destructive: true, arrasto: 'esquerda', onPress: () => confirmPurge(note) },
  ];
  const showActions = (note: Note) => showItemActions(noteTitle(note.content) || 'Nota', acoesDaNota(note));

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

  const trashBody = (
    <>
      {/* Antes da lista: a pessoa precisa saber o prazo ANTES de decidir se corre. */}
      <ThemedText type="small" themeColor="textSecondary">
        Apagadas de vez após 30 dias
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
              layout={transicaoDeLayout}
              entering={FadeInDown.duration(Motion.duration.slow).delay(
                Math.min(index * Motion.stagger.step, Motion.stagger.cap)
              )}>
              <Deslizavel titulo={noteTitle(note.content) || 'Nota'} acoes={acoesDaNota(note)}>
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
              </Deslizavel>
            </Animated.View>
          ))}
        </Section>
      )}

      {/* O mesmo "Ver mais" de toda lista do app — era "Carregar mais", outro rótulo para a mesma intenção. */}
      <VerMais
        restantes={list.hasNextPage ? null : 0}
        carregando={list.isFetchingNextPage}
        onPress={() => void list.fetchNextPage()}
      />
    </>
  );

  const tabletContext = (
    <Card style={styles.context}>
      <ThemedText type="subtitle">Recuperação</ThemedText>
      <View style={styles.contextStat}>
        <ThemedText type="subtitle">{notes.length}</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {notes.length === 1 ? 'nota carregada' : 'notas carregadas'}
        </ThemedText>
      </View>
    </Card>
  );

  return (
    <Screen grouped wide={tablet} onRefresh={() => Promise.all([list.refetch()])}>
      <Stack.Screen
        options={{
          title: 'Lixeira',
        }}
      />

      <HeaderActions
        actions={
          notes.length === 0
            ? []
            : [{ label: 'Esvaziar', destructive: true, onPress: confirmEmpty }]
        }
      />
      {tablet ? (
        <AdaptivePanes
          testID="trash-notes-panes"
          main={trashBody}
          support={tabletContext}
          singlePane="main-only"
          singlePaneContent={trashBody}
        />
      ) : trashBody}
    </Screen>
  );
}

const styles = StyleSheet.create({
  errorCard: {
    alignItems: 'center',
    gap: Space.md,
  },
  context: {
    gap: Space.md,
    padding: Space.xl,
  },
  contextStat: { gap: Space.xs },
});
