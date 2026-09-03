import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import * as Haptics from 'expo-haptics';
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderActions, type HeaderAction } from '@/components/ui/header-actions';
import { TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { HitTarget, Motion, Radius, Space, Type } from '@/design/tokens';
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
import { relativeBR } from '@/lib/dates';
import {
  addTag,
  isValidTag,
  normalizeTag,
  noteTitle,
  normalizeFolderName,
  removeTag,
  tagsOf,
  toggleChecklistLine,
} from '@/lib/search';
import { showItemActions } from '@/lib/item-actions';
import { noteBlocks, setBlockKind, lineAt, type BlockKind } from '@/lib/note-blocks';
import { skipReason } from '@/lib/notes-autosave';

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
  /** Onde o cursor está, em caracteres. Só a barra de blocos lê — não precisa re-renderizar. */
  const cursorRef = useRef(0);
  const inputRef = useRef<TextInput>(null);
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
    const { content: text, folderId: folder } = latest.current;
    // A decisão "pode gravar?" mora em `skipReason` (`src/lib/notes-autosave.ts`), com teste: é
    // o caminho que já perdeu dado do usuário uma vez, e um `if` a menos aqui apaga uma nota.
    const skip = skipReason({
      hydrated: hydrated.current,
      trashed: trashed.current,
      id: idRef.current,
      text,
      folderId: folder,
      persisted: persisted.current,
    });
    if (skip) {
      if (__DEV__ && skip === 'would-empty') {
        console.warn('[nota] autosave bloqueado: estado vazio sobre nota com texto.');
      }
      return;
    }
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

  const onTogglePin = () => {
    const id = savedId;
    if (!id || !note.data) return;
    // O botão do toolbar nativo tem o próprio press-in; a mola que existia aqui animava um
    // `Pressable` nosso que não existe mais.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

  /**
   * Só AÇÃO fica no header. O "Salvo" era um texto que aparecia e sumia dentro da pílula de
   * vidro do iOS 26 — a pílula mudava de largura sozinha a cada autosave. Ele desceu para a
   * barra de propriedades, junto do resto do metadado.
   */
  const pinned = !!note.data?.pinned;
  const headerActions: HeaderAction[] = [
    ...(creating
      ? []
      : [
          {
            label: pinned ? 'Desafixar nota' : 'Fixar nota',
            icon: pinned ? ('pin.fill' as const) : ('pin' as const),
            selected: pinned,
            onPress: onTogglePin,
          },
        ]),
    { label: 'Mais ações', icon: 'ellipsis.circle' as const, onPress: onMenu },
  ];

  // O título da nota vive no CORPO (decisão de anatomia, ver `ReadBody`). Repeti-lo aqui era o
  // "título duplicado" que o usuário apontou.
  const screenTitle = creating ? 'Nova nota' : 'Nota';

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

  /**
   * Converte a linha do cursor no tipo escolhido.
   *
   * Mantém o foco no campo: perder o teclado a cada toque na barra transformaria "formatar
   * enquanto escrevo" em "formatar, reabrir, continuar" — que é a diferença entre uma barra de
   * blocos e um menu.
   */
  const aplicarBloco = (kind: BlockKind) => {
    Haptics.selectionAsync();
    setContent((atual) => {
      const linha = lineAt(atual, cursorRef.current);
      return linha < 0 ? atual : setBlockKind(atual, linha, kind);
    });
    inputRef.current?.focus();
  };

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ title: screenTitle }} />
      <HeaderActions actions={headerActions} />

      <KeyboardAwareScrollView
        bottomOffset={Space.xxl}
        // `flexGrow` para o corpo ocupar a tela inteira mesmo com duas linhas de texto: é o que
        // transforma os 70% em branco de uma nota curta em área de toque, em vez de vazio morto.
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

          {savedFlash ? (
            <Animated.View
              entering={FadeIn.duration(Motion.duration.fast)}
              exiting={FadeOut.duration(Motion.duration.exit)}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Salvo
              </ThemedText>
            </Animated.View>
          ) : note.data ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              {note.data.source === 'whatsapp' ? 'via WhatsApp' : 'no app'} ·{' '}
              {relativeBR(note.data.updated_at)}
            </ThemedText>
          ) : null}
        </View>

        {note.isLoading ? (
          <View style={styles.loading}>
            <Skeleton width="70%" height={Type.title2.lineHeight} />
            <Skeleton width="100%" height={Type.body.lineHeight} />
            <Skeleton width="90%" height={Type.body.lineHeight} />
            <Skeleton width="45%" height={Type.body.lineHeight} />
          </View>
        ) : editing ? (
          <TextInput
            ref={inputRef}
            value={content}
            onChangeText={setContent}
            multiline
            autoFocus
            scrollEnabled={false}
            selection={selection}
            onSelectionChange={(e) => {
              // O cursor é guardado para a barra de blocos saber em QUE linha aplicar. Sem isto
              // ela só poderia agir na última linha, e converter um bloco do meio da nota
              // exigiria descer até o fim e voltar.
              cursorRef.current = e.nativeEvent.selection.start;
              setSelection(undefined);
            }}
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

      {/*
        A barra fica GRUDADA no teclado, não dentro do scroll.

        Dentro do scroll ela nunca aparecia: o `TextInput` de edição tem `flexGrow: 1`, então ele
        come toda a altura disponível e empurra a barra para fora da tela — verificado no
        emulador, a barra existia na árvore e ficava abaixo da dobra. `KeyboardStickyView` a
        prende logo acima do teclado, que é onde Apple Notes, Bear e Things põem a mesma coisa;
        o `KeyboardAwareScrollView` continua responsável por manter o cursor visível acima dela.
      */}
      {editing ? (
        <KeyboardStickyView>
          <View style={styles.blockBarWrap}>
            <BlockBar onPick={aplicarBloco} />
          </View>
        </KeyboardStickyView>
      ) : null}

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
 * Modo leitura.
 *
 * A anatomia é a do Apple Notes e foi decidida com o usuário: **a primeira linha é o título, e
 * ela vive no CORPO** — o header ficou com "Nota" e as ações. Antes as duas coisas apareciam:
 * o header mostrava `noteTitle(content)` e o corpo renderizava todas as linhas, inclusive a
 * primeira. A pessoa lia a mesma frase duas vezes, com 40px de distância.
 *
 * `readLines` (`src/lib/search.ts`) resolve título, `#tag` e linha vazia — com teste. Aqui só
 * sobra desenho: hierarquia por peso (22/600 no título, 17/400 no corpo), `Space.sm` entre
 * linhas e um alvo de toque que cobre o vazio.
 */
/**
 * O corpo da nota em modo LEITURA, bloco a bloco.
 *
 * Antes ele conhecia dois tipos — título e item marcável — e mandava todo o resto para parágrafo.
 * Agora desenha os oito de `lib/note-blocks.ts`: cabeçalho, subtítulo, item marcável, item de
 * lista, item numerado, citação, divisória e parágrafo. A marcação (`#`, `- [ ]`, `>`) some da
 * tela; ela continua existindo só no texto, que é o que volta para o WhatsApp.
 *
 * Um `Pressable` só por fora, com altura mínima: nota curta deixava 70% da tela em branco sem
 * affordance nenhuma. O vazio É a área de edição — tocar em qualquer ponto abre o teclado, que é
 * o comportamento do Apple Notes. A exceção é a caixinha do item marcável, que ganha o gesto para
 * si e NÃO entra em edição.
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
  const blocos = noteBlocks(content);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        blocos.length === 0 ? 'Escrever na nota' : 'Conteúdo da nota. Toque para editar.'
      }
      onPress={onEdit}
      style={styles.readBody}>
      {blocos.length === 0 ? (
        <ThemedText type="subtitle" themeColor="textSecondary">
          Escreve alguma coisa…
        </ThemedText>
      ) : (
        blocos.map((b) => {
          if (b.kind === 'divider') {
            return (
              <View
                key={b.index}
                style={[styles.divider, { backgroundColor: theme.separator }]}
              />
            );
          }

          if (b.kind === 'todo') {
            return (
              <View key={b.index} style={styles.checkLine}>
                {/* Caixinha pequena, alvo de toque ≥ 44 pelo hitSlop. */}
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: !!b.done }}
                  accessibilityLabel={b.text}
                  hitSlop={12}
                  onPress={() => onToggleLine(b.index)}>
                  <Animated.View
                    key={b.done ? 'on' : 'off'}
                    entering={FadeIn.duration(Motion.duration.fast)}>
                    <Icon
                      name={b.done ? 'checkmark.circle.fill' : 'circle'}
                      size="lg"
                      color={b.done ? 'tint' : 'textSecondary'}
                    />
                  </Animated.View>
                </Pressable>
                <ThemedText
                  style={[
                    Type.body,
                    styles.grow,
                    { color: b.done ? theme.textSecondary : theme.text },
                    b.done && styles.done,
                  ]}>
                  {b.text}
                </ThemedText>
              </View>
            );
          }

          if (b.kind === 'bullet' || b.kind === 'numbered') {
            return (
              <View key={b.index} style={styles.listLine}>
                {/* Marcador em mono para os números ficarem na mesma coluna. */}
                <ThemedText type="code" themeColor="textSecondary" style={styles.marker}>
                  {b.kind === 'numbered' ? `${b.order ?? 1}.` : '•'}
                </ThemedText>
                <ThemedText style={[Type.body, styles.grow]}>{b.text}</ThemedText>
              </View>
            );
          }

          if (b.kind === 'quote') {
            return (
              <View key={b.index} style={styles.quoteLine}>
                <View style={[styles.quoteBar, { backgroundColor: theme.tint }]} />
                <ThemedText
                  themeColor="textSecondary"
                  style={[Type.body, styles.grow, styles.quoteText]}>
                  {b.text}
                </ThemedText>
              </View>
            );
          }

          return (
            <ThemedText
              key={b.index}
              type={b.kind === 'title' || b.kind === 'h1' ? 'subtitle' : b.kind === 'h2' ? 'headline' : 'default'}
              style={b.kind === 'title' || b.kind === 'h1' ? styles.readTitle : undefined}>
              {b.text}
            </ThemedText>
          );
        })
      )}
    </Pressable>
  );
}

/**
 * A barra de blocos — o "digite / para inserir" do Notion, em forma de barra.
 *
 * Ela existe porque a marcação sozinha exige que a pessoa **saiba** markdown. O toque converte a
 * linha em que o cursor está, e tocar de novo no mesmo tipo desfaz (`setBlockKind` trata isso) —
 * sem o desfazer, virar citação seria beco sem saída.
 *
 * Só aparece em edição, e some junto com o teclado: em leitura ela seria uma fileira de botões
 * sobre um texto que ninguém está editando.
 */
const BLOCOS: { kind: BlockKind; icon: React.ComponentProps<typeof Icon>['name']; label: string }[] = [
  { kind: 'h1', icon: 'textformat.size', label: 'Título' },
  { kind: 'todo', icon: 'checkmark.circle', label: 'Item marcável' },
  { kind: 'bullet', icon: 'list.bullet', label: 'Lista' },
  { kind: 'numbered', icon: 'list.number', label: 'Lista numerada' },
  { kind: 'quote', icon: 'text.quote', label: 'Citação' },
  { kind: 'divider', icon: 'minus', label: 'Divisória' },
];

function BlockBar({ onPick }: { onPick: (kind: BlockKind) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.blockBar, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      {BLOCOS.map((b) => (
        <Pressable
          key={b.kind}
          accessibilityRole="button"
          accessibilityLabel={b.label}
          hitSlop={6}
          onPress={() => onPick(b.kind)}
          style={({ pressed }) => [
            styles.blockButton,
            { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
          ]}>
          <Icon name={b.icon} size="md" color="text" />
        </Pressable>
      ))}
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
  const known = useNoteTags();
  const [draft, setDraft] = useState('');

  const typed = normalizeTag(draft);
  const existing = (known.data ?? []).map((t) => t.tag);
  const options = Array.from(new Set([...existing, ...current])).sort();
  const shown = typed ? options.filter((t) => t.includes(typed)) : options;
  const canCreate = isValidTag(typed) && !options.includes(typed);

  return (
    <Sheet visible={visible} onClose={onClose}>
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
    </Sheet>
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
    <Sheet visible={visible} onClose={onClose}>
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
    </Sheet>
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
    flexGrow: 1,
  },
  /**
   * `rowGap` curto de propósito: no iPhone os chips + "via WhatsApp · há 1 h" não cabem numa
   * linha e o metadado quebra. Com o mesmo `gap` nos dois eixos ele caía no meio do caminho entre
   * os chips e o título e lia como linha órfã — que foi a queixa. Colado nos chips (4px) ele vira
   * a última linha do mesmo bloco; o respiro grande fica só antes do título.
   */
  props: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: Space.sm,
    rowGap: Space.xs,
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
    flexGrow: 1,
  },
  /**
   * `minHeight` casa com o do `TextInput` da edição: sem isso o corpo "encolhe" no instante em
   * que a nota sai de edição para leitura, e o dedo persegue o texto que se moveu.
   */
  readBody: {
    gap: Space.sm,
    minHeight: 280,
    flexGrow: 1,
  },
  /** Título respira mais que a distância entre linhas do corpo — é o que o separa do texto. */
  readTitle: {
    marginBottom: Space.xs,
  },
  loading: {
    gap: Space.md,
  },
  checkLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
  },
  listLine: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm },
  /** Largura fixa: sem ela "1." e "10." desalinham o texto da lista. */
  marker: { width: 22, textAlign: 'right', lineHeight: Type.body.lineHeight },
  quoteLine: { flexDirection: 'row', alignItems: 'stretch', gap: Space.md },
  quoteBar: { width: 3, borderRadius: Radius.xs },
  quoteText: { fontStyle: undefined },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Space.sm },
  blockBarWrap: { paddingHorizontal: Space.lg, paddingBottom: Space.sm },
  blockBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    gap: Space.xs,
    padding: Space.xs,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  blockButton: {
    width: HitTarget - 4,
    height: HitTarget - 8,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
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
