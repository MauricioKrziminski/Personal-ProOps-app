import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import * as Haptics from 'expo-haptics';
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { Motion, Radius, Space, Type } from '@/design/tokens';
import {
  useNote,
  useNoteFolders,
  useSaveFolder,
  useSaveNote,
  useToggleNotePin,
  useTrashNote,
  type NoteFolder,
  useNoteTags,
} from '@/hooks/use-notes';
import { useTheme } from '@/hooks/use-theme';
import { formatDateBR } from '@/lib/dates';
import {
  addTag,
  isValidTag,
  normalizeTag,
  noteTitle,
  normalizeFolderName,
  parseChecklist,
  removeTag,
  tagsOf,
  toggleChecklistLine,
} from '@/lib/search';
import { showItemActions } from '@/lib/item-actions';

/**
 * Nota (detalhe) — e também a tela de CRIAÇÃO (`id === 'new'`).
 *
 * Autosave com debounce de 800 ms + no blur + no back. Em criação o **primeiro** autosave é que
 * insere a linha; criar a linha vazia ao abrir está rejeitado no documento (piscaria uma nota em
 * branco na lista de todo mundo via realtime).
 *
 * O corpo tem dois modos: leitura (com o toggle de checklist na margem) e edição (`TextInput`
 * multiline, cursor no FIM). Toggle de checklist NÃO entra em edição — só reescreve aquela linha.
 * A alternativa, desenhar o toggle por cima do `TextInput`, exigiria medir cada linha renderizada
 * — e erra em toda linha que quebra.
 */

const AUTOSAVE_MS = 800;

/** `note_folders.icon` é texto livre no banco; aqui vira nome de SF Symbol com queda para `folder`. */
function symbol(icon: string | null | undefined): SymbolViewProps['name'] {
  return (icon ?? 'folder') as SymbolViewProps['name'];
}

function relativeBR(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  return formatDateBR(iso);
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

export default function NoteDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const toast = useToast();

  const note = useNote(params.id);
  const folders = useNoteFolders();
  const save = useSaveNote();
  const togglePin = useToggleNotePin();
  const trash = useTrashNote();

  const [content, setContent] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [editing, setEditing] = useState(() => params.id === 'new');
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  /** Fonte da verdade do autosave: `null` até o primeiro insert. Não espera o `setParams`. */
  const idRef = useRef<string | null>(params.id === 'new' ? null : params.id);
  /** Espelho do `idRef` para a renderização — ref não pode ser lida durante o render. */
  const [savedId, setSavedId] = useState<string | null>(params.id === 'new' ? null : params.id);
  /** Em criação já nasce hidratado: o fetch que vem DEPOIS do insert não pode pisar no digitado. */
  const hydrated = useRef(params.id === 'new');
  const persisted = useRef<{ content: string; folderId: string | null } | null>(null);
  const saving = useRef(false);
  const dirty = useRef(false);
  const trashed = useRef(false);
  const latest = useRef({ content, folderId });
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hydrated.current || !note.data) return;
    hydrated.current = true;
    setContent(note.data.content);
    setFolderId(note.data.folder_id);
    persisted.current = { content: note.data.content, folderId: note.data.folder_id };
  }, [note.data]);

  const flashSaved = () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setSavedFlash(true);
    flashTimer.current = setTimeout(() => setSavedFlash(false), 1500);
  };

  /** Não memoizada de propósito: só é chamada por `flushRef`, por efeito ou por handler. */
  async function flush() {
    if (trashed.current) return;
    // Antes da hidratação `content` é '' — salvar aqui APAGARIA a nota que ainda está carregando.
    // (Em modo criação `hydrated` já nasce true.)
    if (!hydrated.current) return;
    const { content: text, folderId: folder } = latest.current;
    const last = persisted.current;
    if (last && last.content === text && last.folderId === folder) return;
    // Nota em branco nunca é inserida — é exatamente a "nota vazia piscando na lista".
    if (!idRef.current && text.trim() === '') return;
    // E nunca ESVAZIA uma nota que já tinha texto. Aconteceu em 28/08: uma nota do WhatsApp
    // voltou do detalhe com `content` vazio. O `hydrated` sozinho não bastou — qualquer caminho
    // que chegue aqui com texto vazio e conteúdo persistido não-vazio é bug, não intenção.
    // Apagar nota é a Lixeira, que perdoa; autosave silencioso não.
    if (idRef.current && text.trim() === '' && (last?.content ?? '').trim() !== '') return;
    // Salvamento em voo: marca sujo e reenfileira no settle, para não inserir duas vezes.
    if (saving.current) {
      dirty.current = true;
      return;
    }

    saving.current = true;
    try {
      const id = await save.mutateAsync({
        id: idRef.current ?? undefined,
        content: text,
        folder_id: folder,
      });
      const created = !idRef.current;
      idRef.current = id;
      persisted.current = { content: text, folderId: folder };
      if (created) {
        setSavedId(id);
        router.setParams({ id });
      }
      flashSaved();
    } catch {
      // O texto CONTINUA na tela: o próximo autosave tenta de novo com o mesmo conteúdo.
      toast({ message: 'Não deu para salvar agora — o texto continua aqui.', tone: 'error' });
    } finally {
      saving.current = false;
      if (dirty.current) {
        dirty.current = false;
        void flush();
      }
    }
  }

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
    latest.current = { content, folderId };
  });

  // Debounce.
  useEffect(() => {
    const timer = setTimeout(() => void flushRef.current(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [content, folderId]);

  // Back / desmontagem: salva o que estiver pendente. É por isso que não existe "descartar?".
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      void flushRef.current();
    },
    []
  );

  const creating = savedId === null;
  const tags = useMemo(() => tagsOf(content), [content]);
  const folder = folders.data?.find((f) => f.id === folderId);

  const pinScale = useSharedValue(1);
  const pinStyle = useAnimatedStyle(() => ({ transform: [{ scale: pinScale.get() }] }));

  const onTogglePin = () => {
    const id = savedId;
    if (!id || !note.data) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pinScale.set(
      withSequence(
        withTiming(1.25, { duration: Motion.duration.fast }),
        withTiming(1, { duration: Motion.duration.fast })
      )
    );
    togglePin.mutate(
      { id, pinned: !note.data.pinned },
      { onError: () => toast({ message: 'Não deu para fixar a nota.', tone: 'error' }) }
    );
  };

  const onTrash = () => {
    const id = savedId;
    if (!id) {
      router.back();
      return;
    }
    actionSheet(
      {
        title: noteTitle(content) || 'Esta nota',
        message: 'Fica na lixeira por 30 dias — dá para restaurar.',
        options: ['Mandar para a lixeira'],
        destructiveIndex: 0,
      },
      () => {
        trashed.current = true;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        trash.mutate(id, {
          onError: () => {
            trashed.current = false;
            toast({ message: 'Não deu para mandar para a lixeira.', tone: 'error' });
          },
        });
        router.back();
      }
    );
  };

  const onMenu = () => {
    Haptics.selectionAsync();
    actionSheet(
      {
        title: noteTitle(content) || 'Nova nota',
        options: ['Mover para pasta', 'Criar lembrete', 'Mandar para a lixeira'],
        destructiveIndex: 2,
      },
      (index) => {
        if (index === 0) setPickerOpen(true);
        if (index === 1) {
          void flushRef.current();
          router.push({
            pathname: '/reminder-form',
            params: { title: noteTitle(content) },
          });
        }
        if (index === 2) onTrash();
      }
    );
  };

  const startEditing = () => {
    setSelection({ start: content.length, end: content.length });
    setEditing(true);
  };

  const onToggleLine = (lineIndex: number) => {
    Haptics.selectionAsync();
    setContent((current) => toggleChecklistLine(current, lineIndex));
  };

  const headerRight = () => (
    <View style={styles.headerRight}>
      {savedFlash ? (
        <Animated.View
          entering={FadeIn.duration(Motion.duration.fast)}
          exiting={FadeOut.duration(Motion.duration.exit)}>
          <ThemedText type="footnote" themeColor="textSecondary">
            Salvo
          </ThemedText>
        </Animated.View>
      ) : null}

      {creating ? null : (
        <Animated.View style={pinStyle}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={note.data?.pinned ? 'Desafixar nota' : 'Fixar nota'}
            accessibilityState={{ selected: !!note.data?.pinned }}
            hitSlop={12}
            onPress={onTogglePin}>
            <Icon
              name={note.data?.pinned ? 'pin.fill' : 'pin'}
              size="lg"
              color={note.data?.pinned ? 'tint' : 'textSecondary'}
            />
          </Pressable>
        </Animated.View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Mais ações"
        hitSlop={12}
        onPress={onMenu}>
        <Icon name="ellipsis.circle" size="lg" color="tint" />
      </Pressable>
    </View>
  );

  const screenTitle = creating ? 'Nova nota' : noteTitle(content).slice(0, 60) || 'Nota';

  if (note.isError) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Nota' }} />
        <Card>
          <View style={styles.errorCard}>
            <Icon name="exclamationmark.triangle" size="xl" color="danger" />
            <ThemedText type="smallBold">Não achei essa nota</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              Ela pode ter ido para a lixeira em outro aparelho.
            </ThemedText>
            <View style={styles.errorActions}>
              <Button label="Tentar de novo" variant="secondary" size="sm" onPress={() => note.refetch()} />
              <Button label="Voltar para as notas" size="sm" onPress={() => router.back()} />
            </View>
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ title: screenTitle, headerRight }} />

      <KeyboardAwareScrollView
        bottomOffset={Space.xxl}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic">
        {/* Barra de propriedades: só a pasta é editável — tag se edita digitando `#` no corpo. */}
        <View style={styles.props}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Pasta: ${folder?.name ?? 'sem pasta'}. Toque para mudar.`}
            hitSlop={8}
            onPress={() => {
              Haptics.selectionAsync();
              setPickerOpen(true);
            }}
            style={[styles.chip, { backgroundColor: theme.accentSoft }]}>
            <Icon name={symbol(folder?.icon)} size="sm" color="tint" />
            <ThemedText type="smallBold" themeColor="tint">
              {folder?.name ?? 'Sem pasta'}
            </ThemedText>
          </Pressable>

          {tags.map((tag) => (
            <Pressable
              key={tag}
              accessibilityRole="button"
              accessibilityLabel={`Tag ${tag}. Toque para tirar da nota.`}
              hitSlop={6}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setContent((current) => removeTag(current, tag));
              }}
              style={[styles.tagChip, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="footnote">#{tag}</ThemedText>
              <Icon name="xmark" size={12} color="textSecondary" />
            </Pressable>
          ))}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Adicionar tag"
            hitSlop={6}
            onPress={() => {
              Haptics.selectionAsync();
              setTagPickerOpen(true);
            }}
            style={[styles.tagChip, { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.separator }]}>
            <Icon name="plus" size={12} color="tint" />
            <ThemedText type="footnote" themeColor="tint">
              tag
            </ThemedText>
          </Pressable>

          {note.data ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              {note.data.source === 'whatsapp' ? 'via WhatsApp' : 'no app'} ·{' '}
              {relativeBR(note.data.updated_at)}
            </ThemedText>
          ) : null}
        </View>

        {note.isLoading ? (
          <View style={styles.loading}>
            <Skeleton width="70%" height={Type.body.lineHeight} />
            <Skeleton width="100%" height={Type.body.lineHeight} />
            <Skeleton width="90%" height={Type.body.lineHeight} />
            <Skeleton width="45%" height={Type.body.lineHeight} />
          </View>
        ) : editing ? (
          <TextInput
            value={content}
            onChangeText={setContent}
            multiline
            autoFocus
            scrollEnabled={false}
            selection={selection}
            onSelectionChange={() => setSelection(undefined)}
            onBlur={() => {
              setEditing(false);
              void flushRef.current();
            }}
            placeholder="Escreve alguma coisa…"
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel="Conteúdo da nota"
            textAlignVertical="top"
            style={[Type.body, styles.input, { color: theme.text }]}
          />
        ) : (
          <ReadBody content={content} onEdit={startEditing} onToggleLine={onToggleLine} />
        )}
      </KeyboardAwareScrollView>

      <TagPicker
        visible={tagPickerOpen}
        current={tags}
        onClose={() => setTagPickerOpen(false)}
        onToggle={(tag) =>
          setContent((current) =>
            tagsOf(current).includes(tag) ? removeTag(current, tag) : addTag(current, tag)
          )
        }
      />

      <FolderPicker
        visible={pickerOpen}
        current={folderId}
        folders={folders.data ?? []}
        onClose={() => setPickerOpen(false)}
        onPick={(id) => {
          Haptics.selectionAsync();
          setFolderId(id);
          setPickerOpen(false);
        }}
      />
    </Screen>
  );
}

/**
 * Modo leitura: cada linha `- [ ]` / `- [x]` ganha um toggle na margem; o resto é texto que abre
 * a edição no toque, com o cursor no fim.
 */
function ReadBody({
  content,
  onEdit,
  onToggleLine,
}: {
  content: string;
  onEdit: () => void;
  onToggleLine: (index: number) => void;
}) {
  const theme = useTheme();
  const lines = content.split('\n');
  const checks = new Map(parseChecklist(content).map((item) => [item.index, item]));

  if (content.trim() === '') {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Conteúdo da nota" onPress={onEdit}>
        <ThemedText type="default" themeColor="textSecondary" style={Type.body}>
          Escreve alguma coisa…
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <View>
      {lines.map((line, index) => {
        const item = checks.get(index);
        if (!item) {
          return (
            <Pressable key={index} accessibilityRole="button" onPress={onEdit}>
              <ThemedText style={[Type.body, { color: theme.text }]}>{line || ' '}</ThemedText>
            </Pressable>
          );
        }
        return (
          <View key={index} style={styles.checkLine}>
            {/* Caixinha visual pequena, alvo de toque ≥ 44 pelo hitSlop. */}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.done }}
              accessibilityLabel={item.text}
              hitSlop={12}
              onPress={() => onToggleLine(index)}>
              <Animated.View
                key={item.done ? 'on' : 'off'}
                entering={FadeIn.duration(Motion.duration.fast)}>
                <Icon
                  name={item.done ? 'checkmark.circle.fill' : 'circle'}
                  size="lg"
                  color={item.done ? 'tint' : 'textSecondary'}
                />
              </Animated.View>
            </Pressable>
            <Pressable style={styles.grow} accessibilityRole="button" onPress={onEdit}>
              <ThemedText
                style={[
                  Type.body,
                  { color: item.done ? theme.textSecondary : theme.text },
                  item.done && styles.done,
                ]}>
                {item.text || ' '}
              </ThemedText>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

/** Quando o campo de busca deixa de ser ruído e passa a ser necessário. */
const SEARCH_FROM = 8;

/**
 * Seletor de tag.
 *
 * `notes.tags` é coluna GERADA do texto — não dá para escrever nela. Então escolher uma tag aqui
 * **edita o conteúdo**, acrescentando ou tirando o token `#tag`. É o que dá chip de verdade sem
 * quebrar a decisão de origem: a nota continua sendo texto puro que volta inteiro pro WhatsApp.
 *
 * Oferece as tags que já existem no workspace (evita `#mercado` e `#Mercado` virando duas coisas)
 * e deixa criar uma na hora.
 */
function TagPicker({
  visible,
  current,
  onClose,
  onToggle,
}: {
  visible: boolean;
  current: string[];
  onClose: () => void;
  onToggle: (tag: string) => void;
}) {
  const theme = useTheme();
  const known = useNoteTags();
  const [draft, setDraft] = useState('');

  const typed = normalizeTag(draft);
  const existing = (known.data ?? []).map((t) => t.tag);
  const options = Array.from(new Set([...existing, ...current])).sort();
  const shown = typed ? options.filter((t) => t.includes(typed)) : options;
  const canCreate = isValidTag(typed) && !options.includes(typed);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: theme.groupedBackground }]}>
        <View style={styles.sheetHeader}>
          <ThemedText type="smallBold">Tags da nota</ThemedText>
          <Pressable accessibilityRole="button" accessibilityLabel="Fechar" hitSlop={12} onPress={onClose}>
            <ThemedText type="smallBold" themeColor="tint">
              Fechar
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.sheetBody}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <TextField
            value={draft}
            onChangeText={setDraft}
            placeholder="Buscar ou criar tag"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Buscar ou criar tag"
          />

          {canCreate ? (
            <Section>
              <Row
                title={`Criar #${typed}`}
                icon="plus.circle"
                chevron={false}
                onPress={() => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  onToggle(typed);
                  setDraft('');
                }}
              />
            </Section>
          ) : null}

          {shown.length > 0 ? (
            <Section title="Tags">
              {shown.map((tag) => {
                const on = current.includes(tag);
                return (
                  <Row
                    key={tag}
                    title={`#${tag}`}
                    chevron={false}
                    accessibilityState={{ selected: on }}
                    trailing={on ? <Icon name="checkmark" size="md" color="tint" /> : null}
                    onPress={() => {
                      Haptics.selectionAsync();
                      onToggle(tag);
                    }}
                  />
                );
              })}
            </Section>
          ) : !canCreate ? (
            <EmptyState
              icon="tag"
              title="Nenhuma tag ainda"
              hint="Escreve o nome aí em cima — ou digita #assim no corpo da nota."
            />
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * Seletor de pasta.
 *
 * O documento pede uma rota `formSheet` com detents `[0.5, 0.9]`; ela precisaria ser registrada
 * no `_layout.tsx` da aba, que não é desta entrega. `Modal presentationStyle="pageSheet"` dá o
 * sheet nativo com arrasto para cancelar; o que falta é só o ajuste de detent.
 */
function FolderPicker({
  visible,
  current,
  folders,
  onClose,
  onPick,
}: {
  visible: boolean;
  current: string | null;
  folders: NoteFolder[];
  onClose: () => void;
  onPick: (id: string | null) => void;
}) {
  const theme = useTheme();
  const toast = useToast();
  const saveFolder = useSaveFolder();
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState<string | null>(null);

  const visibleFolders = query
    ? folders.filter((f) => f.name.includes(normalizeFolderName(query)))
    : folders;

  const check = (selected: boolean) =>
    selected ? <Icon name="checkmark" size="md" color="tint" /> : null;

  const createAndMove = async () => {
    const name = normalizeFolderName(newName ?? '');
    if (!name) return;
    try {
      // Nome repetido aqui NÃO é erro: o upsert devolve a pasta existente e a nota vai para ela.
      const id = await saveFolder.mutateAsync({ name, icon: 'folder' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNewName(null);
      setQuery('');
      onPick(id);
    } catch {
      toast({ message: 'Não deu para criar a pasta.', tone: 'error' });
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: theme.groupedBackground }]}>
        <View style={styles.sheetHeader}>
          <ThemedText type="smallBold">Mover para</ThemedText>
          <Pressable accessibilityRole="button" accessibilityLabel="Fechar" hitSlop={12} onPress={onClose}>
            <ThemedText type="smallBold" themeColor="tint">
              Fechar
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.sheetBody}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {folders.length > SEARCH_FROM ? (
            <TextField
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar pasta"
              autoCapitalize="none"
              accessibilityLabel="Buscar pasta"
            />
          ) : null}

          <Section>
            <Row
              title="Sem pasta"
              icon="tray"
              chevron={false}
              accessibilityState={{ selected: current === null }}
              trailing={check(current === null)}
              onPress={() => onPick(null)}
            />
            {visibleFolders.map((f) => (
              <Row
                key={f.id}
                title={f.name}
                subtitle={`${f.notes_count} nota${f.notes_count === 1 ? '' : 's'}`}
                icon={symbol(f.icon)}
                chevron={false}
                accessibilityState={{ selected: current === f.id }}
                accessibilityLabel={`${f.name}, ${f.notes_count} notas`}
                trailing={check(current === f.id)}
                onPress={() => onPick(f.id)}
              />
            ))}
            {newName === null ? (
              <Row
                title="Nova pasta…"
                icon="plus.circle"
                chevron={false}
                onPress={() => setNewName('')}
              />
            ) : (
              <View style={styles.newFolder}>
                <TextField
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Nome da pasta"
                  autoCapitalize="none"
                  autoFocus
                  maxLength={40}
                  accessibilityLabel="Nome da nova pasta"
                  onSubmitEditing={() => void createAndMove()}
                />
                <Button
                  label="Criar e mover"
                  size="sm"
                  loading={saveFolder.isPending}
                  onPress={() => void createAndMove()}
                />
              </View>
            )}
          </Section>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Space.lg,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    paddingBottom: Space.xxxl,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
  },
  props: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingVertical: Space.xs,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
  input: {
    minHeight: 280,
  },
  loading: {
    gap: Space.md,
  },
  checkLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
    paddingVertical: Space.xs,
  },
  grow: {
    flex: 1,
  },
  done: {
    textDecorationLine: 'line-through',
  },
  errorCard: {
    alignItems: 'center',
    gap: Space.md,
  },
  errorActions: {
    flexDirection: 'row',
    gap: Space.md,
  },
  centered: {
    textAlign: 'center',
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
  sheet: {
    flex: 1,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Space.lg,
  },
  sheetBody: {
    gap: Space.lg,
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxxl,
  },
  newFolder: {
    gap: Space.md,
    padding: Space.lg,
  },
});
