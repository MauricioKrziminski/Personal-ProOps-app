import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { symbol } from '@/components/notes/note-actions';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { Card } from '@/components/ui/card';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Space, tabular } from '@/design/tokens';
import {
  useNotesList,
  useUpdateFolder,
  useUpdateNote,
  type Note,
  type NoteFolder,
} from '@/hooks/use-notes';
import { useArchivedFolders } from '@/hooks/use-archived-folders';
import { relativeBR } from '@/lib/dates';
import { noteTitle } from '@/lib/search';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';

/**
 * Arquivadas — notas e pastas que saíram do caminho sem terem sido apagadas.
 *
 * ## Por que existe um TERCEIRO estado além da lixeira
 *
 * Lixeira é arrependimento com prazo: some em 30 dias e a tela promete resgate. Arquivo é
 * decisão: "isto acabou, não quero ver". Empilhar os dois no mesmo lugar obrigaria a lixeira a
 * guardar para sempre o que ninguém quer apagar, ou a apagar o que alguém só quis esconder.
 *
 * ⚠️ **Arquivar uma PASTA esconde as notas dela da home, e não escreve nada nas notas.** A home
 * lista `folder_id is null`, então nota dentro de pasta já não estava lá; a pasta some da grade
 * e volta inteira ao desarquivar. Uma cascata de `archived_at` nas notas seria escrita em massa
 * impossível de desfazer com exatidão — quem já estava arquivada antes voltaria junto.
 *
 * Aqui a lista é plana e sem arrasto de propósito: arquivo não tem ordem, tem data.
 */
export default function ArchivedScreen() {
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const toast = useToast();

  const notas = useNotesList({ archived: true, sort: 'recentes' });
  const pastas = useArchivedFolders();

  const updateNote = useUpdateNote();
  const updateFolder = useUpdateFolder();

  const listaNotas = useMemo(() => notas.data?.pages.flat() ?? [], [notas.data]);
  const listaPastas = pastas.data ?? [];
  const carregando = notas.isLoading || pastas.isLoading;
  const vazia = !carregando && listaNotas.length === 0 && listaPastas.length === 0;


  const desarquivarNota = (n: Note) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateNote.mutate(
      { id: n.id, archived: false },
      {
        onSuccess: () => toast({ message: 'Nota de volta.', tone: 'success' }),
        onError: () => toast({ message: 'Não deu para desarquivar.', tone: 'error' }),
      }
    );
  };

  const desarquivarPasta = (f: NoteFolder) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateFolder.mutate(
      { id: f.id, archived: false },
      {
        onSuccess: () => toast({ message: 'Pasta de volta.', tone: 'success' }),
        onError: () => toast({ message: 'Não deu para desarquivar.', tone: 'error' }),
      }
    );
  };

  const archiveList = (
    <>
      {notas.isError || pastas.isError ? (
        <EmptyState
          icon="exclamationmark.triangle"
          title="Não deu para carregar o arquivo"
          hint="Pode ter sido a conexão."
          action={{
            label: 'Tentar de novo',
            onPress: () => {
              void notas.refetch();
              void pastas.refetch();
            },
          }}
        />
      ) : carregando ? (
        <Section>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </Section>
      ) : vazia ? (
        <EmptyState
          icon="archivebox"
          title="Nada arquivado"
          hint="Arquivar tira uma nota ou uma pasta do caminho sem apagar — ela fica aqui, inteira."
        />
      ) : (
        <>
          {listaPastas.length > 0 ? (
            <Section title="Pastas">
              {listaPastas.map((f) => (
                <Animated.View key={f.id} layout={LinearTransition.duration(Motion.duration.base)}>
                  <Row
                    title={f.name}
                    icon={symbol(f.icon)}
                    // ⚠️ Sem contagem aqui: `note_folder_counts()` exclui arquivada de
                    // propósito (é o que mantém a grade honesta), então o número viria zerado
                    // e mentindo. A data responde o que se pergunta nesta tela.
                    subtitle={f.archived_at ? `arquivada ${relativeBR(f.archived_at)}` : undefined}
                    chevron={false}
                    accessibilityLabel={`${f.name}, arquivada`}
                    trailing={<Icon name="arrow.uturn.backward" size="md" color="tint" />}
                    onPress={() => desarquivarPasta(f)}
                  />
                </Animated.View>
              ))}
            </Section>
          ) : null}

          {listaNotas.length > 0 ? (
            <Section title="Notas">
              {listaNotas.map((n) => (
                <Animated.View key={n.id} layout={LinearTransition.duration(Motion.duration.base)}>
                  <Row
                    title={noteTitle(n.content) || 'Sem título'}
                    subtitle={n.archived_at ? `arquivada ${relativeBR(n.archived_at)}` : undefined}
                    chevron={false}
                    accessibilityLabel={`${noteTitle(n.content) || 'Sem título'}, arquivada`}
                    trailing={<Icon name="arrow.uturn.backward" size="md" color="tint" />}
                    onPress={() => desarquivarNota(n)}
                  />
                </Animated.View>
              ))}
            </Section>
          ) : null}

          {/* A linha de saída: daqui a lixeira é o outro lugar onde há coisa escondida. */}
          <View style={styles.rodape}>
            <ThemedText type="footnote" themeColor="textSecondary" style={tabular}>
              Tocar numa linha devolve o item para onde ele estava.
            </ThemedText>
            <Row
              title="Lixeira"
              icon="trash"
              subtitle="O que foi apagado, por 30 dias"
              onPress={() => router.push('/notes/trash')}
            />
          </View>
        </>
      )}
    </>
  );

  const tabletContext = (
    <Card style={styles.context}>
      <ThemedText type="subtitle">Arquivo</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Itens arquivados ficam fora da biblioteca principal até você decidir trazê-los de volta.
      </ThemedText>
      <View style={styles.contextStats}>
        <View style={styles.contextStat}>
          <ThemedText type="subtitle">{listaPastas.length}</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {listaPastas.length === 1 ? 'pasta' : 'pastas'}
          </ThemedText>
        </View>
        <View style={styles.contextStat}>
          <ThemedText type="subtitle">{listaNotas.length}</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {listaNotas.length === 1 ? 'nota' : 'notas'}
          </ThemedText>
        </View>
      </View>
      <ThemedText type="footnote" themeColor="textSecondary">
        Toque em uma linha para devolver o item ao lugar onde estava.
      </ThemedText>
    </Card>
  );

  return (
    <Screen
      grouped
      wide={tablet}
      onRefresh={() => Promise.all([notas.refetch(), pastas.refetch()])}>
      {tablet ? (
        <AdaptivePanes
          testID="archived-notes-panes"
          main={archiveList}
          support={tabletContext}
          singlePane="main-only"
          singlePaneContent={archiveList}
        />
      ) : archiveList}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rodape: { gap: Space.md },
  context: {
    gap: Space.md,
    padding: Space.xl,
  },
  contextStats: { flexDirection: 'row', gap: Space.xl },
  contextStat: { gap: Space.xs },
});
