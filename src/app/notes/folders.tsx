import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { HeaderActions } from '@/components/ui/header-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { HitTarget, Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  useDeleteFolder,
  folderTree,
  useNoteFolders,
  useSaveFolder,
  useUpdateFolder,
  type NoteFolder,
} from '@/hooks/use-notes';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { normalizeFolderName } from '@/lib/search';
import { actionSheet, FOLDER_ICONS, notesLabel, symbol } from '@/components/notes/note-actions';
import { ColorPicker } from '@/components/notes/color-picker';
import { TagPicker } from '@/components/notes/tag-picker';
import { noteInk } from '@/design/note-colors';

/**
 * Organizar pastas — criar, renomear, trocar ícone, cor, tags, mover, arquivar e apagar.
 *
 * ## Por que ela continua existindo depois de a pasta virar LUGAR
 *
 * A grade da home mostra a RAIZ e a tela de uma pasta mostra as filhas dela; nenhuma das duas
 * mostra a ÁRVORE inteira, que é o que se precisa ver para mover "Trabalho / 2026" de lugar. É
 * também onde uma pasta nasce sem haver uma nota para movê-la.
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
  const theme = useTheme();
  const scheme = useScheme();
  const toast = useToast();
  const folders = useNoteFolders();
  const loose = useLooseNotesCount();
  const saveFolder = useSaveFolder();
  const deleteFolder = useDeleteFolder();
  const updateFolder = useUpdateFolder();

  const [editing, setEditing] = useState<NoteFolder | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('folder');
  const [error, setError] = useState<string | null>(null);
  /** Alvo de cada sheet — a pasta, nunca um booleano: os dois servem qualquer linha da árvore. */
  const [pintando, setPintando] = useState<NoteFolder | null>(null);
  const [etiquetando, setEtiquetando] = useState<NoteFolder | null>(null);

  const reset = () => {
    setEditing(null);
    setName('');
    setIcon('folder');
    setError(null);
  };

  // Renomear e trocar ícone caem no MESMO editor do topo: são o mesmo formulário, e um modal só
  // para trocar um símbolo seria uma tela a mais para uma ação de um toque.
  const startEdit = (folder: NoteFolder) => {
    setEditing(folder);
    setName(folder.name);
    setIcon(folder.icon ?? 'folder');
    setError(null);
  };

  const submit = async () => {
    const normalized = normalizeFolderName(name);
    if (!normalized) {
      setError('Dá um nome para a pasta.');
      return;
    }
    // Checagem local ANTES da mutation: o caminho de criação é `.upsert()`, que com nome repetido
    // atualizaria a pasta existente em silêncio em vez de reclamar.
    const clash = (folders.data ?? []).find((f) => f.name === normalized && f.id !== editing?.id);
    if (clash) {
      setError(`Já existe uma pasta «${normalized}».`);
      return;
    }

    try {
      await saveFolder.mutateAsync({ id: editing?.id, name: normalized, icon });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
    } catch (e) {
      // 23505 = outro aparelho criou a mesma pasta entre a checagem e o insert.
      if ((e as { code?: string }).code === '23505') {
        setError(`Já existe uma pasta «${normalized}».`);
        return;
      }
      toast({ message: 'Não deu para salvar a pasta.', tone: 'error' });
    }
  };

  const confirmDelete = (folder: NoteFolder) => {
    actionSheet(
      {
        title: `Apagar «${folder.name}»?`,
        message:
          folder.notes_count === 0
            ? 'A pasta está vazia.'
            : `As ${notesLabel(folder.notes_count)} ficam em "Sem pasta".`,
        options: ['Apagar pasta'],
        destructiveIndex: 0,
      },
      () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        if (editing?.id === folder.id) reset();
        deleteFolder.mutate(folder.id, {
          onError: () => toast({ message: 'Não deu para apagar a pasta.', tone: 'error' }),
        });
      }
    );
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
        title: `Mover «${folder.name}» para`,
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
            message: `«${folder.name}» arquivada.`,
            tone: 'success',
            action: {
              label: 'Desfazer',
              onPress: () => updateFolder.mutate({ id: folder.id, archived: false }),
            },
          }),
        onError: () => toast({ message: 'Não deu para arquivar a pasta.', tone: 'error' }),
      }
    );
  };

  const showActions = (folder: NoteFolder) => {
    Haptics.selectionAsync();
    actionSheet(
      {
        title: folder.name,
        message: notesLabel(folder.notes_count),
        options: [
          'Renomear ou trocar ícone',
          'Cor',
          'Tags',
          folder.pinned ? 'Desafixar' : 'Fixar',
          'Mover para dentro de…',
          'Arquivar',
          'Apagar',
        ],
        destructiveIndex: 6,
      },
      (index) => {
        if (index === 0) startEdit(folder);
        if (index === 1) setPintando(folder);
        if (index === 2) setEtiquetando(folder);
        if (index === 3) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          updateFolder.mutate(
            { id: folder.id, pinned: !folder.pinned },
            { onError: () => toast({ message: 'Não deu para fixar a pasta.', tone: 'error' }) }
          );
        }
        if (index === 4) moverPara(folder);
        if (index === 5) arquivar(folder);
        if (index === 6) confirmDelete(folder);
      }
    );
  };

  /**
   * Em ÁRVORE, não em ordem alfabética plana: sem isto "Trabalho / 2026" apareceria a três telas
   * de distância de "Trabalho", e a hierarquia existiria só no banco.
   */
  const list = folders.data ?? [];
  const arvore = folderTree(list);

  // One editor instance: on a wide window it stays beside the hierarchy; on a narrow window
  // it returns above the list, preserving the existing creation flow and keyboard behavior.
  const folderEditor = (
      <Card>
        <View style={styles.form}>
          <Field label={editing ? `Renomear «${editing.name}»` : 'Nova pasta'} error={error ?? undefined}>
            <TextField
              value={name}
              onChangeText={(text) => {
                setName(text);
                setError(null);
              }}
              placeholder="mercado"
              autoCapitalize="none"
              maxLength={40}
              invalid={!!error}
              accessibilityLabel="Nome da pasta"
              onSubmitEditing={() => void submit()}
            />
          </Field>

          <View style={styles.grid}>
            {FOLDER_ICONS.map((option) => {
              const selected = option.name === icon;
              return (
                <Pressable
                  key={option.label}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setIcon(option.name);
                  }}
                  style={styles.iconCellWrap}>
                  <View
                    style={[
                      styles.iconCell,
                      { backgroundColor: selected ? theme.accentSoft : theme.backgroundElement },
                    ]}>
                    <Icon
                      name={symbol(option.name)}
                      size="lg"
                      color={selected ? 'tint' : 'textSecondary'}
                    />
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.formActions}>
            <Button
              label={editing ? 'Salvar' : 'Criar pasta'}
              size="sm"
              loading={saveFolder.isPending}
              onPress={() => void submit()}
            />
            {editing ? <Button label="Cancelar" variant="ghost" size="sm" onPress={reset} /> : null}
          </View>
        </View>
      </Card>
  );

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
          hint="Pastas aparecem sozinhas quando você manda “anotar: comprar leite #mercado” no WhatsApp — ou cria uma aqui."
        />
      ) : (
        <Section>
          {arvore.map((folder, index) => (
            <Animated.View
              key={folder.id}
              layout={LinearTransition.duration(Motion.duration.base)}
              entering={FadeInDown.duration(Motion.duration.slow).delay(
                Math.min(index * Motion.stagger.step, Motion.stagger.cap)
              )}>
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

  const compactOrganizer = (
    <>
      {folderEditor}
      {folderLibrary}
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

      <AdaptivePanes
        testID="folder-organizer-panes"
        main={folderLibrary}
        support={folderEditor}
        singlePaneContent={compactOrganizer}
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
  form: {
    gap: Space.lg,
  },
  /**
   * Seis por linha, doze ícones, duas linhas exatas.
   *
   * ⚠️ Com `gap` + largura fixa a fileira embrulhava por largura e dava 7 em cima e 5 embaixo —
   * lê como acidente, não como grade, e é o mesmo defeito que a paleta de cores tinha. A célula
   * em porcentagem fecha a conta em qualquer tela sem medir nada; o respiro vem do padding dela,
   * porque `gap` sobre porcentagem empurra a sexta para a linha seguinte.
   */
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  iconCellWrap: { width: '16.666%', padding: Space.xs / 2 },
  /** Ícone menor que a área de toque: o alvo é 44, o símbolo é 24. */
  iconCell: {
    height: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  formActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  errorCard: {
    alignItems: 'center',
    gap: Space.md,
  },
});
