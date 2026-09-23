import { Stack, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import * as Haptics from 'expo-haptics';
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ColorPicker } from '@/components/notes/color-picker';
import { FolderPicker } from '@/components/notes/folder-picker';
import { FormatBar } from '@/components/notes/format-bar';
import { NoteBody } from '@/components/notes/note-body';
import { TagPicker } from '@/components/notes/tag-picker';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { HeaderActions, type HeaderAction } from '@/components/ui/header-actions';
import { GlassBackdrop, supportsLiquidGlass } from '@/components/ui/glass-backdrop';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { Motion, Radius, Space, Type, tabular } from '@/design/tokens';
import {
  useNote,
  useNoteFolders,
  useUpdateNote,
  useSaveNote,
  useToggleNotePin,
  useTrashNote,
} from '@/hooks/use-notes';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { useNoteReminder } from '@/hooks/use-items';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { noteInk } from '@/design/note-colors';
import { horaBR, localISODate, relativeBR, rotuloDoDia } from '@/lib/dates';
import { addTag, noteTitle, removeTag, tagsOf } from '@/lib/search';
import { showItemActions } from '@/lib/item-actions';
import {
  continuarLista,
  juntarTitulo,
  lineAt,
  separarTitulo,
  setBlockKind,
  toggleTodo,
  type BlockKind,
} from '@/lib/note-blocks';
import { toggleMark, type Mark } from '@/lib/note-inline';
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

/** Chip de 26pt + folga = 44pt de alvo, sem crescer o desenho. */
const CHIP_SLOP = { top: 9, bottom: 9, left: 6, right: 6 };

/** "Amanhã, 09:00" — quando o lembrete da nota toca, no idioma da agenda. */
function quandoToca(iso: string): string {
  const dia = rotuloDoDia(localISODate(new Date(iso)));
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)}, ${horaBR(iso)}`;
}

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
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const params = useLocalSearchParams<{ id: string; folder?: string }>();
  const theme = useTheme();
  const vidro = supportsLiquidGlass();
  const scheme = useScheme();
  const toast = useToast();

  const note = useNote(params.id);
  const folders = useNoteFolders();
  const save = useSaveNote();
  const togglePin = useToggleNotePin();
  const trash = useTrashNote();
  const updateNote = useUpdateNote();

  /**
   * A nota em duas partes — o TÍTULO, com campo próprio (como no Notes do iPhone), e o CORPO.
   * O dado continua sendo um `content` só (`juntarTitulo`): primeira linha = título, que é o que o
   * WhatsApp, a busca e a lista sempre leram.
   */
  const [nota, setNota] = useState({ titulo: '', corpo: '' });
  const content = juntarTitulo(nota.titulo, nota.corpo);
  const tituloRef = useRef<TextInput>(null);
  /**
   * Nota criada de DENTRO de uma pasta já nasce nela (`/notes/new?folder=<id>`).
   *
   * Sem isto, o `+` da tela de uma pasta criava uma nota solta — e a pessoa voltava para a pasta
   * sem encontrar o que acabou de escrever. Em nota existente o parâmetro não existe, e a
   * hidratação sobrescreve este valor com o do banco.
   */
  const [folderId, setFolderId] = useState<string | null>(
    params.id === 'new' ? (params.folder ?? null) : null
  );
  /** O CORPO em edição. Nota nova começa pelo título (é ele que leva o foco), não pelo corpo. */
  const [editing, setEditing] = useState(false);
  /** Onde o cursor está, em caracteres. Só a barra de blocos lê — não precisa re-renderizar. */
  const cursorRef = useRef(0);
  const inputRef = useRef<TextInput>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  /**
   * A seleção VIVA — o que a barra de formatação lê.
   *
   * Diferente de `selection`, que é o prop CONTROLADO e existe só para empurrar o cursor depois
   * de uma edição programática (e é zerado no quadro seguinte). A barra precisa do estado o
   * tempo todo, e `cursorRef` guarda só o início: envolver um trecho selecionado precisa do fim.
   */
  const [sel, setSel] = useState({ start: 0, end: 0 });
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
  /**
   * O texto de quando a nota foi ABERTA — é para ele que "Descartar edição" volta. O autosave vai
   * gravando enquanto a pessoa apaga, então o último gravado já é um pedaço da nota.
   */
  const aoAbrir = useRef<string | null>(null);
  const latest = useRef({ content, folderId });
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hydrated.current || !note.data) return;
    hydrated.current = true;
    const partes = separarTitulo(note.data.content);
    setNota(partes);
    setFolderId(note.data.folder_id);
    // O gravado, na forma que o editor vai escrever: "# Título" vira "Título", e uma linha em branco
    // sobrando no começo some. Sem isto, só ABRIR a nota disparava um autosave — e a nota subia
    // para o topo da lista, que é ordenada por `updated_at`.
    persisted.current = {
      content: juntarTitulo(partes.titulo, partes.corpo),
      folderId: note.data.folder_id,
    };
    aoAbrir.current = persisted.current.content;
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
  const lembrete = useNoteReminder(savedId);
  const navigation = useNavigation();

  /**
   * ⚠️ **Nota que ficou VAZIA pergunta antes de sair** (23/09/2026). O autosave se recusa a
   * esvaziar uma nota que tinha texto (`skipReason` → `would-empty`, a trava contra perda de dado)
   * — certo, mas calado: a pessoa apagava tudo, saía, e a nota voltava com o texto antigo sem
   * nenhuma explicação. Agora a saída pergunta: descartar a edição (o texto antigo fica) ou apagar
   * a nota (lixeira, 30 dias). "Cancelar" continua editando.
   *
   * "Tinha texto" é o que o BANCO tem (`note.data`), não o ref do autosave: ref não se lê no render.
   */
  const esvaziou = !!savedId && content.trim() === '' && (note.data?.content ?? '').trim() !== '';
  usePreventRemove(esvaziou, ({ data }) => {
    if (trashed.current) {
      navigation.dispatch(data.action);
      return;
    }
    // O foco ainda está num dos campos: com o teclado de pé, ele cobria metade do aviso (e o
    // "Cancelar" inteiro).
    Keyboard.dismiss();
    const apagar = {
      label: 'Mandar para a lixeira',
      destructive: true,
      onPress: () => {
        trashed.current = true;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        trash.mutate(savedId!, {
          onError: () => {
            trashed.current = false;
            toast({ message: 'Não deu para mandar para a lixeira.', tone: 'error' });
          },
        });
        navigation.dispatch(data.action);
      },
    };
    // Nota criada AGORA não tem "como estava quando abriu" para onde voltar: o que o autosave
    // guardou é um pedaço do que foi apagado. Sobra a lixeira (ou "Cancelar", que continua).
    const original = aoAbrir.current;
    if (!original) {
      showItemActions('A nota ficou vazia', [apagar], 'Essa nota não tinha nada quando você abriu.');
      return;
    }
    showItemActions(
      'A nota ficou vazia',
      [
        {
          label: 'Descartar edição',
          onPress: () => {
            if (original !== persisted.current?.content) {
              save.mutate(
                { id: savedId!, content: original, folder_id: folderId },
                {
                  onError: () =>
                    toast({ message: 'Não deu para desfazer a edição da nota.', tone: 'error' }),
                }
              );
            }
            navigation.dispatch(data.action);
          },
        },
        apagar,
      ],
      'Descartar volta a nota como estava quando você abriu. A lixeira guarda por 30 dias.'
    );
  });
  const tinta = noteInk(note.data?.color ?? null, scheme);
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

  /**
   * ⚠️ **Com lembrete, a nota oferece "Editar lembrete"** (23/09/2026, *"uma vez que eu criei o
   * lembrete da nota, a opção tem que mudar"*). O vínculo é `reminders.note_id` (um por nota); a
   * nota ainda não gravada é gravada ANTES, para o lembrete ter a quem apontar.
   */
  const abrirLembrete = async () => {
    // Decidir por um "não tem" que ainda não chegou (ou que falhou) abria um SEGUNDO lembrete, que
    // o banco recusa (um por nota) — e o menu continuava dizendo "Criar". Pergunta de novo antes.
    let existente = lembrete.data;
    if (savedId && !lembrete.isSuccess) {
      const r = await lembrete.refetch();
      if (r.isError) {
        toast({ message: 'Não deu para ver o lembrete da nota. Tenta de novo.', tone: 'error' });
        return;
      }
      existente = r.data;
    }
    if (existente) {
      router.push({ pathname: '/reminder-form', params: { id: existente.id } });
      return;
    }
    await flushRef.current();
    const noteId = idRef.current;
    // Nota nova ainda vazia não é gravada, e um lembrete sem nota não mostraria o vínculo nunca.
    if (!noteId) {
      // Com texto e sem id, o que falhou foi o salvamento — e o `flush` já avisou disso.
      if (!content.trim()) {
        toast({ message: 'Escreve alguma coisa na nota antes de criar o lembrete.', tone: 'error' });
      }
      return;
    }
    router.push({ pathname: '/reminder-form', params: { title: noteTitle(content), noteId } });
  };

  const onMenu = () => {
    Haptics.selectionAsync();
    actionSheet(
      {
        title: noteTitle(content) || 'Nova nota',
        options: [
          'Mover para pasta',
          lembrete.data ? 'Editar lembrete' : 'Criar lembrete',
          'Mandar para a lixeira',
        ],
        destructiveIndex: 2,
      },
      (index) => {
        if (index === 0) setPickerOpen(true);
        if (index === 1) void abrirLembrete();
        if (index === 2) onTrash();
      }
    );
  };

  const startEditing = () => irParaOCorpo(nota.corpo.length);

  const onToggleLine = (lineIndex: number) => {
    Haptics.selectionAsync();
    // O índice é do CORPO: é ele que o `NoteBody` desenha.
    setNota((n) => ({ ...n, corpo: toggleTodo(n.corpo, lineIndex) }));
  };

  /** Tag vale para a nota inteira: sai das duas partes; entra no fim do texto, como sempre. */
  const tirarTag = (tag: string) =>
    setNota((n) => ({ titulo: removeTag(n.titulo, tag).trim(), corpo: removeTag(n.corpo, tag) }));
  const porTag = (tag: string) =>
    setNota((n) =>
      n.corpo || !n.titulo
        ? { ...n, corpo: addTag(n.corpo, tag) }
        : { ...n, titulo: addTag(n.titulo, tag) }
    );

  /**
   * O título é UMA linha. Enter vai para o corpo (como no Notes); colar várias linhas deixa a
   * primeira no título e o resto no começo do corpo.
   *
   * ⚠️ **O Enter chega aqui como "\n", não como `onSubmitEditing`** (23/09/2026). Com
   * `returnKeyType="next"` o Android executa a ação IME "próximo" e move o foco por conta própria,
   * disputando com o `autoFocus` do corpo: a primeira tecla depois do Enter sumia — um "-" e a
   * lista inteira deixava de existir. Medido no emulador: "next" perdia o "-", o "\n" não perde.
   */
  const mudarTitulo = (texto: string) => {
    const quebra = texto.indexOf('\n');
    if (quebra < 0) {
      setNota((n) => ({ ...n, titulo: texto }));
      return;
    }
    const resto = texto.slice(quebra + 1);
    setNota((n) => ({
      titulo: texto.slice(0, quebra),
      corpo: resto ? (n.corpo ? `${resto}\n${n.corpo}` : resto) : n.corpo,
    }));
    irParaOCorpo(0);
  };

  /** Do título para o corpo, com o cursor onde se pediu (Enter: começo; toque no vazio: fim). */
  const irParaOCorpo = (onde: number) => {
    setSelection({ start: onde, end: onde });
    setEditing(true);
  };

  /** Enter numa lista continua a lista (`continuarLista`, com teste); o resto é digitação. */
  const mudarCorpo = (novo: string) => {
    const lista = continuarLista(nota.corpo, novo);
    if (!lista) {
      setNota((n) => ({ ...n, corpo: novo }));
      return;
    }
    setNota((n) => ({ ...n, corpo: lista.texto }));
    setSelection({ start: lista.cursor, end: lista.cursor });
    cursorRef.current = lista.cursor;
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

  // O título da nota mora no campo de cima (ver o comentário dos estilos). Repeti-lo aqui era o
  // "título duplicado" que o usuário apontou.
  const screenTitle = creating ? 'Nova nota' : 'Nota';

  if (note.isError) {
    return (
      <Screen wide={tablet}>
        <Stack.Screen options={{ title: 'Nota' }} />
        <Card>
          <View style={styles.errorCard}>
            <Icon name="exclamationmark.triangle" size="xl" color="danger" />
            <ThemedText type="smallBold">Não achei essa nota</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              Ela pode ter ido para a lixeira em outro aparelho.
            </ThemedText>
            <View style={styles.errorActions}>
              <Button
                label="Tentar de novo"
                variant="secondary"
                size="sm"
                onPress={() => note.refetch()}
              />
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
    setNota((n) => {
      const linha = lineAt(n.corpo, cursorRef.current);
      return linha < 0 ? n : { ...n, corpo: setBlockKind(n.corpo, linha, kind) };
    });
    inputRef.current?.focus();
  };

  /**
   * Envolve o trecho selecionado com a marca — ou tira, se ele já estiver marcado.
   *
   * ⚠️ **A seleção NOVA volta do `toggleMark` e é reaplicada.** Inserir dois caracteres antes do
   * trecho desloca tudo: sem devolver o cursor, escrever `*negrito*` deixaria o caret dois
   * caracteres atrás de onde a pessoa estava, e a próxima letra cairia no meio do delimitador.
   */
  const aplicarMarca = (mark: Mark) => {
    Haptics.selectionAsync();
    const r = toggleMark(nota.corpo, sel.start, sel.end, mark);
    setNota((n) => ({ ...n, corpo: r.text }));
    setSelection(r.selection);
    setSel(r.selection);
    cursorRef.current = r.selection.start;
    inputRef.current?.focus();
  };

  return (
    <Screen scroll={false} wide={tablet}>
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
            style={[styles.chip, { backgroundColor: vidro ? 'transparent' : theme.accentSoft }]}>
            {vidro ? <GlassBackdrop fallbackColor={theme.accentSoft} radius={Radius.pill} /> : null}
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
              hitSlop={CHIP_SLOP}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                tirarTag(tag);
              }}
              style={[
                styles.tagChip,
                { backgroundColor: vidro ? 'transparent' : theme.backgroundElement },
              ]}>
              {vidro ? (
                <GlassBackdrop fallbackColor={theme.backgroundElement} radius={Radius.pill} />
              ) : null}
              <ThemedText type="footnote">#{tag}</ThemedText>
              <Icon name="xmark" size={12} color="textSecondary" />
            </Pressable>
          ))}

          {/*
            A cor é um DISCO, e ele só existe depois do primeiro autosave: `useUpdateNote` grava
            por id, e em nota nova ainda não há id. Sem cor ele é um anel vazio — a mesma forma
            do "Sem cor" do seletor, para o controle não mudar de silhueta ao ganhar cor.
          */}
          {savedId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                note.data?.color ? `Cor ${note.data.color}. Toque para mudar.` : 'Escolher cor'
              }
              hitSlop={13}
              onPress={() => {
                Haptics.selectionAsync();
                setColorOpen(true);
              }}
              style={[
                styles.disco,
                {
                  backgroundColor: tinta ?? 'transparent',
                  borderColor: tinta ?? theme.separator,
                },
              ]}
            />
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Adicionar tag"
            hitSlop={CHIP_SLOP}
            onPress={() => {
              Haptics.selectionAsync();
              setTagPickerOpen(true);
            }}
            style={[
              styles.tagChip,
              { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.separator },
            ]}>
            {vidro ? (
              <GlassBackdrop fallbackColor={theme.backgroundElement} radius={Radius.pill} />
            ) : null}
            <Icon name="plus" size={12} color="tint" />
            <ThemedText type="footnote" themeColor="tint">
              tag
            </ThemedText>
          </Pressable>

          {/* O lembrete desta nota, quando existe e ainda vai tocar — tocar abre para editar. */}
          {lembrete.data?.active ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Lembrete ${quandoToca(lembrete.data.next_run_at)}. Toque para editar.`}
              hitSlop={CHIP_SLOP}
              onPress={() => {
                Haptics.selectionAsync();
                void abrirLembrete();
              }}
              style={[
                styles.tagChip,
                { backgroundColor: vidro ? 'transparent' : theme.backgroundElement },
              ]}>
              {vidro ? (
                <GlassBackdrop fallbackColor={theme.backgroundElement} radius={Radius.pill} />
              ) : null}
              <Icon name="bell" size={12} color="textSecondary" />
              <ThemedText type="footnote" style={tabular}>
                {quandoToca(lembrete.data.next_run_at)}
              </ThemedText>
            </Pressable>
          ) : lembrete.isError ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={CHIP_SLOP}
              onPress={() => void lembrete.refetch()}>
              <ThemedText type="footnote" themeColor="danger">
                Não deu para ver o lembrete · Tentar de novo
              </ThemedText>
            </Pressable>
          ) : null}

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
            <Skeleton width="70%" height={Type.title.lineHeight} />
            <Skeleton width="100%" height={Type.body.lineHeight} />
            <Skeleton width="90%" height={Type.body.lineHeight} />
            <Skeleton width="45%" height={Type.body.lineHeight} />
          </View>
        ) : (
          <>
            {/*
            O TÍTULO tem campo próprio, grande e forte, como no Notes do iPhone — e o corpo começa
            embaixo dele (23/09/2026). Uma linha só: Enter desce para o corpo. Na nota nova é ele
            que leva o foco.
          */}
            <TextInput
              ref={tituloRef}
              value={nota.titulo}
              onChangeText={mudarTitulo}
              multiline
              onBlur={() => void flushRef.current()}
              autoFocus={params.id === 'new'}
              scrollEnabled={false}
              placeholder="Título"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Título da nota"
              style={[Type.title, styles.titulo, { color: theme.text }]}
            />
            {editing ? (
              <TextInput
                ref={inputRef}
                value={nota.corpo}
                onChangeText={mudarCorpo}
                multiline
                autoFocus
                scrollEnabled={false}
                selection={selection}
                onSelectionChange={(e) => {
                  // O cursor é guardado para a barra de blocos saber em QUE linha aplicar. Sem isto
                  // ela só poderia agir na última linha, e converter um bloco do meio da nota
                  // exigiria descer até o fim e voltar.
                  cursorRef.current = e.nativeEvent.selection.start;
                  setSel(e.nativeEvent.selection);
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
              <NoteBody content={nota.corpo} onEdit={startEditing} onToggleLine={onToggleLine} />
            )}
          </>
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
            <FormatBar
              content={nota.corpo}
              selection={sel}
              onMark={aplicarMarca}
              onBlock={aplicarBloco}
            />
          </View>
        </KeyboardStickyView>
      ) : null}

      <TagPicker
        visible={tagPickerOpen}
        alvo="nota"
        current={tags}
        onClose={() => setTagPickerOpen(false)}
        onToggle={(tag) => (tagsOf(content).includes(tag) ? tirarTag(tag) : porTag(tag))}
      />

      <ColorPicker
        visible={colorOpen}
        value={note.data?.color ?? null}
        title="Cor da nota"
        onClose={() => setColorOpen(false)}
        onPick={(cor) => {
          if (!savedId) return;
          updateNote.mutate(
            { id: savedId, color: cor },
            { onError: () => toast({ message: 'Não deu para mudar a cor.', tone: 'error' }) }
          );
        }}
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
 * A anatomia é a do Apple Notes: **a primeira linha é o título**, e o header fica com "Nota" e as
 * ações — repetir o título no header era a mesma frase duas vezes, a 40px de distância.
 *
 * ⚠️ **Desde 23/09/2026 o título tem CAMPO PRÓPRIO** (`Type.title`, acima do corpo), e não é mais
 * a primeira linha do corpo com outra cara: *"o título tem que ter um espaço separado"*. O dado não
 * mudou — `separarTitulo`/`juntarTitulo` (`src/lib/note-blocks.ts`, com teste) só dividem o
 * `content` para o editor. O corpo (`NoteBody`) não promove mais ninguém a título.
 */
const styles = StyleSheet.create({
  /** Disco de 18 com anel de 1,5 — a mesma relação tinta/borda das amostras do seletor. */
  disco: {
    width: 18,
    height: 18,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
  },
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
  /** Sem padding do sistema: o título alinha pela esquerda com o corpo e os chips. */
  titulo: {
    padding: 0,
  },
  loading: {
    gap: Space.md,
  },
  blockBarWrap: { paddingHorizontal: Space.lg, paddingBottom: Space.sm },
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
});
