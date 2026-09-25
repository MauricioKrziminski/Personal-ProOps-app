import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  LayoutChangeEvent,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  type ComposedGesture,
  type GestureType,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedStyle,
  useFrameCallback,
  useScrollViewOffset,
  useSharedValue,
  withSpring,
  type AnimatedRef,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import {
  posX,
  posY,
  reordenar,
  slotDoIrmao,
  slotSobODedo,
  velocidadeAutoScroll,
} from '@/design/reorder-math';
import { Elevation, Motion, Radius, Space } from '@/design/tokens';
import { useScheme } from '@/hooks/use-theme';

/**
 * Arrastar para reordenar — o caminho ÚNICO do app.
 *
 * ## Dois modos, uma aritmética
 *
 * | modo | onde | como o slot é calculado |
 * |---|---|---|
 * | `columns = 1` | lista de notas | alturas MEDIDAS por célula (`onLayout`), somadas |
 * | `columns > 1` | grade de pastas | ladrilho uniforme, `índice → (linha, coluna)`, exato |
 *
 * A grade não mede nada: com ladrilho de dimensão fixa a conta fecha sozinha, e medir seria
 * inventar uma fonte de erro onde não havia. A lista mede porque cartão de nota tem altura
 * variável — prévia de uma ou duas linhas, faixa de metadado que quebra.
 *
 * ⚠️ **A altura é guardada por ID, nunca por índice.** Depois de um arrasto a ordem muda mas as
 * alturas não, e um mapa por índice ficaria deslocado exatamente na hora em que a conta precisa
 * estar certa — `onLayout` não dispara de novo, porque a altura daquele cartão não mudou.
 *
 * ## O que faz isto NÃO ser uma lista virtualizada
 *
 * É deliberado: aqui toda célula está montada, então toda altura é conhecida e o slot é exato.
 * Reordenar dentro de uma lista que RECICLA célula e não sabe a altura do que está fora da tela
 * é a versão frágil do mesmo problema.
 *
 * `// ponytail: container não virtualizado. O escopo real é dezenas de itens (pastas raiz, notas
 * soltas, notas de uma pasta). Se um escopo passar de algumas centenas, o caminho é um modo de
 * reordenação com linha de altura FIXA sobre a FlashList — aí o slot vira `floor(y / altura)` e
 * a virtualização deixa de importar.`
 *
 * ## Um shared value governa todo mundo
 *
 * `alvo` (o índice sob o dedo) é a única fonte: o deslocamento de cada irmão é DERIVADO dele.
 * Mesmo desenho da barra de abas do Android, e pelo mesmo motivo — duas molas independentes dessincronizam
 * e no meio do caminho o vizinho fica num lugar que a conta não prevê.
 *
 * ## Acessibilidade
 *
 * Arrastar não é acessível sozinho. **Toda tela que usa este componente mantém "mover" no menu
 * de contexto do item** (`ItemLink` / `showItemActions`), que é o caminho do leitor de tela.
 *
 * `Reduce Motion` sai de graça: `withSpring` do Reanimated usa `ReduceMotion.System` por padrão,
 * então o movimento dos vizinhos colapsa sozinho. O item arrastado continua seguindo o dedo —
 * isso é manipulação direta, não animação, e travá-lo seria quebrar a funcionalidade.
 */

/** Faixa, em px, em que o dedo perto da borda puxa o scroll. */
const BORDA = 88;
/** Teto de velocidade do auto-scroll, em px por quadro (~60 fps → ~600 px/s). */
const VELOCIDADE = 10;
/** Quanto o dedo anda para virar arrasto, no modo alça. */
const DISTANCIA = 4;
/** Quanto o toque longo segura antes de levantar o ladrilho, no modo grade. */
const TOQUE_LONGO = 220;
/** Abaixo disto, soltar sem ter andado conta como toque, não como arrasto. */
const PARADO = 6;

export interface ReorderRenderInfo<T> {
  item: T;
  index: number;
  /** `true` no item levantado — a tela usa para calar o que competir com o arrasto. */
  active: boolean;
  /**
   * O gesto de arrastar.
   *
   * No modo `alça` **quem o monta é o item**, em volta do punho: aqui o `Reorderable` não
   * embrulha nada. Posto no cartão inteiro, qualquer deslize vertical sobre uma nota viraria
   * arrasto e brigaria com a rolagem da lista — e o dedo do usuário não avisa qual dos dois ele
   * queria. No modo `toque-longo` o `Reorderable` já embrulha o item todo e este gesto sobra.
   */
  drag: ComposedGesture | GestureType;
}

export interface ReorderableProps<T> {
  data: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (info: ReorderRenderInfo<T>) => React.ReactNode;
  /** Recebe os ids na ordem nova. Só dispara quando a ordem realmente mudou. */
  onReorder: (ids: string[]) => void;
  /** 1 = lista (altura medida). >1 = grade de ladrilhos uniformes. */
  columns?: number;
  /** Obrigatório na grade: a altura do ladrilho. Ignorado na lista. */
  tileHeight?: number;
  gap?: number;
  /** Desliga o arrasto sem desmontar nada — é assim que "ordenar por data" fica estático. */
  enabled?: boolean;
  /**
   * Como o arrasto começa.
   *
   * - `alça`: pega ao primeiro movimento, e o gesto vive num punho próprio dentro do item. É o
   *   modo da LISTA, onde o toque longo já é do menu de contexto — no iOS o `ItemLink` é
   *   `Link.Menu`, ou seja `UIContextMenuInteraction`, e dois reconhecedores de toque longo no
   *   mesmo cartão brigam.
   * - `toque-longo`: o item inteiro levanta depois de 220 ms. É o modo da GRADE, que não tem
   *   menu de contexto; soltar sem ter andado chama `onTapItem`, como na tela inicial do iOS.
   */
  activation?: 'alça' | 'toque-longo';
  /** Só no modo `toque-longo`: soltou sem ter arrastado. */
  onTapItem?: (index: number) => void;
  /**
   * Avisa que um item está levantado.
   *
   * ⚠️ **A tela usa isto para DESLIGAR a rolagem** (`scrollEnabled={false}`) enquanto o arrasto
   * acontece. É a forma robusta de não disputar o gesto com o scroll nativo: em vez de negociar
   * prioridade entre dois reconhecedores, um deles simplesmente sai de cena. O auto-scroll
   * continua funcionando, porque ele é programático (`scrollTo`), não gesto.
   */
  onDragStateChange?: (dragging: boolean) => void;
  /** Ref animada do scroll que contém esta lista. Sem ela não há auto-scroll. */
  scrollRef?: AnimatedRef<Animated.ScrollView>;
  /** Distância entre o topo do conteúdo do scroll e o topo deste container. */
  topInset?: number;
  /** Altura visível do scroll. Sem ela, a janela — que é uma aproximação boa o bastante. */
  viewportHeight?: number;
  /**
   * Quanto do PÉ do scroll está coberto por algo flutuante — a dock, no caso das raízes de aba.
   *
   * ⚠️ **Sem isto o auto-scroll é inalcançável, e ele falha em silêncio.** Medido em 14/09/2026
   * com 20 pastas: o scroll mede 888dp de altura porque ele passa POR BAIXO da dock, então a
   * faixa de 88dp começava em 800 — mas o dedo não chega lá. Os últimos ~98dp são a pílula da
   * dock e, abaixo dela, a área de gesto do sistema, que nem entrega o `MOVE` para o app. O item
   * parava em 777 e a conta dava `v = 0`: nada rolava, sem erro nenhum.
   *
   * A tela é quem sabe o que cobre o pé dela — a mesma expressão que ela já usa no
   * `paddingBottom` do conteúdo.
   */
  bottomInset?: number;
  style?: ViewStyle;
}

export function Reorderable<T>({
  data,
  keyExtractor,
  renderItem,
  onReorder,
  columns = 1,
  tileHeight = 0,
  gap = Space.sm,
  enabled = true,
  activation = 'alça',
  onTapItem,
  onDragStateChange,
  scrollRef,
  topInset = 0,
  viewportHeight,
  bottomInset = 0,
  style,
}: ReorderableProps<T>) {
  const grade = columns > 1;
  const scheme = useScheme();

  /** Índice levantado, ou -1. */
  const arrastando = useSharedValue(-1);
  /** Índice sob o dedo. É dele que sai o deslocamento de todo irmão. */
  const alvo = useSharedValue(-1);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  /** Quanto o auto-scroll já andou nesta arrastada — soma ao dedo para o item não escapar. */
  const rolado = useSharedValue(0);
  /** Offset do scroll no quadro anterior: é a diferença entre os dois que diz o que andou. */
  const ultimoOffset = useSharedValue(0);

  /** Altura por ID (ver o aviso no cabeçalho). Só no modo lista. */
  const alturas = useSharedValue<Record<string, number>>({});
  const ids = useMemo(() => data.map(keyExtractor), [data, keyExtractor]);
  const idsSV = useSharedValue<string[]>(ids);
  useEffect(() => {
    idsSV.value = ids;
  }, [ids, idsSV]);

  const [largura, setLargura] = useState(0);
  const larguraLadrilho = grade && largura > 0 ? (largura - gap * (columns - 1)) / columns : 0;
  const janela = viewportHeight ?? Dimensions.get('window').height;

  const offsetScroll = useScrollViewOffset(scrollRef ?? null);

  const comprometer = useCallback(
    (de: number, para: number) => {
      if (de < 0 || para < 0 || de === para) return;
      if (de >= ids.length || para >= ids.length) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onReorder(reordenar(ids, de, para));
    },
    [ids, onReorder]
  );

  const avisarLevantou = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  /**
   * Auto-scroll.
   *
   * ⚠️ Tem de ser QUADRO, não evento: `onUpdate` só dispara quando o dedo anda, então segurar o
   * item parado na borda não rolaria nada — que é exatamente o gesto de "levar isto lá para
   * baixo". O callback nasce DESLIGADO e o gesto o liga; sempre ligado, seriam 60 execuções por
   * segundo em toda tela que monte uma lista reordenável.
   *
   * ⚠️ **O quanto o conteúdo andou é MEDIDO, nunca o quanto foi pedido** (14/09/2026). A versão
   * anterior somava `andou = destino - offset` ao dedo no MESMO quadro em que pedia o `scrollTo`,
   * assumindo que ele tinha acontecido. No fim do conteúdo o scroll não anda mais: o pedido é
   * clampado e a soma continua. Medido com 20 pastas — `dy` foi de 433 para **181.534** em três
   * quadros com o offset parado em 774, e o ladrilho saiu voando da tela.
   *
   * Comparar o offset com o do quadro anterior conserta os dois fins de uma vez, sem saber onde
   * o conteúdo termina: se ele não andou, o delta é zero e nada é somado.
   */
  const quadro = useFrameCallback(() => {
    'worklet';
    if (arrastando.value < 0 || !scrollRef) return;

    // 1. O que o auto-scroll de FATO andou desde o quadro passado. O dedo não se moveu, mas o
    //    conteúdo sim: sem somar isto o item escorrega para fora da mão.
    //
    //    `rolado === 0` é o começo de uma arrastada (`levantar` zera) — e também o instante em
    //    que o conteúdo voltou exatamente para onde estava, que dá no mesmo. Sincronizar aí
    //    dispensa um estado de "armado" e impede que o primeiro quadro herde o offset da
    //    arrastada anterior, somando de uma vez tudo que o dedo rolou entre as duas.
    if (rolado.value === 0) ultimoOffset.value = offsetScroll.value;
    const delta = offsetScroll.value - ultimoOffset.value;
    if (delta !== 0) {
      ultimoOffset.value = offsetScroll.value;
      rolado.value += delta;
      dy.value += delta;
    }

    // 2. Decidir a velocidade deste quadro.
    const topo =
      topInset + posY(arrastando.value, idsSV.value, alturas.value, tileHeight, gap, columns);
    const y = topo + dy.value - offsetScroll.value;
    const altura = grade
      ? tileHeight
      : alturas.value[idsSV.value[arrastando.value]] ?? 0;

    const v = velocidadeAutoScroll(y, altura, janela, bottomInset, BORDA, VELOCIDADE);
    if (v === 0) return;

    scrollTo(scrollRef, 0, Math.max(0, offsetScroll.value + v), false);
  }, false);

  /** `setActive` vem de um objeto do Reanimated; passar o método solto perderia o `this`. */
  const ligarQuadro = useCallback(
    (ligado: boolean) => {
      quadro.setActive(ligado);
      onDragStateChange?.(ligado);
    },
    [quadro, onDragStateChange]
  );

  const medir = useCallback(
    (id: string) => (e: LayoutChangeEvent) => {
      if (grade) return;
      const h = e.nativeEvent.layout.height;
      if (alturas.value[id] === h) return;
      alturas.value = { ...alturas.value, [id]: h };
    },
    [alturas, grade]
  );

  const linhas = grade ? Math.ceil(data.length / columns) : 0;

  return (
    <View
      onLayout={(e) => setLargura(e.nativeEvent.layout.width)}
      style={[grade ? { height: Math.max(0, linhas * (tileHeight + gap) - gap) } : null, style]}>
      {data.map((item, index) => (
        <Celula
          key={ids[index]}
          id={ids[index]}
          index={index}
          total={data.length}
          grade={grade}
          columns={columns}
          gap={gap}
          larguraLadrilho={larguraLadrilho}
          tileHeight={tileHeight}
          alturas={alturas}
          idsSV={idsSV}
          arrastando={arrastando}
          alvo={alvo}
          scrollRef={scrollRef}
          dx={dx}
          dy={dy}
          rolado={rolado}
          enabled={enabled}
          activation={activation}
          scheme={scheme}
          onMedir={medir(ids[index])}
          onLevantou={avisarLevantou}
          onSoltou={comprometer}
          onTapItem={onTapItem}
          onArrastando={ligarQuadro}>
          {(active, drag) => renderItem({ item, index, active, drag })}
        </Celula>
      ))}
    </View>
  );
}

/* ── os três momentos do gesto ───────────────────────────────────────────── */

/**
 * Escrita em shared value mora em worklet de MÓDULO, não dentro do `useMemo` que monta o gesto.
 *
 * Não é estilo: o lint do React Compiler (`react-hooks/immutability`) trata o corpo de um
 * `useMemo` como fase de render e recusa qualquer `.value =` ali dentro — e ele está certo sobre
 * o corpo, mesmo que estes callbacks só rodem depois, no dedo. Fora do hook a análise não se
 * aplica, e de quebra a mecânica do arrasto fica legível separada da montagem do gesto.
 */
interface Eixo {
  arrastando: SharedValue<number>;
  alvo: SharedValue<number>;
  dx: SharedValue<number>;
  dy: SharedValue<number>;
  rolado: SharedValue<number>;
}

function levantar(eixo: Eixo, index: number) {
  'worklet';
  eixo.arrastando.value = index;
  eixo.alvo.value = index;
  eixo.dx.value = 0;
  eixo.dy.value = 0;
  eixo.rolado.value = 0;
}

function mover(
  eixo: Eixo,
  index: number,
  total: number,
  translationX: number,
  translationY: number,
  geo: Geometria
) {
  'worklet';
  eixo.dx.value = translationX;
  eixo.dy.value = translationY + eixo.rolado.value;
  const x = posX(index, geo.larguraLadrilho, geo.gap, geo.columns) + eixo.dx.value;
  const y =
    posY(index, geo.ids.value, geo.alturas.value, geo.tileHeight, geo.gap, geo.columns) +
    eixo.dy.value;
  eixo.alvo.value = slotSobODedo(
    index, total, x, y, geo.ids.value, geo.alturas.value,
    geo.tileHeight, geo.larguraLadrilho, geo.gap, geo.columns
  );
}

function pousar(eixo: Eixo) {
  'worklet';
  eixo.arrastando.value = -1;
  eixo.alvo.value = -1;
  eixo.dx.value = 0;
  eixo.dy.value = 0;
  eixo.rolado.value = 0;
}

interface Geometria {
  ids: SharedValue<string[]>;
  alturas: SharedValue<Record<string, number>>;
  larguraLadrilho: number;
  tileHeight: number;
  gap: number;
  columns: number;
}

/* ── a célula ────────────────────────────────────────────────────────────── */

interface CelulaProps {
  id: string;
  index: number;
  total: number;
  grade: boolean;
  columns: number;
  gap: number;
  larguraLadrilho: number;
  tileHeight: number;
  alturas: SharedValue<Record<string, number>>;
  idsSV: SharedValue<string[]>;
  arrastando: SharedValue<number>;
  alvo: SharedValue<number>;
  dx: SharedValue<number>;
  dy: SharedValue<number>;
  rolado: SharedValue<number>;
  scrollRef?: AnimatedRef<Animated.ScrollView>;
  enabled: boolean;
  activation: 'alça' | 'toque-longo';
  scheme: 'light' | 'dark';
  onMedir: (e: LayoutChangeEvent) => void;
  onLevantou: () => void;
  onSoltou: (de: number, para: number) => void;
  onTapItem?: (index: number) => void;
  onArrastando: (ativo: boolean) => void;
  children: (active: boolean, drag: ComposedGesture | GestureType) => React.ReactNode;
}

function Celula({
  id,
  index,
  total,
  grade,
  columns,
  gap,
  larguraLadrilho,
  tileHeight,
  alturas,
  idsSV,
  arrastando,
  alvo,
  dx,
  dy,
  rolado,
  scrollRef,
  enabled,
  activation,
  scheme,
  onMedir,
  onLevantou,
  onSoltou,
  onTapItem,
  onArrastando,
  children,
}: CelulaProps) {
  const [ativo, setAtivo] = useState(false);

  const eixo = useMemo<Eixo>(
    () => ({ arrastando, alvo, dx, dy, rolado }),
    [arrastando, alvo, dx, dy, rolado]
  );
  const geo = useMemo<Geometria>(
    () => ({ ids: idsSV, alturas, larguraLadrilho, tileHeight, gap, columns }),
    [idsSV, alturas, larguraLadrilho, tileHeight, gap, columns]
  );

  const pan = useMemo(() => {
    const g = Gesture.Pan()
      .enabled(enabled)
      .onStart(() => {
        levantar(eixo, index);
        runOnJS(setAtivo)(true);
        runOnJS(onArrastando)(true);
        runOnJS(onLevantou)();
      })
      .onUpdate((e) => {
        mover(eixo, index, total, e.translationX, e.translationY, geo);
      })
      .onEnd(() => {
        const parado = Math.abs(eixo.dx.value) < PARADO && Math.abs(eixo.dy.value) < PARADO;
        if (parado && activation === 'toque-longo' && onTapItem) runOnJS(onTapItem)(index);
        else runOnJS(onSoltou)(index, eixo.alvo.value);
      })
      .onFinalize(() => {
        // Sempre, inclusive em cancelamento: sem isto um item fica levantado para sempre depois
        // de uma interrupção (ligação chegando, gesto do sistema, navegação).
        pousar(eixo);
        runOnJS(setAtivo)(false);
        runOnJS(onArrastando)(false);
      });

    const comGatilho =
      activation === 'toque-longo'
        ? g.activateAfterLongPress(TOQUE_LONGO)
        : g.minDistance(DISTANCIA);

    /*
      **`blocksExternalGesture` é a relação entre os reconhecedores; `scrollEnabled` é a trava
      da tela.** As duas existem porque resolvem coisas diferentes, em tempos diferentes.

      Desligar a rolagem responde ao `onStart`, e o `onStart` sai daqui por `runOnJS`: um
      `setState` e um render DEPOIS de o dedo já ter andado os 4px. Nessa fresta o scroll nativo
      ainda está livre para seguir o dedo — é a mesma fresta que faz uma lista no topo começar a
      esticar. Esta linha fecha isso ANTES, no nível em que o RNGH decide quem ganha: o scroll
      espera este gesto falhar. É o padrão que a doc do RNGH mostra exatamente para este caso
      (gesto de filho contra rolagem do pai) e o que o plano desta fase pedia.
    */
    // O RNGH tipa o alvo como ref de CLASSE de componente; a ref animada guarda a INSTÂNCIA.
    // Em runtime ele só lê `.current` para achar a tag nativa — daí o cast, aqui e em lugar nenhum.
    return scrollRef
      ? comGatilho.blocksExternalGesture(scrollRef as unknown as React.RefObject<React.ComponentType>)
      : comGatilho;
  }, [
    enabled, index, total, eixo, geo, activation, scrollRef,
    onTapItem, onLevantou, onSoltou, onArrastando,
  ]);

  /**
   * ⚠️ **Na GRADE o slot vive DENTRO do transform, e isso não é estilo — é o que impede o
   * teleporte no instante do commit.**
   *
   * Com o slot em `left`/`top` estáticos, soltar produzia dois movimentos ao mesmo tempo: o
   * `left` pulava para o slot novo (mudança de layout, sem transição) enquanto o transform
   * voltava a zero. O ladrilho desaparecia de um lugar e reaparecia noutro.
   *
   * Com o slot no transform, a posição é UMA expressão: solta-se, `index` muda para o destino e
   * `dx/dy` zeram — e o valor final é o mesmo ponto em que o dedo largou. Não há salto porque
   * não há duas fontes de posição.
   *
   * Na LISTA o item está no FLUXO (altura variável, posição vem do layout) e o transform é
   * relativo. Ali o salto no commit é o tamanho do vão que os vizinhos já abriram — quase nada —
   * e a atualização otimista do cache faz a ordem nova chegar no mesmo quadro.
   */
  const movimento = useAnimatedStyle(() => {
    const arrastado = arrastando.value === index;
    // O irmão só anda se estiver ENTRE a origem e o destino, e anda um slot, nunca mais.
    const destino = arrastado ? index : slotDoIrmao(index, arrastando.value, alvo.value);

    if (grade) {
      const baseX = posX(destino, larguraLadrilho, gap, columns);
      const baseY = posY(destino, idsSV.value, alturas.value, tileHeight, gap, columns);
      return arrastado
        ? {
            // ⚠️ A conta vai DENTRO do withSpring: `withSpring(a) * b` devolve NaN e a view some
            // sem um único erro no log — foi assim que a carteira de cartões ficou invisível.
            transform: [
              { translateX: baseX + dx.value },
              { translateY: baseY + dy.value },
              { scale: withSpring(1.04, Motion.spring.snap) },
            ],
          }
        : {
            transform: [
              { translateX: withSpring(baseX, Motion.spring.settle) },
              { translateY: withSpring(baseY, Motion.spring.settle) },
              { scale: withSpring(1, Motion.spring.settle) },
            ],
          };
    }

    if (arrastado) {
      return {
        transform: [
          { translateX: dx.value },
          { translateY: dy.value },
          { scale: withSpring(1.04, Motion.spring.snap) },
        ],
      };
    }

    const dY =
      posY(destino, idsSV.value, alturas.value, tileHeight, gap, columns) -
      posY(index, idsSV.value, alturas.value, tileHeight, gap, columns);

    return {
      transform: [
        { translateX: 0 },
        { translateY: withSpring(dY, Motion.spring.settle) },
        { scale: withSpring(1, Motion.spring.settle) },
      ],
    };
  }, [index, larguraLadrilho, tileHeight, gap, columns, grade]);

  /**
   * Elevação e empilhamento saem do ESTADO, não do worklet: os dois trocam uma vez por arrasto
   * (não por quadro), `boxShadow` é string e `zIndex` não interpola — animá-los seria pagar
   * ponte por nada e arriscar um valor intermediário sem sentido.
   */
  /*
    ⚠️ **O raio é o do card que o item carrega** (25/09/2026). A sombra contorna a CAIXA deste
    invólucro: sem raio ela era um quadrado em volta do cartão arredondado, e os quatro cantos —
    dentro do quadrado, fora do raio — ficavam sem sombra, desenhando bordas retas ao segurar uma
    pasta. Os dois que reordenam (notas e pastas) desenham cards em `Radius.md`.
  */
  const camada: ViewStyle = ativo
    ? { zIndex: 20, boxShadow: Elevation[scheme].overlay, borderRadius: Radius.md, borderCurve: 'continuous' }
    : { zIndex: 1 };

  // Na grade, `left/top` ficam em ZERO: a posição inteira é transform (ver `movimento`).
  const posicao: ViewStyle = grade
    ? { position: 'absolute', left: 0, top: 0, width: larguraLadrilho, height: tileHeight }
    : { marginBottom: gap };

  return (
    /*
      `Animated.View` por FORA e o conteúdo tocável por dentro: `createAnimatedComponent(Pressable)`
      com `style` em função não aplica o estilo — o `anti-slop.test.ts` quebra o build por isso.

      No modo `toque-longo` o gesto embrulha o ladrilho inteiro (é a grade, e ela não tem menu de
      contexto para disputar). No modo `alça` o `GestureDetector` é responsabilidade do ITEM, em
      volta do punho: no cartão inteiro, todo deslize vertical viraria arrasto e brigaria com a
      rolagem — e a tela ainda desliga o scroll durante o arrasto (`onDragStateChange`), que é o
      que remove a disputa de vez em vez de negociar prioridade entre dois reconhecedores.
    */
    <Animated.View onLayout={onMedir} style={[posicao, camada, movimento]}>
      {activation === 'toque-longo' ? (
        <GestureDetector gesture={pan}>
          <View style={styles.preenche}>{children(ativo, pan)}</View>
        </GestureDetector>
      ) : (
        children(ativo, pan)
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  preenche: { flex: 1 },
});
