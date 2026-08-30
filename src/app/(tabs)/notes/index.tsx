import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { Chip } from '@/components/finance/chip';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderActions } from '@/components/ui/header-actions';
import { ItemLink } from '@/components/ui/item-link';
import { Search } from '@/components/ui/search';
import { TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Mark } from '@/components/ui/mark';
import { Screen } from '@/components/ui/screen';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { HitTarget, Radius, Space, Type, tabular } from '@/design/tokens';
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
import { noteTitle, notePreview, parseChecklist } from '@/lib/search';
import { relativeBR } from '@/lib/dates';

/**
 * `typedRoutes`: `trash.tsx` ainda não existe como arquivo, então o typegen não conhece a rota
 * (o `_layout` já a declara). Cast pontual e greppável — some quando o arquivo nascer.
 */


/**
 * A lista de notas TINHA uma paleta própria (`NOTE_SKIN`): fundo `#0F0F12`, superfície `#1C1C26`
 * e um accent violeta `#8B5CF6` que não existe em `Colors`.
 *
 * Ela forçava dark mesmo no tema claro — a aba inteira lia como se fosse de outro app — e
 * violava duas contagens da regra §10 de uma vez (hex hardcoded e um segundo accent). O cartão
 * outlined e a densidade que ela introduziu eram bons e ficam; o que sai é a cor inventada.
 *
 * Agora tudo vem de `useTheme()`. Raio e padding vêm da escala (`Radius.md`, `Space.lg`): o 14
 * de antes estava fora dela.
 */

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
  // Dynamic Type XL: a prévia cai para uma linha para os metadados não sumirem da tela.
  const { fontScale } = useWindowDimensions();
  const theme = useTheme();

  const title = noteTitle(note.content) || 'Sem título';
  const preview = notePreview(note.content);
  const checklist = parseChecklist(note.content);
  const done = checklist.filter((item) => item.done).length;
  // Tag com o mesmo nome da pasta não vira metadado: `mercado · #mercado` gasta a linha
  // inteira para dizer a mesma coisa duas vezes.
  const tags = (note.tags ?? []).filter(
    (tag) => tag.toLowerCase() !== folderName?.toLowerCase()
  );

  const checklistLabel = checklist.length > 0 ? `${done}/${checklist.length}` : null;
  const quando = relativeBR(note.updated_at);

  const label = [
    title,
    folderName ? `pasta ${folderName}` : null,
    tags.length > 0 ? `${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}` : null,
    checklistLabel ? `${done} de ${checklist.length} itens feitos` : null,
    note.source === 'whatsapp' ? 'via WhatsApp' : null,
    `atualizada ${quando}`,
    note.pinned ? 'fixada' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <ItemLink
      href={`/notes/${note.id}`}
      title={title}
      actions={[
        {
          label: note.pinned ? 'Desafixar' : 'Fixar',
          icon: note.pinned ? 'pin.slash' : 'pin',
          onPress: () => actions.onPin(note),
        },
        {
          label: 'Mover para pasta',
          icon: 'folder',
          actions: [
            {
              label: 'Sem pasta',
              icon: 'tray',
              selected: !note.folder_id,
              onPress: () => actions.onMove(note, null),
            },
            ...actions.folders.map((folder) => ({
              label: folder.name,
              selected: note.folder_id === folder.id,
              onPress: () => actions.onMove(note, folder.id),
            })),
          ],
        },
        { label: 'Lixeira', icon: 'trash', destructive: true, onPress: () => actions.onTrash(note) },
      ]}>
      {({ onLongPress }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onLongPress={onLongPress}
          style={styles.press}>
          {({ pressed }) => (
          <View
            style={[
              styles.card,
              {
                backgroundColor: pressed ? theme.backgroundSelected : theme.surface,
                borderColor: theme.separator,
              },
            ]}>
          {/* Título e pin dividem a primeira linha: o pin fica no canto do cartão (padrão do
              Keep), não como bullet antes do texto — ali ele lia como marcador de lista. */}
          <View style={styles.cardHead}>
            <ThemedText type="headline" numberOfLines={2} style={styles.grow}>
              {title}
            </ThemedText>
            {note.pinned ? <Icon name="pin.fill" size="sm" color="tint" /> : null}
          </View>

          {preview ? (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              numberOfLines={fontScale >= 1.4 ? 1 : 2}>
              {preview}
            </ThemedText>
          ) : null}

          {/* Faixa de metadados com FORMA, não string corrida: pasta é pill, checklist é ícone
              + contagem, origem é ícone, e a data vai encostada à direita — como em Apple Notes,
              onde o "quando" é o segundo campo mais consultado depois do título. */}
          <View style={styles.cardMeta}>
            {folderName ? (
              <View style={[styles.folderPill, { backgroundColor: theme.accentSoft }]}>
                <ThemedText
                  numberOfLines={1}
                  themeColor="tint"
                  style={styles.folderPillText}>
                  {folderName}
                </ThemedText>
              </View>
            ) : null}

            {checklistLabel ? (
              <View style={styles.metaBit}>
                <Icon name="checkmark.circle" size={13} color="textSecondary" />
                <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
                  {checklistLabel}
                </ThemedText>
              </View>
            ) : null}

            {/*
              A espiral marca o que a IA registrou — o quinto papel previsto em `design.md` §2b,
              e o que estava faltando desde que a tela de Atividade saiu.

              Era um balão de conversa genérico. O balão diz "veio de um chat"; a marca diz "isto
              entrou pelo ProOps", que é a informação que importa e a única que ninguém mais pode
              desenhar. Mesma forma da abertura, do spinner e do estado vazio.
            */}
            {note.source === 'whatsapp' ? (
              <View style={styles.metaBit}>
                <Mark size={13} color="textSecondary" />
                <ThemedText type="caption" themeColor="textSecondary">
                  WhatsApp
                </ThemedText>
              </View>
            ) : null}

            <ThemedText
              type="caption"
              themeColor="textSecondary"
              style={[styles.quando, tabular]}>
              {quando}
            </ThemedText>
          </View>
          </View>
          )}
        </Pressable>
      )}
    </ItemLink>
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
            {/* No Android o campo mora aqui, acima da captura rápida; no iOS o `Search` não
                desenha nada e a busca vai para o header nativo. */}
            <Search
              gutter
              value={typed}
              onChangeText={setTyped}
              placeholder="Buscar nas notas"
              accessibilityLabel="Buscar nas notas"
            />

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
                  {
                    backgroundColor: draft.trim() ? theme.tint : theme.backgroundElement,
                    opacity: pressed ? 0.5 : 1,
                  },
                ]}>
                {/*
                  `onTint`, nunca `text`: a pílula é pintada de `tint`, que é TINTA (quase-preto
                  no claro). Com `text` a seta saía preta sobre preto — o botão virava um disco
                  cego no tema claro. Desabilitado perde a cor em vez de perder opacidade, que é
                  a mesma régua do `Button`.
                */}
                <Icon
                  name="arrow.up"
                  size="md"
                  color={draft.trim() ? 'onTint' : 'textSecondary'}
                  weight="semibold"
                />
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

          // UM cartão por nota. Agrupadas num cartão só, com fio de cabelo entre as linhas,
          // três notas liam como um parágrafo contínuo. Cartão por item é o que Keep e Bear
          // fazem: custa scroll, devolve legibilidade.
          //
          // O cartão é o PRÓPRIO `NoteRow` (o padding vive lá dentro): pôr o padding aqui e o
          // Pressable lá dentro deixava a área de toque menor que o cartão — dava para tocar na
          // borda e nada acontecer.
          return (
            <View style={styles.item}>
              {heading ? (
                <ThemedText type="caption" themeColor="textSecondary" style={styles.heading}>
                  {heading.toUpperCase()}
                </ThemedText>
              ) : null}
              <NoteRow
                note={item}
                folderName={folderName(item.folder_id)}
                actions={actions}
              />
            </View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  /** M3: padding 16 · raio 14 · 8 entre cards. `gap` 6 dentro — título, prévia e metadado são
      três degraus da MESMA nota, não três blocos. */
  /** M3: 8 entre cards empilhados. O recuo lateral é o mesmo do resto da tela. */
  item: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.sm,
  },
  /**
   * O cartão é uma `View` DENTRO do `Pressable`, não o próprio `Pressable`.
   *
   * `<Link asChild>` + `<Link.Trigger>` engolem o `style` do filho: padding e fundo postos no
   * `Pressable` simplesmente não aparecem — foi assim que o cartão ficou invisível e o texto
   * colado na borda. A `View` interna está fora do alcance disso.
   */
  press: {
    minHeight: HitTarget,
  },
  card: {
    gap: Space.xs + 2,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    // Cartão OUTLINED, não elevated: quem desenha a borda é a hairline, não a sombra.
    // É o que Linear e Notion fazem, e funciona nos dois temas — a cor vem do `theme.separator`
    // aplicado inline, porque `StyleSheet.create` não enxerga o tema.
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    marginTop: 2,
  },
  /** Pasta é LUGAR: ganha pill no accent suave. Origem e checklist são fatos: ficam em texto. */
  folderPill: {
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
    borderRadius: Radius.xs,
    borderCurve: 'continuous',
    maxWidth: 130,
  },
  folderPillText: {
    ...Type.caption,
    fontWeight: '600',
  },
  metaBit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  /** Encostada à direita: a data é a âncora que faz as linhas lerem como coluna. */
  quando: {
    marginLeft: 'auto',
  },
  grow: {
    flex: 1,
  },
  pinDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
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
  /** Mesma etiqueta do `Section` — token `Type.meta`, não tracking à mão. */
  heading: {
    ...Type.meta,
    marginTop: Space.xl,
    marginBottom: Space.sm,
  },
});
