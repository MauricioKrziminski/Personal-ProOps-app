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
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
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
  useNoteFolders,
  useSaveFolder,
  type NoteFolder,
} from '@/hooks/use-notes';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { normalizeFolderName } from '@/lib/search';
import { showItemActions } from '@/lib/item-actions';

/**
 * Pastas — criar, renomear, trocar ícone, apagar.
 *
 * Catálogo fechado de símbolos, nunca picker de emoji: emoji na chrome é proibido pela regra de
 * design, e o catálogo é o que mantém a lista visualmente coerente. O nome em inglês do SF Symbol
 * não serve de rótulo — por isso cada um carrega o seu em pt-BR.
 */
/** `name` fica como `string`: é assim que a coluna `note_folders.icon` guarda. */
const FOLDER_ICONS: { name: string; label: string }[] = [
  { name: 'folder', label: 'pasta' },
  { name: 'briefcase', label: 'maleta' },
  { name: 'lightbulb', label: 'lâmpada' },
  { name: 'cart', label: 'carrinho' },
  { name: 'heart', label: 'coração' },
  { name: 'book', label: 'livro' },
  { name: 'airplane', label: 'avião' },
  { name: 'house', label: 'casa' },
  { name: 'dumbbell', label: 'halter' },
  { name: 'pills', label: 'remédios' },
  { name: 'gift', label: 'presente' },
  { name: 'graduationcap', label: 'formatura' },
];

function symbol(icon: string | null | undefined): SymbolViewProps['name'] {
  return (icon ?? 'folder') as SymbolViewProps['name'];
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
  const toast = useToast();
  const folders = useNoteFolders();
  const loose = useLooseNotesCount();
  const saveFolder = useSaveFolder();
  const deleteFolder = useDeleteFolder();

  const [editing, setEditing] = useState<NoteFolder | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('folder');
  const [error, setError] = useState<string | null>(null);

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

  const showActions = (folder: NoteFolder) => {
    Haptics.selectionAsync();
    actionSheet(
      { title: folder.name, options: ['Renomear', 'Trocar ícone', 'Apagar'], destructiveIndex: 2 },
      (index) => {
        if (index === 0 || index === 1) startEdit(folder);
        if (index === 2) confirmDelete(folder);
      }
    );
  };

  const list = folders.data ?? [];

  return (
    <Screen grouped>
      <Stack.Screen
        options={{
          title: 'Pastas',
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Lixeira"
              hitSlop={12}
              onPress={() => router.push('/notes/trash')}>
              <Icon name="trash" size="lg" color="tint" />
            </Pressable>
          ),
        }}
      />

      {/* Ação primária: criar. Campo no topo, sem modal. */}
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
                  style={[
                    styles.iconCell,
                    { backgroundColor: selected ? theme.accentSoft : theme.backgroundElement },
                  ]}>
                  <Icon name={symbol(option.name)} size="lg" color={selected ? 'tint' : 'textSecondary'} />
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
          {list.map((folder, index) => (
            <Animated.View
              key={folder.id}
              layout={LinearTransition.duration(Motion.duration.base)}
              entering={FadeInDown.duration(Motion.duration.slow).delay(
                Math.min(index * Motion.stagger.step, Motion.stagger.cap)
              )}>
              <Row
                title={folder.name}
                icon={symbol(folder.icon)}
                chevron={false}
                trailing={
                  <ThemedText type="footnote" themeColor="textSecondary" style={tabular}>
                    {folder.notes_count}
                  </ThemedText>
                }
                accessibilityLabel={`${folder.name}, ${notesLabel(folder.notes_count)}`}
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: Space.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  /** Ícone menor que a área de toque: o alvo é 44, o símbolo é 24. */
  iconCell: {
    width: HitTarget,
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
