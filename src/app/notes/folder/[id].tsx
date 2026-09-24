import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import { Stack, router, useLocalSearchParams } from 'expo-router';

import { Chip } from '@/components/finance/chip';
import { ColorPicker } from '@/components/notes/color-picker';
import { FolderGrid } from '@/components/notes/folder-grid';
import { FolderPicker } from '@/components/notes/folder-picker';
import { NoteList } from '@/components/notes/note-list';
import { useFolderMenu } from '@/components/notes/use-folder-menu';
import { TagPicker } from '@/components/notes/tag-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderActions } from '@/components/ui/header-actions';
import { fecharDeslizavelAberto } from '@/components/ui/deslizavel';
import { DragScrollView } from '@/components/ui/drag-scroll';
import { Screen } from '@/components/ui/screen';
import { SectionHead } from '@/components/ui/section-head';
import { SkeletonList } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { Space } from '@/design/tokens';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import {
  useNoteFolders,
  useNotesList,
  useReorderFolders,
  useReorderNotes,
  useRestoreNote,
  useToggleNotePin,
  useTrashNote,
  useUpdateFolder,
  useUpdateNote,
  type Note,
  type NoteFolder,
} from '@/hooks/use-notes';
import { useNoteSort } from '@/hooks/use-note-sort';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import type { NoteCardActions } from '@/components/notes/note-card';

/**
 * Uma pasta, como LUGAR.
 *
 * Ela existe porque o chip de filtro não conseguia ser um: um recorte da mesma lista não tem
 * cabeçalho, não tem ações próprias, não tem subpasta e não dá para arrastar dentro dele. Aqui a
 * pasta tem nome no header nativo, as subpastas em cima, as notas embaixo e um menu com tudo que
 * se faz com ela.
 *
 * ⚠️ **Mora no `<Stack>` RAIZ, fora de `(tabs)`** — a tab bar aparece só nas cinco raízes (§8 do
 * design). E o scroll é a RAIZ da tela: com uma `View` no meio o iOS não acha o scroll view da
 * interação do título grande e ele nunca colapsa (a armadilha de 11/09/2026, que valia para 23
 * telas de uma vez).
 */
export default function FolderScreen() {
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const params = useLocalSearchParams<{ id: string }>();
  const toast = useToast();

  const [sort] = useNoteSort();
  const [arrastando, setArrastando] = useState(false);
  const [pintandoNota, setPintandoNota] = useState<Note | null>(null);
  const [movendo, setMovendo] = useState<Note | null>(null);
  /**
   * ⚠️ O alvo é uma PASTA, não um booleano: o mesmo sheet pinta esta pasta (pelo menu do header)
   * e uma subpasta (pelo toque longo no ladrilho). Com `true/false` a escolha caía sempre na
   * pasta da tela, e colorir uma subpasta repintava a mãe — sem erro nenhum.
   */
  const [pintandoPasta, setPintandoPasta] = useState<NoteFolder | null>(null);
  const [etiquetando, setEtiquetando] = useState(false);
  /** As tags enquanto o sheet está aberto; `null` = espelha o cache. */
  const [tagsEmEdicao, setTagsEmEdicao] = useState<string[] | null>(null);

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  /** Altura visível da rolagem — sem ela o auto-scroll usa a janela inteira e nunca dispara. */
  const [alturaVisivel, setAlturaVisivel] = useState(0);
  const [topoSubpastas, setTopoSubpastas] = useState(0);
  const [topoFixadas, setTopoFixadas] = useState(0);
  const [topoNotas, setTopoNotas] = useState(0);

  const foldersQuery = useNoteFolders();
  const list = useNotesList({ folderId: params.id, sort });

  const togglePin = useToggleNotePin();
  const trash = useTrashNote();
  const restore = useRestoreNote();
  const updateNote = useUpdateNote();
  const updateFolder = useUpdateFolder();
  const reorderNotes = useReorderNotes();
  const reorderFolders = useReorderFolders();

  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data]);
  const folder = folders.find((f) => f.id === params.id);
  const subpastas = useMemo(
    () => folders.filter((f) => f.parent_id === params.id),
    [folders, params.id]
  );
  const notes = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);
  const fixadas = useMemo(() => notes.filter((n) => n.pinned), [notes]);
  const soltas = useMemo(() => notes.filter((n) => !n.pinned), [notes]);

  /** Dentro da pasta não há busca nem tag: o escopo já é o recorte, e a ordem manual vale. */
  const podeArrastar = sort === 'manual';

  const folderById = useCallback((id: string | null) => folders.find((f) => f.id === id), [folders]);

  const acoes: NoteCardActions = useMemo(
    () => ({
      onPin: (note) => {
        togglePin.mutate(
          { id: note.id, pinned: !note.pinned },
          {
            // Com "Desfazer": é o que deixa fixar valer ao arrastar até o fim (Deslizavel).
            onSuccess: () =>
              toast({
                message: note.pinned ? 'Nota desafixada.' : 'Nota fixada.',
                tone: 'success',
                action: { label: 'Desfazer', onPress: () => togglePin.mutate({ id: note.id, pinned: note.pinned }, { onError: () => toast({ message: 'Não deu para desfazer.', tone: 'error' }) }) },
              }),
            onError: () => toast({ message: 'Não deu para fixar a nota.', tone: 'error' }),
          }
        );
      },
      onColor: setPintandoNota,
      onMove: setMovendo,
      onArchive: (note) =>
        updateNote.mutate(
          { id: note.id, archived: true },
          {
            onSuccess: () =>
              toast({
                message: 'Nota arquivada.',
                tone: 'success',
                action: {
                  label: 'Desfazer',
                  onPress: () => updateNote.mutate({ id: note.id, archived: false }, { onError: () => toast({ message: 'Não deu para desfazer.', tone: 'error' }) }),
                },
              }),
            onError: () => toast({ message: 'Não deu para arquivar a nota.', tone: 'error' }),
          }
        ),
      onTrash: (note) =>
        trash.mutate(note.id, {
          onSuccess: () =>
            toast({
              message: 'Nota na lixeira.',
              tone: 'success',
              action: { label: 'Desfazer', onPress: () => restore.mutate(note.id, { onError: () => toast({ message: 'Não deu para desfazer.', tone: 'error' }) }) },
            }),
          onError: () => toast({ message: 'Não deu para apagar a nota.', tone: 'error' }),
        }),
    }),
    [togglePin, trash, restore, updateNote, toast]
  );

  const menuDaSubpasta = useFolderMenu({ onColor: setPintandoPasta });

  const pronta = useTelaPronta(list, foldersQuery);

  const arquivar = () => {
    if (!folder) return;
    updateFolder.mutate(
      { id: folder.id, archived: true },
      {
        onSuccess: () => {
          toast({
            message: 'Pasta arquivada.',
            tone: 'success',
            action: {
              label: 'Desfazer',
              onPress: () => updateFolder.mutate({ id: folder.id, archived: false }, { onError: () => toast({ message: 'Não deu para desfazer.', tone: 'error' }) }),
            },
          });
          // A tela que acabou de ser arquivada não pode continuar aberta: ela some das listas e
          // ficaria como um lugar que não existe mais em lugar nenhum.
          router.back();
        },
        onError: () => toast({ message: 'Não deu para arquivar a pasta.', tone: 'error' }),
      }
    );
  };

  /**
   * ⚠️ **A lista de tags vem do ESTADO local, não do cache.** O cache só volta depois do
   * refetch: dois toques seguidos leriam os dois a mesma lista de antes do primeiro, e a
   * segunda gravação desfaria a primeira.
   */
  const alternarTag = (t: string) => {
    if (!folder) return;
    const atuais = tagsEmEdicao ?? folder.tags;
    const tags = atuais.includes(t) ? atuais.filter((x) => x !== t) : [...atuais, t];
    setTagsEmEdicao(tags);
    updateFolder.mutate(
      { id: folder.id, tags },
      { onError: () => toast({ message: 'Não deu para salvar as tags.', tone: 'error' }) }
    );
  };

  return (
    <Screen scroll={false} grouped wide={tablet}>
      <Stack.Screen
        options={{ title: folder?.name ?? 'Pasta' }}
      />

      {/*
        ⚠️ **UMA chamada, com botão e menu juntos.** `HeaderActions` e `HeaderMenu` lado a lado
        escrevem os dois em `headerRight`, `setOptions` faz merge raso e o último ganha — foi
        assim que o "Editar" do detalhe do lançamento simplesmente não existiu no Android.
      */}
      <HeaderActions
        actions={
          folder
            ? [
                {
                  label: 'Nova nota',
                  icon: 'square.and.pencil',
                  onPress: () => router.push(`/notes/new?folder=${folder.id}`),
                },
              ]
            : []
        }
        menu={
          folder
            ? {
                title: folder.name,
                actions: [
                  {
                    label: folder.pinned ? 'Desafixar' : 'Fixar',
                    icon: folder.pinned ? 'pin.slash' : 'pin',
                    onPress: () =>
                      updateFolder.mutate(
                        { id: folder.id, pinned: !folder.pinned },
                        {
                          onError: () =>
                            toast({ message: 'Não deu para fixar a pasta.', tone: 'error' }),
                        }
                      ),
                  },
                  { label: 'Cor', icon: 'paintpalette', onPress: () => setPintandoPasta(folder) },
                  { label: 'Tags', icon: 'tag', onPress: () => setEtiquetando(true) },
                  {
                    label: 'Renomear e mover',
                    icon: 'folder.badge.plus',
                    onPress: () => router.push('/notes/folders'),
                  },
                  { label: 'Arquivar', icon: 'archivebox', onPress: arquivar },
                ],
              }
            : undefined
        }
      />

      <DragScrollView
        ref={scrollRef}
        // Rolar fecha o card arrastado que estiver aberto (Deslizavel).
        onScrollBeginDrag={fecharDeslizavelAberto}
        onLayout={(e) => setAlturaVisivel(e.nativeEvent.layout.height)}
        scrollEnabled={!arrastando}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.conteudo}
        scrollEventThrottle={16}
        onScroll={({ nativeEvent: e }) => {
          const fim = e.contentSize.height - e.layoutMeasurement.height - e.contentOffset.y;
          if (fim < 600 && list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
        }}>
        {!pronta ? (
          <>
            <SkeletonList linhas={4} />
            <SkeletonList linhas={3} />
          </>
        ) : !folder ? (
          <EmptyState
            icon="folder"
            title="Pasta não encontrada"
            hint="Ela pode ter sido apagada ou arquivada em outro aparelho."
            action={{ label: 'Voltar', onPress: () => router.back() }}
          />
        ) : (
          <>
            {folder.tags.length > 0 ? (
              <View style={styles.tags}>
                {folder.tags.map((t) => (
                  // Chip aqui é ETIQUETA, não filtro: dentro da pasta não há o que recortar. O
                  // toque abre o seletor, que é onde se tira e se põe.
                  <Chip key={t} label={`#${t}`} selected onPress={() => setEtiquetando(true)} />
                ))}
              </View>
            ) : null}

            {subpastas.length > 0 ? (
              <View style={styles.secao} onLayout={(e) => setTopoSubpastas(e.nativeEvent.layout.y)}>
                <SectionHead title="Subpastas" inset={false} />
                <FolderGrid
                  pastas={subpastas}
                  enabled={podeArrastar}
                  scrollRef={scrollRef}
                  topInset={topoSubpastas}
                  viewportHeight={alturaVisivel}
                  onDragStateChange={setArrastando}
                  onOpen={(f) => router.push(`/notes/folder/${f.id}`)}
                  onMenu={menuDaSubpasta}
                  onReorder={(ids) =>
                    reorderFolders.mutate(ids, {
                      onError: () =>
                        toast({ message: 'Não deu para salvar a ordem.', tone: 'error' }),
                    })
                  }
                />
              </View>
            ) : null}

            {fixadas.length > 0 ? (
              <View style={styles.secao} onLayout={(e) => setTopoFixadas(e.nativeEvent.layout.y)}>
                {/* Mesmo motivo do rótulo de baixo: sozinho ele nomearia a lista inteira, e o
                    alfinete de cada cartão já diz o que a seção diria. */}
                {soltas.length > 0 ? <SectionHead title="Fixadas" inset={false} /> : null}
                <NoteList
                  notas={fixadas}
                  acoes={acoes}
                  folderById={folderById}
                  showFolder={false}
                  enabled={podeArrastar}
                  scrollRef={scrollRef}
                  topInset={topoFixadas}
                  viewportHeight={alturaVisivel}
                  onDragStateChange={setArrastando}
                  onReorder={(ids) =>
                    reorderNotes.mutate(ids, {
                      onError: () =>
                        toast({ message: 'Não deu para salvar a ordem.', tone: 'error' }),
                    })
                  }
                />
              </View>
            ) : null}

            <View style={styles.secao} onLayout={(e) => setTopoNotas(e.nativeEvent.layout.y)}>
              {fixadas.length > 0 && soltas.length > 0 ? (
                <SectionHead title="Notas" inset={false} />
              ) : null}

              {soltas.length > 0 ? (
                <NoteList
                  notas={soltas}
                  acoes={acoes}
                  folderById={folderById}
                  showFolder={false}
                  enabled={podeArrastar}
                  scrollRef={scrollRef}
                  topInset={topoNotas}
                  viewportHeight={alturaVisivel}
                  onDragStateChange={setArrastando}
                  onReorder={(ids) =>
                    reorderNotes.mutate(ids, {
                      onError: () =>
                        toast({ message: 'Não deu para salvar a ordem.', tone: 'error' }),
                    })
                  }
                />
              ) : list.isError ? (
                <EmptyState
                  icon="exclamationmark.triangle"
                  title="Não deu para carregar as notas"
                  hint="Pode ter sido a conexão."
                  action={{ label: 'Tentar de novo', onPress: () => list.refetch() }}
                />
              ) : fixadas.length === 0 && subpastas.length === 0 ? (
                <EmptyState
                  icon="tray"
                  title={`«${folder.name}» está vazia`}
                  hint="Toque no lápis aí em cima para escrever a primeira — ela já nasce aqui dentro."
                />
              ) : null}
            </View>
          </>
        )}
      </DragScrollView>

      <ColorPicker
        visible={pintandoNota !== null}
        value={pintandoNota?.color ?? null}
        title="Cor da nota"
        onClose={() => setPintandoNota(null)}
        onPick={(cor) => {
          if (!pintandoNota) return;
          updateNote.mutate(
            { id: pintandoNota.id, color: cor },
            { onError: () => toast({ message: 'Não deu para mudar a cor.', tone: 'error' }) }
          );
        }}
      />

      <ColorPicker
        visible={pintandoPasta !== null}
        value={pintandoPasta?.color ?? null}
        title="Cor da pasta"
        onClose={() => setPintandoPasta(null)}
        onPick={(cor) => {
          if (!pintandoPasta) return;
          updateFolder.mutate(
            { id: pintandoPasta.id, color: cor },
            { onError: () => toast({ message: 'Não deu para mudar a cor.', tone: 'error' }) }
          );
        }}
      />

      <TagPicker
        visible={etiquetando}
        alvo="pasta"
        current={tagsEmEdicao ?? folder?.tags ?? []}
        onClose={() => {
          setEtiquetando(false);
          setTagsEmEdicao(null);
        }}
        onToggle={alternarTag}
      />

      <FolderPicker
        visible={movendo !== null}
        current={movendo?.folder_id ?? null}
        folders={folders}
        onClose={() => setMovendo(null)}
        onPick={(destino) => {
          if (movendo) {
            updateNote.mutate(
              { id: movendo.id, folder_id: destino },
              { onError: () => toast({ message: 'Não deu para mover a nota.', tone: 'error' }) }
            );
          }
          setMovendo(null);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Título da seção → conteúdo a `Space.md` (o rótulo encostava na grade e na lista).
  secao: { gap: Space.md },
  conteudo: {
    gap: Space.xl,
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
    paddingBottom: Space.xxxl,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
});
