import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, useColorScheme, useWindowDimensions } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Link, Stack, router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { Chip } from '@/components/finance/chip';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderActions } from '@/components/ui/header-actions';
import { TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Elevation, HitTarget, Radius, Space, Type } from '@/design/tokens';
import {
  useNoteFolders,
  useNoteTags,
  useNotesList,
  useRestoreNote,
  useSaveNote,
  useToggleNotePin,
  useTrashNote,
  type Note,
  type NoteFolder,
} from '@/hooks/use-notes';
import { useTheme } from '@/hooks/use-theme';
import { showItemActions } from '@/lib/item-actions';
import { noteTitle, notePreview, parseChecklist } from '@/lib/search';

/**
 * `typedRoutes`: `trash.tsx` ainda não existe como arquivo, então o typegen não conhece a rota
 * (o `_layout` já a declara). Cast pontual e greppável — some quando o arquivo nascer.
 */

/** Quantas tags cabem na faixa de metadados antes de virar `+N`. */
const TAGS_SHOWN = 3;

interface RowActions {
  folders: NoteFolder[];
  onPin: (note: Note) => void;
  onMove: (note: Note, folderId: string | null) => void;
  onTrash: (note: Note) => void;
}

/**
 * Linha da lista.
 *
 * Sem `entering`: `FlashList` recicla a célula e a animação replay a cada scroll.
 * Sem `onLongPress` + `Alert`: as ações moram no context menu nativo (`Link.Menu`), que é
 * descobrível por toque longo e não bloqueia a tela. `Link.Menu` é iOS-only — no Android a linha
 * continua navegando normalmente, as ações ficam no detalhe.
 */
function NoteRow({
  note,
  folderName,
  actions,
}: {
  note: Note;
  folderName?: string;
  actions: RowActions;
}) {
  const theme = useTheme();
  // Dynamic Type XL: a prévia cai para uma linha para os metadados não sumirem da tela.
  const { fontScale } = useWindowDimensions();

  const title = noteTitle(note.content) || 'Sem título';
  const preview = notePreview(note.content);
  const checklist = parseChecklist(note.content);
  const done = checklist.filter((item) => item.done).length;
  // Tag com o mesmo nome da pasta não vira metadado: `mercado · #mercado` gasta a linha
  // inteira para dizer a mesma coisa duas vezes.
  const tags = (note.tags ?? []).filter(
    (tag) => tag.toLowerCase() !== folderName?.toLowerCase()
  );

  const meta = [
    folderName,
    ...tags.slice(0, TAGS_SHOWN).map((tag) => `#${tag}`),
    tags.length > TAGS_SHOWN ? `+${tags.length - TAGS_SHOWN}` : null,
    checklist.length > 0 ? `${done}/${checklist.length}` : null,
    note.source === 'whatsapp' ? 'via WhatsApp' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const label = [
    title,
    folderName ? `pasta ${folderName}` : null,
    tags.length > 0 ? `${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}` : null,
    note.pinned ? 'fixada' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Link href={`/notes/${note.id}`} asChild>
      <Link.Trigger>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          // `Link.Menu` é iOS-only; sem isto o Android ficaria sem ação nenhuma na linha.
          onLongPress={
            Platform.OS === 'ios'
              ? undefined
              : () =>
                  showItemActions(title, [
                    {
                      label: note.pinned ? 'Desafixar' : 'Fixar',
                      onPress: () => actions.onPin(note),
                    },
                    ...[{ id: null as string | null, name: 'Sem pasta' }, ...actions.folders].map(
                      (f) => ({
                        label: `Mover para ${f.name}`,
                        onPress: () => actions.onMove(note, f.id),
                      })
                    ),
                    { label: 'Lixeira', destructive: true, onPress: () => actions.onTrash(note) },
                  ])
          }
          style={({ pressed }) => [
            styles.row,
            { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
          ]}>
          <View style={styles.rowTitle}>
            {note.pinned ? <Icon name="pin.fill" size="sm" color="textSecondary" /> : null}
            <ThemedText type="headline" numberOfLines={1} style={styles.grow}>
              {title}
            </ThemedText>
          </View>
          {preview ? (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              numberOfLines={fontScale >= 1.4 ? 1 : 2}>
              {preview}
            </ThemedText>
          ) : null}
          {meta ? (
            <ThemedText themeColor="textSecondary" numberOfLines={1} style={Type.caption}>
              {meta}
            </ThemedText>
          ) : null}
        </Pressable>
      </Link.Trigger>

      <Link.Menu>
        <Link.MenuAction
          icon={note.pinned ? 'pin.slash' : 'pin'}
          onPress={() => actions.onPin(note)}>
          {note.pinned ? 'Desafixar' : 'Fixar'}
        </Link.MenuAction>
        <Link.Menu title="Mover para pasta" icon="folder">
          <Link.MenuAction
            icon="tray"
            isOn={!note.folder_id}
            onPress={() => actions.onMove(note, null)}>
            Sem pasta
          </Link.MenuAction>
          {actions.folders.map((folder) => (
            <Link.MenuAction
              key={folder.id}
              isOn={note.folder_id === folder.id}
              onPress={() => actions.onMove(note, folder.id)}>
              {folder.name}
            </Link.MenuAction>
          ))}
        </Link.Menu>
        <Link.MenuAction icon="trash" destructive onPress={() => actions.onTrash(note)}>
          Lixeira
        </Link.MenuAction>
      </Link.Menu>
    </Link>
  );
}

/** Skeleton na forma da linha: título + duas linhas de prévia. */
function NoteSkeleton() {
  return (
    <View style={styles.row}>
      <Skeleton width="55%" height={17} />
      <Skeleton width="92%" height={13} />
      <Skeleton width="70%" height={13} />
    </View>
  );
}

export default function NotesScreen() {
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const toast = useToast();

  const [draft, setDraft] = useState('');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [folderId, setFolderId] = useState<string | undefined>(undefined);
  const [tag, setTag] = useState<string | null>(null);

  // Busca-enquanto-digita sem uma requisição por tecla.
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);

  const list = useNotesList({
    ...(folderId ? { folderId } : {}),
    ...(tag ? { tag } : {}),
    ...(q ? { q } : {}),
  });
  const foldersQuery = useNoteFolders();
  const tagsQuery = useNoteTags();

  const save = useSaveNote();
  const togglePin = useToggleNotePin();
  const trash = useTrashNote();
  const restore = useRestoreNote();

  // Falha em pastas/tags não derruba a lista: os chips só somem.
  const folders = foldersQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const notes = list.data?.pages.flat() ?? [];
  const folderName = (id: string | null) => folders.find((f) => f.id === id)?.name;

  const clearFilters = () => {
    setFolderId(undefined);
    setTag(null);
  };

  const submitDraft = () => {
    const content = draft.trim();
    if (!content || save.isPending) return;
    save.mutate(
      { content, folder_id: folderId ?? null },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setDraft('');
        },
        onError: () => toast({ message: 'Não deu para salvar a nota.', tone: 'error' }),
      }
    );
  };

  const actions: RowActions = {
    folders,
    onPin: (note) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      togglePin.mutate(
        { id: note.id, pinned: !note.pinned },
        { onError: () => toast({ message: 'Não deu para fixar a nota.', tone: 'error' }) }
      );
    },
    onMove: (note, target) =>
      save.mutate(
        { id: note.id, content: note.content, folder_id: target },
        {
          onSuccess: () =>
            toast({
              message: target ? `Movida para ${folderName(target)}.` : 'Tirada da pasta.',
              tone: 'success',
            }),
          onError: () => toast({ message: 'Não deu para mover a nota.', tone: 'error' }),
        }
      ),
    onTrash: (note) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      trash.mutate(note.id, {
        onSuccess: () =>
          toast({
            message: 'Nota na lixeira.',
            tone: 'success',
            action: { label: 'Desfazer', onPress: () => restore.mutate(note.id) },
          }),
        onError: () => toast({ message: 'Não deu para apagar a nota.', tone: 'error' }),
      });
    },
  };

  const filtered = !!folderId || !!tag;
  const hasChips = folders.length > 0 || tags.length > 0;

  const empty = list.isError ? (
    <EmptyState
      icon="exclamationmark.triangle"
      title="Não deu para carregar as notas"
      hint="Pode ter sido a conexão."
      action={{ label: 'Tentar de novo', onPress: () => list.refetch() }}
    />
  ) : list.isLoading ? (
    <View accessibilityLabel="Carregando notas">
      {Array.from({ length: 6 }, (_, i) => (
        <NoteSkeleton key={i} />
      ))}
    </View>
  ) : q ? (
    <EmptyState
      icon="magnifyingglass"
      title={`Nada encontrado para «${q}»`}
      hint="Se você já apagou, ainda dá tempo de resgatar."
      action={{ label: 'Buscar na lixeira', onPress: () => router.push('/notes/trash') }}
    />
  ) : filtered ? (
    <EmptyState
      icon="folder"
      title="Nada com esse filtro"
      hint="Essa pasta (ou essa tag) ainda não tem nota nenhuma."
      action={{ label: 'Limpar filtro', onPress: clearFilters }}
    />
  ) : (
    <EmptyState
      icon="note.text"
      title="Nada anotado ainda"
      hint="Escreve aqui em cima — ou manda «anotar: ligar pro dentista» no WhatsApp."
    />
  );

  return (
    <Screen scroll={false} grouped>
      <HeaderActions
        actions={[
          { label: 'Pastas', icon: 'folder', onPress: () => router.push('/notes/folders') },
          { label: 'Nova nota', icon: 'square.and.pencil', onPress: () => router.push('/notes/new') },
        ]}
      />
      <Stack.SearchBar
        placement="automatic"
        placeholder="Buscar nas notas"
        autoCapitalize="none"
        onChangeText={(e) => setTyped(e.nativeEvent.text)}
        onCancelButtonPress={() => setTyped('')}
      />

      <FlashList
        data={notes}
        keyExtractor={(note) => note.id}
        // As pontas do grupo dependem do VIZINHO, não só do item. Sem isto a `FlashList` não
        // redesenha a última linha da página anterior quando a próxima chega: ela guardava o
        // canto arredondado e a hairline entre as páginas nunca aparecia.
        extraData={notes.length}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
      {/* A captura de dois segundos. Fica fixa: é o coração do produto, não vai atrás de FAB. */}
            <View style={styles.quickAdd}>
              <TextField
                value={draft}
                onChangeText={setDraft}
                placeholder="Anotar rápido…"
                returnKeyType="done"
                submitBehavior="submit"
                onSubmitEditing={submitDraft}
                accessibilityLabel="Nova nota rápida"
                style={styles.grow}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Salvar nota"
                accessibilityState={{ disabled: !draft.trim(), busy: save.isPending }}
                disabled={!draft.trim() || save.isPending}
                onPress={submitDraft}
                style={({ pressed }) => [
                  styles.send,
                  { backgroundColor: theme.backgroundElement, opacity: !draft.trim() || pressed ? 0.5 : 1 },
                ]}>
                <Icon name="arrow.up" size="md" color="tint" weight="semibold" />
              </Pressable>
            </View>

            {/* Usuário novo não vê estrutura vazia. */}
            {hasChips ? (
              // Pasta e tag dividem UMA faixa. Empilhadas, somavam a quarta fileira de controle
              // antes de qualquer nota — a tela abria pedindo configuração em vez de mostrar
              // conteúdo. O filete separa os dois filtros sem gastar uma linha inteira.
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chips}
                style={styles.filters}>
                {folders.length > 0 ? (
                  <>
                    <Chip label="Todas" selected={!folderId} onPress={() => setFolderId(undefined)} />
                    {folders.map((folder) => (
                      <Chip
                        key={folder.id}
                        label={`${folder.name} · ${folder.notes_count}`}
                        selected={folderId === folder.id}
                        onPress={() =>
                          setFolderId(folderId === folder.id ? undefined : folder.id)
                        }
                      />
                    ))}
                  </>
                ) : null}
                {folders.length > 0 && tags.length > 0 ? (
                  <View style={[styles.chipDivider, { backgroundColor: theme.separator }]} />
                ) : null}
                {tags.map((t) => (
                  <Chip
                    key={t.tag}
                    label={`#${t.tag}`}
                    selected={tag === t.tag}
                    onPress={() => setTag(tag === t.tag ? null : t.tag)}
                  />
                ))}
              </ScrollView>
            ) : null}
          </View>
        }
        ListEmptyComponent={empty}
        ListFooterComponent={list.isFetchingNextPage ? <NoteSkeleton /> : null}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
        }}
        renderItem={({ item, index }) => {
          // Fixadas vêm primeiro do banco (`pinned desc`); o rótulo só marca onde o grupo troca.
          const heading =
            index === 0 && item.pinned
              ? 'Fixadas'
              : index > 0 && !item.pinned && notes[index - 1].pinned
                ? 'Notas'
                : null;

          // UM cartão por nota, com respiro entre eles. Agrupadas num cartão só, com fio de
          // cabelo entre as linhas, três notas liam como um parágrafo contínuo — foi a
          // reclamação do usuário ("ridiculamente feio"). Cartão por item é o que Bear, Craft e
          // Keep fazem: custa scroll, devolve legibilidade.
          return (
            <View>
              {heading ? (
                <ThemedText themeColor="textSecondary" style={[Type.caption, styles.heading]}>
                  {heading.toUpperCase()}
                </ThemedText>
              ) : null}
              <View
                style={[
                  styles.group,
                  { backgroundColor: theme.surface, boxShadow: Elevation[scheme].raised },
                ]}>
                <NoteRow
                  note={item}
                  folderName={folderName(item.folder_id)}
                  actions={actions}
                />
              </View>
            </View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: {
    flex: 1,
  },
  quickAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    paddingBottom: Space.lg,
  },
  send: {
    width: HitTarget,
    height: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
  list: {
    paddingBottom: Space.xxxl,
  },
  filters: {
    paddingBottom: Space.lg,
  },
  chipDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginHorizontal: Space.xs,
  },
  group: {
    marginHorizontal: Space.lg,
    marginBottom: Space.sm,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  chips: {
    gap: Space.sm,
    paddingHorizontal: Space.lg,
  },
  row: {
    // `sm` entre título, prévia e metadado: com `xs` as três linhas colavam e a nota inteira
    // lia como um parágrafo só.
    gap: Space.sm,
    minHeight: HitTarget,
    paddingVertical: Space.lg,
    paddingHorizontal: Space.lg,
  },
  rowTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  heading: {
    letterSpacing: 0.6,
    paddingTop: Space.xl,
    paddingBottom: Space.sm,
    paddingHorizontal: Space.lg,
  },
});
