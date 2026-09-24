import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { Chip } from '@/components/finance/chip';
import { ColorPicker } from '@/components/notes/color-picker';
import { FolderGrid } from '@/components/notes/folder-grid';
import { FolderPicker } from '@/components/notes/folder-picker';
import type { NoteCardActions } from '@/components/notes/note-card';
import { NoteList } from '@/components/notes/note-list';
import { useFolderMenu } from '@/components/notes/use-folder-menu';
import { AppHeader, HeaderIconButton } from '@/components/ui/app-header';
import { Dica } from '@/components/ui/dica';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchField } from '@/components/ui/search-field';
import { BlockHeader } from '@/components/ui/block-header';
import { TextField } from '@/components/ui/field';
import { GlassBackdrop, supportsLiquidGlass } from '@/components/ui/glass-backdrop';
import { Icon } from '@/components/ui/icon';
import { TAB_BAR_SPACE } from '@/components/ui/pill-tab-bar';
import { fecharDeslizavelAberto } from '@/components/ui/deslizavel';
import { DragScrollView } from '@/components/ui/drag-scroll';
import { Screen } from '@/components/ui/screen';
import { Skeleton, SkeletonList } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useBoolPref } from '@/hooks/use-bool-pref';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { MaxContentWidth } from '@/constants/theme';
import { HitTarget, Radius, Space } from '@/design/tokens';
import {
  useNoteFolders,
  useNoteTags,
  useNotesList,
  useReorderFolders,
  useReorderNotes,
  useRestoreNote,
  useSaveNote,
  useToggleNotePin,
  useTrashNote,
  useUpdateFolder,
  useUpdateNote,
  type Note,
  type NoteFolder,
  type NoteSort,
} from '@/hooks/use-notes';
import { SORT_LABEL, useNoteSort } from '@/hooks/use-note-sort';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { useTheme } from '@/hooks/use-theme';
import { showItemActions } from '@/lib/item-actions';

/**
 * O que a barra de abas cobre do pé da rolagem, para a faixa do auto-scroll ficar ALCANÇÁVEL.
 *
 * O mesmo número nos dois sistemas, de propósito. No Android é a geometria exata da pílula
 * (`TAB_BAR_SPACE`); no iOS é um PISO generoso para a barra flutuante do sistema, que eu não
 * consegui medir no aparelho. Errar para mais só começa a faixa um pouco mais acima, o que
 * ninguém percebe; errar para menos a coloca embaixo da barra, onde o dedo não chega — que é
 * exatamente o bug medido no Android em 14/09/2026.
 *
 * ⚠️ Não trocar por `0` no iOS "porque o `paddingBottom` lá é 0": aquilo é sobre o CONTEÚDO
 * passar por baixo da barra, e não diz nada sobre a altura do FRAME que o `onLayout` devolve.
 */
const DOCK = TAB_BAR_SPACE;

/**
 * Notas — a home da aba.
 *
 * ## A mudança que organiza a tela: PASTA É LUGAR, não filtro
 *
 * Até 14/09/2026 a pasta era um chip numa fileira de filtros, ou seja um recorte da mesma lista,
 * e a tela abria com QUATRO fileiras de controle antes da primeira nota — captura, busca, chips
 * de pasta e chips de tag. Agora a pasta é um ladrilho numa grade e abre tela própria; a home
 * lista só o que está SOLTO. É a régua do Apple Notes e do Files, e é a única que faz "o que
 * está dentro" e "o que está fora" serem coisas visivelmente diferentes.
 *
 * Os chips de TAG ficaram, porque tag é transversal: ela recorta pasta e nota ao mesmo tempo.
 *
 * ⚠️ **Com busca ou tag ativas a lista deixa de se limitar às soltas.** Os dois são modos de
 * ACHAR alguma coisa, e uma busca que esconde metade das notas porque elas estão dentro de uma
 * pasta não é busca — é armadilha. É também exatamente o escopo em que o arrasto se desliga:
 * ordem manual dentro de um recorte não quer dizer nada.
 *
 * ## Por que o container é um `Animated.ScrollView` e não a `FlashList`
 *
 * Reordenar exige saber a altura de TODA célula do escopo, e uma lista que recicla célula não
 * sabe a altura do que está fora da tela. Além disso o auto-scroll do arrasto chama `scrollTo`
 * de dentro de um worklet, que precisa de um `AnimatedRef<Animated.ScrollView>` — a `FlashList`
 * não é um. E são DOIS escopos de arrasto na mesma tela (fixadas e soltas), que numa lista
 * plana com cabeçalho calculado por índice seria um `data` só com duas semânticas dentro.
 *
 * `// ponytail: home não virtualizada. O escopo é "notas SOLTAS" — dezenas, e a paginação de 30
 * continua. Se alguém chegar a centenas de notas soltas, o caminho é um modo de reordenação com
 * linha de altura FIXA sobre a FlashList, e não desvirtualizar mais nada.`
 */

/** Skeleton na forma do cartão: título + duas linhas de prévia. */
function NoteSkeleton() {
  return (
    <View style={styles.esqueleto}>
      <Skeleton width="55%" height={17} />
      <Skeleton width="92%" height={13} />
      <Skeleton width="70%" height={13} />
    </View>
  );
}

export default function NotesScreen() {
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const theme = useTheme();
  const vidro = supportsLiquidGlass();
  const toast = useToast();

  const [draft, setDraft] = useState('');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useNoteSort();
  const [pastasRecolhidas, setPastasRecolhidas] = useBoolPref('notes:pastas-recolhidas');
  const [arrastando, setArrastando] = useState(false);
  const [puxando, setPuxando] = useState(false);

  /**
   * Alvo de cada sheet. `null` = fechado — um estado só diz "qual" e "se".
   *
   * A cor de pasta tem alvo próprio em vez de reusar `pintando`: os dois `<ColorPicker>` são o
   * mesmo componente com títulos e destinos diferentes, e um alvo polimórfico ("nota ou pasta")
   * obrigaria todo leitor a perguntar qual dos dois é antes de usar.
   */
  const [pintando, setPintando] = useState<Note | null>(null);
  const [pintandoPasta, setPintandoPasta] = useState<NoteFolder | null>(null);
  const [movendo, setMovendo] = useState<Note | null>(null);

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  /** Distância do topo do conteúdo até cada bloco arrastável — é o que o auto-scroll precisa. */
  /**
   * Altura VISÍVEL da rolagem.
   *
   * Sem ela o `Reorderable` cai em `Dimensions.get('window').height`, que aqui sobra ~180px (a
   * faixa de marca em cima, a dock embaixo): o auto-scroll só começaria com o dedo já embaixo da
   * barra, ou seja, nunca.
   */
  const [alturaVisivel, setAlturaVisivel] = useState(0);
  const [topoPastas, setTopoPastas] = useState(0);
  const [topoFixadas, setTopoFixadas] = useState(0);
  const [topoSoltas, setTopoSoltas] = useState(0);

  // Busca-enquanto-digita sem uma requisição por tecla.
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);

  const procurando = !!q || !!tag;

  const list = useNotesList({
    // Sem recorte a home é a caixa de SOLTAS; com recorte ela é o resultado da busca.
    ...(procurando ? {} : { folderId: null }),
    ...(tag ? { tag } : {}),
    ...(q ? { q } : {}),
    sort,
  });
  const foldersQuery = useNoteFolders();
  const tagsQuery = useNoteTags();

  const save = useSaveNote();
  const togglePin = useToggleNotePin();
  const trash = useTrashNote();
  const restore = useRestoreNote();
  const updateNote = useUpdateNote();
  const updateFolder = useUpdateFolder();
  const reorderNotes = useReorderNotes();
  const reorderFolders = useReorderFolders();

  // Falha em pastas/tags não derruba a lista: a grade e os chips só somem.
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data]);
  const notes = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);
  const folderById = useCallback((id: string | null) => folders.find((f) => f.id === id), [folders]);

  /**
   * Os chips somam tag de NOTA e tag de PASTA — o namespace é um só, e é isso que faz um toque
   * em `#casa` recortar a tela inteira. A contagem de pasta sai em memória porque as pastas já
   * vieram todas; uma segunda RPC só para contar o que está na mão seria consulta por nada.
   */
  const chips = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const t of tagsQuery.data ?? []) mapa.set(t.tag, t.count);
    for (const f of folders) for (const t of f.tags) mapa.set(t, (mapa.get(t) ?? 0) + 1);
    return [...mapa.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([nome]) => nome);
  }, [tagsQuery.data, folders]);

  /** A grade mostra só a RAIZ: subpasta aparece dentro da mãe, que é onde ela mora. */
  const pastas = useMemo(
    () => folders.filter((f) => f.parent_id === null && (!tag || f.tags.includes(tag))),
    [folders, tag]
  );

  const fixadas = useMemo(() => notes.filter((n) => n.pinned), [notes]);
  const soltas = useMemo(() => notes.filter((n) => !n.pinned), [notes]);

  /**
   * Arrastar só vale na ordem MANUAL e sem recorte.
   *
   * Sob busca ou tag a lista é um subconjunto, e gravar posição a partir dele reescreveria a
   * ordem do escopo inteiro com a ordem de um pedaço dele. Nas outras ordens o servidor manda, e
   * uma alça que some ao soltar seria pior que não existir.
   */
  const podeArrastar = sort === 'manual' && !procurando;

  const submitDraft = () => {
    const content = draft.trim();
    if (!content || save.isPending) return;
    save.mutate(
      { content, folder_id: null },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setDraft('');
        },
        onError: () => toast({ message: 'Não deu para salvar a nota.', tone: 'error' }),
      }
    );
  };

  const acoesDaNota: NoteCardActions = useMemo(
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
      onColor: setPintando,
      onMove: setMovendo,
      onArchive: (note) => {
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
        );
      },
      onTrash: (note) => {
        trash.mutate(note.id, {
          onSuccess: () =>
            toast({
              message: 'Nota na lixeira.',
              tone: 'success',
              action: { label: 'Desfazer', onPress: () => restore.mutate(note.id, { onError: () => toast({ message: 'Não deu para desfazer.', tone: 'error' }) }) },
            }),
          onError: () => toast({ message: 'Não deu para apagar a nota.', tone: 'error' }),
        });
      },
    }),
    [togglePin, trash, restore, updateNote, toast]
  );

  const menuDaTela = () => {
    const ordens: NoteSort[] = ['manual', 'recentes', 'criadas', 'titulo'];
    showItemActions('Notas', [
      {
        label: 'Ordenar',
        icon: 'arrow.up.arrow.down',
        /*
          ⚠️ **O segundo sheet é aberto À MÃO, e a ordem atual vai no `message`.** Uma entrada
          com `actions` também abriria um submenu, mas sem mensagem — e `selected` não desenha
          nada no `ActionSheetIOS`, que não tem checkmark. Sem o "Agora:", no iOS o menu não diz
          em que ordem a tela já está, que é metade do que se vem perguntar aqui.
        */
        onPress: () =>
          showItemActions(
            'Ordenar notas',
            ordens.map((o) => ({
              label: SORT_LABEL[o],
              selected: sort === o,
              onPress: () => {
                Haptics.selectionAsync();
                setSort(o);
              },
            })),
            `Agora: ${SORT_LABEL[sort].toLowerCase()}`
          ),
      },
      {
        label: 'Organizar pastas',
        icon: 'folder',
        onPress: () => router.push('/notes/folders'),
      },
      { label: 'Arquivadas', icon: 'archivebox', onPress: () => router.push('/notes/archived') },
      { label: 'Lixeira', icon: 'trash', onPress: () => router.push('/notes/trash') },
    ]);
  };

  const menuDaPasta = useFolderMenu({ onColor: setPintandoPasta });

  /*
    O PORTÃO DA TELA — três consultas, e todas precisam estar de pé antes de a tela pintar.

    ⚠️ **`list` é `useInfiniteQuery`**, e o `isPending` dela vale para a PRIMEIRA página, que é
    exatamente o que este portão quer. As páginas seguintes têm o skeleton do rodapé.
  */
  const pronta = useTelaPronta(list, foldersQuery, tagsQuery);

  const cabecalho = (
    <AppHeader
      title="Notas"
      action={
        <>
          <HeaderIconButton
            icon="square.and.pencil"
            label="Nova nota"
            onPress={() => router.push('/notes/new')}
          />
          <HeaderIconButton icon="ellipsis" label="Mais opções" onPress={menuDaTela} />
        </>
      }
    />
  );

  if (!pronta) {
    return (
      <Screen wide={tablet} grouped topBar={cabecalho}>
        <SkeletonList linhas={4} />
        <SkeletonList linhas={3} />
      </Screen>
    );
  }

  const vazio = list.isError ? (
    <EmptyState
      icon="exclamationmark.triangle"
      title="Não deu para carregar as notas"
      hint="Pode ter sido a conexão."
      action={{ label: 'Tentar de novo', onPress: () => list.refetch() }}
    />
  ) : list.isLoading ? (
    <View accessibilityLabel="Carregando notas">
      {Array.from({ length: 4 }, (_, i) => (
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
  ) : tag ? (
    <EmptyState
      icon="tag"
      title={`Nada com #${tag}`}
      hint="Nenhuma nota e nenhuma pasta usam essa tag agora."
      action={{ label: 'Limpar filtro', onPress: () => setTag(null) }}
    />
  ) : pastas.length > 0 ? (
    // As pastas estão logo acima: o vazio é uma linha depois delas, não o centro da tela.
    <EmptyState
      icon="tray"
      title="Nada solto por aqui"
      hint="Tudo que você anotou está dentro de uma pasta. Escreve aí em cima para começar outra."
      compacto
    />
  ) : (
    <EmptyState
      title="Nada anotado ainda"
      hint="Escreve aqui em cima — ou manda «anotar: ligar pro dentista» no WhatsApp."
    />
  );

  const biblioteca = (
      <DragScrollView
        ref={scrollRef}
        // Rolar fecha o card arrastado que estiver aberto (Deslizavel).
        onScrollBeginDrag={fecharDeslizavelAberto}
        style={styles.libraryScroll}
        onLayout={(e) => setAlturaVisivel(e.nativeEvent.layout.height)}
        // ⚠️ É isto que faz o arrasto não brigar com a rolagem: em vez de negociar prioridade
        // entre dois reconhecedores, o scroll simplesmente sai de cena enquanto o dedo carrega
        // um item. O auto-scroll continua, porque ele é `scrollTo`, não gesto.
        scrollEnabled={!arrastando}
        refreshControl={
          /*
            ⚠️ **O indicador é do GESTO, não da requisição** — `puxando` é estado local, nunca
            `isRefetching`. Esta tela invalida a lista a cada fixar, colorir, arquivar e
            arrastar; amarrado ao refetch, o `RefreshControl` abria sozinho depois de CADA uma
            delas e empurrava a tela inteira uns 60pt para baixo — salto de layout em toda ação,
            medido no simulador em 14/09/2026 ao fixar uma nota. Mesmo desenho da lista do
            Agente (`agent/index.tsx`), pelo mesmo motivo.
          */
          <RefreshControl
            refreshing={puxando}
            progressViewOffset={0}
            onRefresh={() => {
              setPuxando(true);
              void Promise.all([
                list.refetch(),
                foldersQuery.refetch(),
                tagsQuery.refetch(),
              ]).finally(() => setPuxando(false));
            }}
          />
        }
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.conteudo, tablet && styles.conteudoTablet]}
        scrollEventThrottle={16}
        onScroll={({ nativeEvent: e }) => {
          const fim = e.contentSize.height - e.layoutMeasurement.height - e.contentOffset.y;
          if (fim < 600 && list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
        }}>
        {/*
          ## A ordem: AÇÃO, depois FILTRO, depois conteúdo

          A captura abre o conteúdo porque é o que este app É — "anotar rápido" é a razão de o
          produto existir. A busca saiu daqui em 19/09/2026: ela é FIXA sob o `AppHeader` (slot
          `search` do `Screen`, pedido do dono do produto) e não rola com as notas.
        */}
        <View style={styles.grupoDeEntrada}>
        <View style={styles.captura}>
          <TextField
            value={draft}
            onChangeText={setDraft}
            placeholder="Anotar rápido…"
            returnKeyType="done"
            submitBehavior="submit"
            onSubmitEditing={submitDraft}
            accessibilityLabel="Nova nota rápida"
            style={styles.cresce}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Salvar nota"
            accessibilityState={{ disabled: !draft.trim(), busy: save.isPending }}
            disabled={!draft.trim() || save.isPending}
            onPress={submitDraft}
            style={({ pressed }) => [
              styles.enviar,
              {
                backgroundColor: !draft.trim()
                  ? theme.backgroundElement
                  : vidro
                    ? 'transparent'
                    : theme.tintFill,
                opacity: pressed ? 0.5 : 1,
              },
            ]}>
            {draft.trim() && vidro ? (
              <GlassBackdrop fallbackColor={theme.tintFill} radius={Radius.pill} tintColor={theme.glassActionTint} />
            ) : null}
            {/*
              `onTint`, nunca `text`: a pílula é pintada de `tint`, que é TINTA (quase-preto no
              claro). Com `text` a seta saía preta sobre preto — um disco cego no tema claro.
            */}
            <Icon
              name="arrow.up"
              size="md"
              color={draft.trim() ? 'onTint' : 'textSecondary'}
              weight="semibold"
            />
          </Pressable>
        </View>

        {chips.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // A faixa SANGRA até as bordas: presa na calha da tela, o primeiro e o último chip
            // ficariam cortados a 16px da borda em vez de saírem de baixo dela.
            style={styles.faixaChips}
            contentContainerStyle={styles.chips}>
            {chips.map((t) => (
              <Chip
                key={t}
                label={`#${t}`}
                selected={tag === t}
                onPress={() => setTag(tag === t ? null : t)}
              />
            ))}
          </ScrollView>
        ) : null}
        </View>

        {pastas.length > 0 ? (
          <View onLayout={(e) => setTopoPastas(e.nativeEvent.layout.y)}>
            {/* ⚠️ **Sem "Segure para mover" aqui.** A dica morava no slot de AÇÃO do cabeçalho,
                onde ela era permanente, mais longa que o próprio rótulo e competia com ele —
                parte de "tela feia" em 14/09/2026. §7b já diz que explicação vai abaixo do que
                explica, e o slot é para ação. O gesto se ensina sozinho: segurar um ladrilho e
                soltar sem andar abre o menu de ações, que é o mesmo idioma da tela inicial do
                iOS. Quem não segurar nunca perde nada — todas as ações estão nesse menu. */}
            {/*
              A grade RECOLHE, e a escolha fica gravada.

              ⚠️ **Com muitas pastas ela empurra a primeira nota para fora da tela.** Medido com
              20 pastas: são dez fileiras antes da lista, e quem abre Notas para ler uma nota
              rola a tela inteira toda vez. Recolhida, a contagem no cabeçalho diz o que está
              escondido — esconder sem dizer quanto é o que faz a pessoa achar que sumiu.

              O rótulo inteiro é o alvo (não só o galão): é a área que o dedo já mira, e §5 pede
              alvo de 44pt. `LinearTransition` na grade fecha o buraco em vez de piscar.
            */}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: !pastasRecolhidas }}
              accessibilityLabel={`Pastas, ${pastas.length}`}
              style={styles.alvoRecolher}
              onPress={() => {
                Haptics.selectionAsync();
                setPastasRecolhidas(!pastasRecolhidas);
              }}>
              <BlockHeader
                title="Pastas"
                count={pastas.length}
                trailing={
                  <Icon name={pastasRecolhidas ? 'chevron.down' : 'chevron.up'} size="sm" color="textSecondary" />
                }
              />
            </Pressable>
            {pastasRecolhidas ? null : (
            <FolderGrid
              pastas={pastas}
              enabled={podeArrastar}
              scrollRef={scrollRef}
              topInset={topoPastas}
              viewportHeight={alturaVisivel}
              bottomInset={tablet && Platform.OS === 'ios' ? 0 : DOCK}
              onDragStateChange={setArrastando}
              onOpen={(f) => router.push(`/notes/folder/${f.id}`)}
              onMenu={menuDaPasta}
              onReorder={(ids) =>
                reorderFolders.mutate(ids, {
                  onError: () =>
                    toast({ message: 'Não deu para salvar a ordem das pastas.', tone: 'error' }),
                })
              }
            />
            )}
          </View>
        ) : null}

        {notes.length > 0 ? <Dica id="lista-arrasto" tela="notas" bico="baixo" /> : null}

        {fixadas.length > 0 ? (
          <View onLayout={(e) => setTopoFixadas(e.nativeEvent.layout.y)}>
            {/* Mesmo motivo do rótulo de baixo: sozinho ele nomearia a lista inteira, e o
                alfinete de cada cartão já diz o que a seção diria. */}
            {soltas.length > 0 ? <BlockHeader title="Fixadas" count={fixadas.length} /> : null}
            <NoteList
              notas={fixadas}
              acoes={acoesDaNota}
              folderById={folderById}
              enabled={podeArrastar}
              scrollRef={scrollRef}
              topInset={topoFixadas}
              viewportHeight={alturaVisivel}
              bottomInset={tablet && Platform.OS === 'ios' ? 0 : DOCK}
              onDragStateChange={setArrastando}
              onReorder={(ids) =>
                reorderNotes.mutate(ids, {
                  onError: () => toast({ message: 'Não deu para salvar a ordem.', tone: 'error' }),
                })
              }
            />
          </View>
        ) : null}

        <View onLayout={(e) => setTopoSoltas(e.nativeEvent.layout.y)}>
          {/* No tablet, o rótulo identifica a lista abaixo da grade de pastas; no celular,
              aparece apenas quando há duas seções de notas para separar. */}
          {(fixadas.length > 0 && soltas.length > 0) || (tablet && soltas.length > 0) ? (
            <View style={styles.cabecalhoNotas}>
              <BlockHeader title={procurando ? 'Resultados' : 'Notas'} count={soltas.length} />
            </View>
          ) : null}

          {soltas.length > 0 ? (
            <NoteList
              notas={soltas}
              acoes={acoesDaNota}
              folderById={folderById}
              enabled={podeArrastar}
              scrollRef={scrollRef}
              topInset={topoSoltas}
              viewportHeight={alturaVisivel}
              bottomInset={tablet && Platform.OS === 'ios' ? 0 : DOCK}
              onDragStateChange={setArrastando}
              onReorder={(ids) =>
                reorderNotes.mutate(ids, {
                  onError: () => toast({ message: 'Não deu para salvar a ordem.', tone: 'error' }),
                })
              }
            />
          ) : fixadas.length === 0 ? (
            vazio
          ) : null}
        </View>

        {list.isFetchingNextPage ? <NoteSkeleton /> : null}
      </DragScrollView>
  );

  return (
    <Screen
      scroll={false}
      wide={tablet}
      grouped
      topBar={cabecalho}
      contentStyle={tablet && styles.tabletShell}
      search={
        <SearchField
          value={typed}
          onChangeText={setTyped}
          placeholder="Buscar nas notas"
          accessibilityLabel="Buscar nas notas"
        />
      }>
      {biblioteca}

      <ColorPicker
        visible={pintando !== null}
        value={pintando?.color ?? null}
        title="Cor da nota"
        onClose={() => setPintando(null)}
        onPick={(cor) => {
          if (!pintando) return;
          updateNote.mutate(
            { id: pintando.id, color: cor },
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
          if (pintandoPasta) {
            updateFolder.mutate(
              { id: pintandoPasta.id, color: cor },
              { onError: () => toast({ message: 'Não deu para mudar a cor.', tone: 'error' }) }
            );
          }
        }}
      />

      <FolderPicker
        visible={movendo !== null}
        current={movendo?.folder_id ?? null}
        folders={folders}
        onClose={() => setMovendo(null)}
        onPick={(destino) => {
          if (movendo) {
            Haptics.selectionAsync();
            updateNote.mutate(
              { id: movendo.id, folder_id: destino },
              {
                onSuccess: () =>
                  toast({
                    message: destino
                      ? `Movida para ${folderById(destino)?.name ?? 'a pasta'}.`
                      : 'Tirada da pasta.',
                    tone: 'success',
                  }),
                onError: () => toast({ message: 'Não deu para mover a nota.', tone: 'error' }),
              }
            );
          }
          setMovendo(null);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabletShell: { paddingHorizontal: Space.lg },
  libraryScroll: { flex: 1 },
  conteudoTablet: { maxWidth: 960, paddingHorizontal: 0, alignSelf: 'center' },
  /** O rótulo é um botão: alvo de 44pt (§11), não a altura natural de uma linha de `caption`. */
  alvoRecolher: { minHeight: HitTarget, justifyContent: 'center' },
  /** Mesmo respiro vertical do cabeçalho de Pastas, sem tornar Notas um botão. */
  cabecalhoNotas: { minHeight: HitTarget, justifyContent: 'center' },
  conteudo: {
    gap: Space.xl,
    paddingHorizontal: Space.lg,
    /**
     * ⚠️ **A dock do Android é ABSOLUTA e desenha POR CIMA da lista.** O `Screen` só soma esse
     * respiro no ramo COM rolagem própria dele; aqui a rolagem é nossa, então a conta é nossa.
     * Sem isto a última nota fica escondida atrás da pílula — não dá para ler nem tocar.
     */
    paddingBottom: Space.xxxl + (Platform.OS === 'android' ? TAB_BAR_SPACE : 0),
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  /** Captura, busca e chips são UM grupo — `md` entre eles, `xl` só até o próximo bloco (§2). */
  grupoDeEntrada: { gap: Space.md, paddingTop: Space.md },
  captura: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  enviar: {
    width: HitTarget,
    height: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
  faixaChips: { marginHorizontal: -Space.lg },
  chips: { gap: Space.sm, paddingHorizontal: Space.lg },
  cresce: { flex: 1 },
  esqueleto: { gap: Space.sm, paddingVertical: Space.lg },
});
