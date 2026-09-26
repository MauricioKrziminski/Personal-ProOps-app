import { useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Forte } from '@/components/ui/forte';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { showItemActions, type ItemAction } from '@/lib/item-actions';
import { Deslizavel } from '@/components/ui/deslizavel';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Space, tabular } from '@/design/tokens';
import {
  useDeleteFolder,
  folderTree,
  useNoteFolders,
  useSaveFolder,
  useUpdateFolder,
  type NoteFolder,
} from '@/hooks/use-notes';
import { useScheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { actionSheet, confirmarApagarPasta, notesLabel, symbol } from '@/components/notes/note-actions';
import { ColorPicker } from '@/components/notes/color-picker';
import { NovaPastaSheet } from '@/components/notes/nova-pasta';
import { TagPicker } from '@/components/notes/tag-picker';
import { noteInk } from '@/design/note-colors';
import { transicaoDeLayout } from '@/components/motion/transicao';

/**
 * Organizar pastas — a ÁRVORE inteira: renomear e trocar ícone, cor, tags, fixar, mover para
 * dentro de outra, arquivar e apagar. Criar NÃO mora aqui (25/09/2026): tem a folha "Nova pasta"
 * no "…" de Notas, e o editor que ficava no topo desta tela repetia aquela.
 *
 * ## Por que ela continua existindo depois de a pasta virar LUGAR
 *
 * A grade da home mostra a RAIZ e a tela de uma pasta mostra as filhas dela; nenhuma das duas
 * mostra a ÁRVORE inteira, que é o que se precisa ver para mover "Trabalho / 2026" de lugar.
 *
 * ⚠️ **Aqui NÃO se arrasta, e é decisão.** Reordenar já existe onde a conta é exata — a grade da
 * raiz, na home, e a grade das subpastas, dentro de uma pasta. Sobre esta lista, que é uma
 * árvore ACHATADA com recuo, "soltar entre duas linhas" seria ambíguo em todo cruzamento de
 * nível (virou irmã da de cima? filha dela?), e a resposta errada reorganiza a árvore de alguém
 * em silêncio. Mudar de nível tem caminho explícito: "Mover para dentro de…".
 */

/**
 * "Sem pasta" não é pasta — `useNoteFolders` descarta a linha `folder_id = null` que a RPC
 * devolve. A contagem das notas soltas vem daqui, sob o mesmo prefixo `['notes', …]`.
 */
function useLooseNotesCount() {
  return useQuery({
    queryKey: ['notes', 'folders', 'loose'],
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('note_folder_counts');
      if (error) throw error;
      const loose = (data ?? []).find((c) => c.folder_id === null);
      return Number(loose?.notes_count ?? 0);
    },
  });
}

export default function FoldersScreen() {
  const scheme = useScheme();
  const toast = useToast();
  const folders = useNoteFolders();
  const loose = useLooseNotesCount();
  const saveFolder = useSaveFolder();
  const deleteFolder = useDeleteFolder();
  const updateFolder = useUpdateFolder();

  /** A pasta na folha de renomear — a MESMA folha de "Nova pasta" (`NovaPastaSheet`). */
  const [editando, setEditando] = useState<NoteFolder | null>(null);
  /** Alvo de cada sheet — a pasta, nunca um booleano: os dois servem qualquer linha da árvore. */
  const [pintando, setPintando] = useState<NoteFolder | null>(null);
  const [etiquetando, setEtiquetando] = useState<NoteFolder | null>(null);

  /**
   * `?edit=<pasta>` — o "Renomear e mover" de DENTRO de uma pasta (25/09/2026): chega com a folha
   * de renomear DELA aberta, em vez de a pessoa caçar a pasta na árvore. Uma vez só.
   */
  const params = useLocalSearchParams<{ edit?: string }>();
  const [edicaoAberta, setEdicaoAberta] = useState<string | null>(null);
  if (params.edit && params.edit !== edicaoAberta) {
    const alvo = folders.data?.find((f) => f.id === params.edit);
    if (alvo) {
      setEdicaoAberta(params.edit);
      setEditando(alvo);
    }
  }

  const confirmDelete = (folder: NoteFolder) => {
    confirmarApagarPasta(folder, () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (editando?.id === folder.id) setEditando(null);
      deleteFolder.mutate(folder.id, {
        onError: () => toast({ message: 'Não deu para apagar a pasta.', tone: 'error' }),
      });
    });
  };

  /**
   * Escolhe a pasta-mãe. As opções excluem a própria pasta (não pode ser mãe de si mesma) e as
   * DESCENDENTES dela — mover "Trabalho" para dentro de "Trabalho / 2026" faria as duas sumirem
   * da árvore, cada uma esperando a outra aparecer primeiro.
   */
  const moverPara = (folder: NoteFolder) => {
    const descendentes = new Set<string>([folder.id]);
    let cresceu = true;
    while (cresceu) {
      cresceu = false;
      for (const f of list) {
        if (f.parent_id && descendentes.has(f.parent_id) && !descendentes.has(f.id)) {
          descendentes.add(f.id);
          cresceu = true;
        }
      }
    }
    const destinos = list.filter((f) => !descendentes.has(f.id));

    actionSheet(
      {
        title: `Mover a pasta ${folder.name} para`,
        options: ['Raiz (nenhuma pasta)', ...destinos.map((f) => f.name)],
      },
      (index) => {
        if (index === undefined) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        saveFolder.mutate({
          id: folder.id,
          name: folder.name,
          icon: folder.icon,
          parentId: index === 0 ? null : destinos[index - 1].id,
        });
      }
    );
  };

  /**
   * Arquivar some da grade e do seletor, e NÃO toca nas notas.
   *
   * Uma cascata de `archived_at` para dentro seria escrita em massa impossível de desfazer com
   * exatidão: quem já estava arquivada antes voltaria junto no "Desfazer". As notas continuam na
   * pasta e a pasta inteira volta em Arquivadas.
   */
  const arquivar = (folder: NoteFolder) => {
    updateFolder.mutate(
      { id: folder.id, archived: true },
      {
        onSuccess: () =>
          toast({
            message: <>Pasta <Forte>{folder.name}</Forte> arquivada.</>,
            tone: 'success',
            action: {
              label: 'Desfazer',
              onPress: () => updateFolder.mutate({ id: folder.id, archived: false }, { onError: () => toast({ message: 'Não deu para desfazer.', tone: 'error' }) }),
            },
          }),
        onError: () => toast({ message: 'Não deu para arquivar a pasta.', tone: 'error' }),
      }
    );
  };

  const fixar = (folder: NoteFolder) => {
    updateFolder.mutate(
      { id: folder.id, pinned: !folder.pinned },
      {
        // Com "Desfazer": é o que deixa fixar valer ao arrastar até o fim (Deslizavel).
        onSuccess: () =>
          toast({
            message: <>Pasta <Forte>{folder.name}</Forte> {folder.pinned ? 'desafixada' : 'fixada'}.</>,
            tone: 'success',
            action: { label: 'Desfazer', onPress: () => updateFolder.mutate({ id: folder.id, pinned: folder.pinned }, { onError: () => toast({ message: 'Não deu para desfazer.', tone: 'error' }) }) },
          }),
        onError: () => toast({ message: 'Não deu para fixar a pasta.', tone: 'error' }),
      }
    );
  };

  /** O menu da pasta, UMA lista para o toque (longo ou curto) e o arrasto. */
  const acoesDaPasta = (folder: NoteFolder): ItemAction[] => [
    { label: 'Renomear ou trocar ícone', onPress: () => setEditando(folder) },
    { label: 'Cor', onPress: () => setPintando(folder) },
    { label: 'Tags', onPress: () => setEtiquetando(folder) },
    { label: folder.pinned ? 'Desafixar' : 'Fixar', icon: folder.pinned ? 'pin.slash' : 'pin', arrasto: 'direita', desfaz: true, onPress: () => fixar(folder) },
    { label: 'Mover para dentro de…', onPress: () => moverPara(folder) },
    { label: 'Arquivar', icon: 'archivebox', arrasto: 'esquerda', desfaz: true, onPress: () => arquivar(folder) },
    { label: 'Apagar', destructive: true, onPress: () => confirmDelete(folder) },
  ];

  const showActions = (folder: NoteFolder) =>
    showItemActions(folder.name, acoesDaPasta(folder), notesLabel(folder.notes_count));

  /**
   * Em ÁRVORE, não em ordem alfabética plana: sem isto "Trabalho / 2026" apareceria a três telas
   * de distância de "Trabalho", e a hierarquia existiria só no banco.
   */
  const list = folders.data ?? [];
  const arvore = folderTree(list);

  const folderLibrary = (
    <>
      {folders.isError ? (
        <Card>
          <View style={styles.errorCard}>
            <Icon name="exclamationmark.triangle" size="xl" color="danger" />
            <ThemedText type="smallBold">Não deu para carregar as pastas</ThemedText>
            <Button
              label="Tentar de novo"
              variant="secondary"
              size="sm"
              onPress={() => folders.refetch()}
            />
          </View>
        </Card>
      ) : folders.isLoading ? (
        <Section>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </Section>
      ) : list.length === 0 ? (
        <EmptyState
          icon="folder"
          title="Nenhuma pasta ainda"
          hint="Crie em *Nova pasta*, no … de Notas, ou mande *anotar: comprar leite #mercado* no WhatsApp."
        />
      ) : (
        <Section>
          {arvore.map((folder, index) => (
            <Animated.View
              key={folder.id}
              layout={transicaoDeLayout}
              entering={FadeInDown.duration(Motion.duration.slow).delay(
                Math.min(index * Motion.stagger.step, Motion.stagger.cap)
              )}>
              <Deslizavel titulo={folder.name} acoes={acoesDaPasta(folder)}>
              <Row
                title={folder.name}
                icon={symbol(folder.icon)}
                /* O recuo é o que faz a hierarquia existir na tela. */
                indent={folder.depth}
                chevron={false}
                trailing={
                  <View style={styles.trailing}>
                    {folder.pinned ? <Icon name="pin.fill" size="sm" color="tint" /> : null}
                    {/* O disco é a MESMA tinta do ladrilho da grade: é assim que a pessoa
                        reconhece aqui a pasta que ela pintou lá. */}
                    {noteInk(folder.color, scheme) ? (
                      <View
                        style={[styles.disco, { backgroundColor: noteInk(folder.color, scheme)! }]}
                      />
                    ) : null}
                    <ThemedText type="footnote" themeColor="textSecondary" style={tabular}>
                      {folder.notes_count}
                    </ThemedText>
                  </View>
                }
                accessibilityLabel={`${folder.name}, ${notesLabel(folder.notes_count)}${
                  folder.pinned ? ', fixada' : ''
                }`}
                onPress={() => showActions(folder)}
                onLongPress={() => showActions(folder)}
              />
              </Deslizavel>
            </Animated.View>
          ))}
        </Section>
      )}

      {/* Sempre no fim: não é pasta de verdade, mas o usuário precisa saber que existe nota solta. */}
      {folders.isLoading ? null : (
        <Section>
          <Row
            title="Sem pasta"
            icon="tray"
            chevron={false}
            trailing={
              <ThemedText type="footnote" themeColor="textSecondary" style={tabular}>
                {loose.data ?? 0}
              </ThemedText>
            }
            accessibilityLabel={`Sem pasta, ${notesLabel(loose.data ?? 0)}`}
          />
        </Section>
      )}
    </>
  );

  return (
    <Screen grouped wide onRefresh={() => Promise.all([folders.refetch(), loose.refetch()])}>
      <Stack.Screen options={{ title: 'Organizar pastas' }} />

      <HeaderActions
        actions={[]}
        menu={{
          title: 'Pastas',
          actions: [
            {
              label: 'Arquivadas',
              icon: 'archivebox',
              onPress: () => router.push('/notes/archived'),
            },
            { label: 'Lixeira', icon: 'trash', onPress: () => router.push('/notes/trash') },
          ],
        }}
      />

      {folderLibrary}

      <NovaPastaSheet
        key={editando?.id ?? 'fechada'}
        visible={editando !== null}
        pasta={editando}
        pastas={list}
        onClose={() => setEditando(null)}
      />

      <ColorPicker
        visible={pintando !== null}
        value={pintando?.color ?? null}
        title="Cor da pasta"
        onClose={() => setPintando(null)}
        onPick={(cor) => {
          if (!pintando) return;
          updateFolder.mutate(
            { id: pintando.id, color: cor },
            { onError: () => toast({ message: 'Não deu para mudar a cor.', tone: 'error' }) }
          );
        }}
      />

      <TagPicker
        visible={etiquetando !== null}
        alvo="pasta"
        current={etiquetando?.tags ?? []}
        onClose={() => setEtiquetando(null)}
        onToggle={(t) => {
          if (!etiquetando) return;
          const tags = etiquetando.tags.includes(t)
            ? etiquetando.tags.filter((x) => x !== t)
            : [...etiquetando.tags, t];
          // O alvo é uma CÓPIA do cache: sem atualizá-lo, marcar duas tags seguidas mandaria a
          // segunda com a lista de antes da primeira e desfaria a anterior.
          setEtiquetando({ ...etiquetando, tags });
          updateFolder.mutate(
            { id: etiquetando.id, tags },
            { onError: () => toast({ message: 'Não deu para salvar as tags.', tone: 'error' }) }
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  trailing: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  disco: { width: 12, height: 12, borderRadius: 6 },
  errorCard: {
    alignItems: 'center',
    gap: Space.md,
  },
});
