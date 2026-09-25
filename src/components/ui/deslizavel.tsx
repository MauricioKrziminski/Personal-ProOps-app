import * as Haptics from 'expo-haptics';
import { useFocusEffect, useSegments } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, type GestureTouchEvent, type GestureType } from 'react-native-gesture-handler';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { DentroDeArrasto } from '@/components/ui/money';
import { Motion, Radius, Space } from '@/design/tokens';
import { usarDica } from '@/hooks/use-dicas';
import { useTheme } from '@/hooks/use-theme';
import {
  abriuOLado,
  botaoNoArrasto,
  cardAberto,
  pontasDoPainel,
  fecharCardAberto,
  ladosDoArrasto,
  larguraDoBotao,
  executaAoSoltar,
  passouAteOFim,
  temArrasto,
  traducaoNoSoltar,
  ladoDoSoltar,
} from '@/lib/arrasto';
import { showItemActions, type ItemAction } from '@/lib/item-actions';

/** Um card aberto por vez (`cardAberto`, `lib/arrasto.ts`); a lista que começa a rolar fecha o dele. */
export const fecharDeslizavelAberto = fecharCardAberto;

type Props = {
  /** Título do menu "Mais" (o mesmo do toque longo). */
  titulo: string;
  /** A lista INTEIRA do menu do toque longo, com `arrasto`/`desfaz` marcados (`lib/arrasto.ts`). */
  acoes: ItemAction[];
  /**
   * `linha`: dentro de uma `Section` — o conteúdo ganha o fundo do grupo, senão o painel vaza
   * por baixo do texto. `card`: o card já é opaco; o recorte segue o canto dele.
   */
  forma?: 'linha' | 'card';
  /** Fundo da `linha` — o da superfície em volta. Lista chapada sobre a tela usa `groupedBackground`. */
  fundo?: 'surface' | 'groupedBackground';
  children: ReactNode;
};

/**
 * Arrastar o card para os lados, como no WhatsApp: direita = a ação rápida; esquerda = tirar da
 * lista, com "Mais" (o menu do toque longo) quando sobra ação. É o caminho ÚNICO do arrasto —
 * a tela só marca os lados nas ações que já declara (design.md §6).
 */
export function Deslizavel({ titulo, acoes, forma = 'linha', fundo = 'surface', children }: Props) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const botao = larguraDoBotao(fontScale);
  // Tela empurrada tem o "voltar" do iPhone na borda esquerda; raiz de aba (`(tabs)`) não tem.
  const temVoltar = useSegments()[0] !== '(tabs)';
  const eu = useRef<SwipeableMethods>(null);
  // Um objeto estável no registro: o `ref` do gesto só existe enquanto o arrasto está montado.
  const meu = useMemo(() => ({ close: () => eu.current?.close() }), []);
  // Saiu da tela (voltar, trocar de aba) ou desmontou: esquece o aberto daqui.
  useFocusEffect(useCallback(() => () => cardAberto.esquecer(meu), [meu]));
  useEffect(() => () => cardAberto.esquecer(meu), [meu]);
  const largura = useSharedValue(0);
  const direita = useLado();
  const esquerdaSV = useLado();
  const inicio = useSharedValue(0);
  // O deslocamento que a biblioteca aplica, espelhado pelo painel; e a SAÍDA: até o fim numa ação
  // que tira o item da lista, o card segue até sair da tela (NaN = parado no gesto).
  const tx = useSharedValue(0);
  const saida = useSharedValue(Number.NaN);
  // Quando a ação TIRA o item da lista, a linha encolhe até sumir logo depois de o card sair — como
  // no WhatsApp —, sem esperar o banco: esperando, a faixa ficava parada ~1 s e a linha sumia de
  // uma vez (medido no s26). `recolheu` fica ligado depois da primeira vez: a altura passa a ser
  // escrita sempre (a do conteúdo, medida por dentro), porque um estilo animado que deixa de
  // escrever uma chave não a devolve.
  const altura = useSharedValue(0);
  const recolhe = useSharedValue(0);
  const recolheu = useSharedValue(false);
  const recolher = useAnimatedStyle(() =>
    recolheu.get() ? { height: altura.get() * (1 - recolhe.get()), overflow: 'hidden' as const } : {},
  );
  const armado = useSharedValue(false);
  const abertoAntes = useSharedValue<'direita' | 'esquerda' | null>(null);

  // Sem ações o gesto fica DESLIGADO, não desmontado: montar e desmontar o arrasto quando as
  // ações chegam (Contas, com a conta carregando) remontava o card inteiro.
  const tem = temArrasto(acoes);
  const lados = ladosDoArrasto(acoes);
  const mais: ItemAction = {
    label: 'Mais ações',
    curto: 'Mais',
    icon: 'ellipsis',
    onPress: () => showItemActions(titulo, acoes),
  };
  // Como no WhatsApp: "Mais" por dentro, a ação de tirar na BORDA — é ela que "até o fim" executa.
  const esquerda = lados.mais ? [mais, ...lados.esquerda] : lados.esquerda;
  // A ponta de cada lado é a do painel DESENHADO: só "Mais" à esquerda, o "Mais" é a borda.
  const pontas = pontasDoPainel(lados.direita, esquerda);

  // Os botões leem a lista MAIS NOVA na hora do toque: o painel só é redesenhado quando o que
  // aparece nele muda (a assinatura), então o `onPress` guardado nele pode ser de outro render.
  const atual = useRef({ direita: lados.direita, esquerda, pontas });
  useEffect(() => {
    atual.current = { direita: lados.direita, esquerda, pontas };
  });
  const tocar = useCallback((acao: ItemAction, saindo = false) => {
    const viva = [...atual.current.direita, ...atual.current.esquerda].find((x) => x.label === acao.label) ?? acao;
    if (!saindo) eu.current?.close();
    viva.onPress?.();
  }, []);
  // O botão do painel avisa pelo RÓTULO: o toque chega da thread da UI, e a ação (com funções
  // dentro) não atravessa para lá.
  const tocarRotulo = useCallback(
    (label: string) => {
      const viva = [...atual.current.direita, ...atual.current.esquerda].find((x) => x.label === label);
      if (viva) tocar(viva);
    },
    [tocar],
  );
  // Soltou até o fim: o gesto decide na UI (`ladoQueExecuta`) e pede aqui; o efeito lê a ação
  // MAIS NOVA. Por estado, não por ref: o gesto é montado num `useMemo`, e o React Compiler
  // recusa ref lida a partir dali.
  const [pedido, setPedido] = useState<{ lado: 'direita' | 'esquerda' } | null>(null);
  // Cada pedido executa UMA vez: o efeito roda de novo quando o Fast Refresh o reaplica, e a ação
  // é destrutiva (arquivar de novo DEPOIS do "Desfazer").
  const feito = useRef<typeof pedido>(null);
  useEffect(() => {
    if (!pedido || feito.current === pedido) return;
    feito.current = pedido;
    const { pontas } = atual.current;
    const ponta = pedido.lado === 'direita' ? pontas.direita : pontas.esquerda;
    if (!ponta) return;
    // O card já saiu da tela (`ladoQueExecuta`) e este pedido chega quando a saída TERMINA: só então
    // abre o que tiver que abrir — o menu, a confirmação, a ação —, como no WhatsApp.
    tocar(ponta, true);
    // Saindo, o card não passa pelo "fechou": a dica do arrasto é encerrada aqui.
    usarDica('lista-arrasto');
    // O que TIRA o item da lista sem perguntar (a ponta da esquerda com "Desfazer": Arquivar) fica
    // fora até ele sumir — a ação chega ao banco e o card desmonta junto; se ela falhar (o toast já
    // disse), ele volta. O resto (menu, confirmação, ação rápida) volta logo, por trás do que abriu.
    const tira = pedido.lado === 'esquerda' && Boolean(pontas.esquerda?.desfaz);
    if (tira) {
      recolheu.set(true);
      recolhe.set(withTiming(1, { duration: Motion.duration.base, easing: Motion.easing.out }));
    }
    const volta = setTimeout(() => {
      // Ainda aqui: a ação falhou (o toast já disse) ou não tirava o item — a linha reabre e o card
      // volta para o lugar.
      recolhe.set(withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.out }));
      eu.current?.reset();
      saida.set(withTiming(0, { duration: Motion.duration.slow, easing: Motion.easing.out }, (fim) => {
        if (fim) saida.set(Number.NaN);
      }));
    }, tira ? 3000 : Motion.duration.slow * 2);
    return () => clearTimeout(volta);
  }, [pedido, tocar, saida, recolhe, recolheu]);
  const pedir = useCallback((lado: 'direita' | 'esquerda') => setPedido({ lado }), []);
  const nDireita = lados.direita.length;
  const nEsquerda = esquerda.length;
  const pontaD = Boolean(pontas.direita);
  const pontaE = Boolean(pontas.esquerda);
  const soltura = useMemo<Soltura>(
    () => ({
      inicio,
      armado,
      abertoAntes,
      largura,
      direita,
      esquerda: esquerdaSV,
      botoes: { direita: nDireita, esquerda: nEsquerda },
      ponta: { direita: pontaD, esquerda: pontaE },
      botao,
      tx,
      saida,
      pedir,
    }),
    [inicio, armado, abertoAntes, largura, direita, esquerdaSV, nDireita, nEsquerda, pontaD, pontaE, botao, tx, saida, pedir],
  );
  // Este gesto só observa o dedo: nunca ativa, e corre junto do arrasto da biblioteca.
  const dedo = useMemo(
    () =>
      Gesture.Manual()
        .onTouchesDown((e) => marcarInicio(soltura, e))
        // Quem pede a ação é o fim da SAÍDA (`ladoQueExecuta`), não o soltar.
        .onTouchesUp((e) => {
          ladoQueExecuta(soltura, e);
        }),
    [soltura],
  );
  const assinatura = (lista: ItemAction[]) =>
    lista.map((x) => [x.label, x.curto, x.icon, x.destructive, x.desfaz].join('|')).join('¦');
  const chaveDireita = assinatura(lados.direita);
  const chaveEsquerda = assinatura(esquerda);
  const pontaDireita = pontaD;
  const pontaEsquerda = pontaE;

  // O fundo sobre o qual o painel aparece: é a base opaca de cada botão (ver `BotaoDoPainel`).
  const base = forma === 'linha' ? theme[fundo] : theme.background;
  const renderDireita = useCallback(
    (_p: SharedValue<number>, translation: SharedValue<number>) => (
      <Painel lado="direita" acoes={lados.direita} temPonta={pontaDireita} botao={botao} translation={translation} largura={largura} estado={direita} tocar={tocarRotulo} dedo={dedo} tx={tx} saida={saida} base={base} />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a assinatura É a dependência da lista
    [chaveDireita, pontaDireita, botao, largura, direita, tocarRotulo, dedo, tx, saida, base],
  );
  const renderEsquerda = useCallback(
    (_p: SharedValue<number>, translation: SharedValue<number>) => (
      <Painel lado="esquerda" acoes={esquerda} temPonta={pontaEsquerda} botao={botao} translation={translation} largura={largura} estado={esquerdaSV} tocar={tocarRotulo} dedo={dedo} tx={tx} saida={saida} base={base} />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a assinatura É a dependência da lista
    [chaveEsquerda, pontaEsquerda, botao, largura, esquerdaSV, tocarRotulo, dedo, tx, saida, base],
  );

  return (
    // O gesto do soltar mora FORA do arrasto: com o painel aberto a biblioteca põe o conteúdo em
    // `pointerEvents: 'box-only'`, e preso a ele o gesto deixava de ver o dedo — continuar
    // arrastando a partir do painel aberto não executava mais.
    <GestureDetector gesture={dedo}>
      <Animated.View
        collapsable={false}
        // Um toque num card com OUTRO aberto só fecha o aberto — não navega no mesmo toque. No
        // próprio card aberto o toque passa: é ele que aperta os botões revelados.
        onStartShouldSetResponderCapture={() => cardAberto.toqueEmOutro(meu)}
        style={recolher}>
        {/* Mede o tamanho NATURAL: a caixa de fora é a que encolhe quando o item sai da lista. */}
        <View
          onLayout={(e) => {
            largura.set(e.nativeEvent.layout.width);
            altura.set(e.nativeEvent.layout.height);
          }}>
        <ReanimatedSwipeable
          ref={eu}
          enabled={tem}
          simultaneousWithExternalGesture={dedo}
          friction={1}
          overshootFriction={1}
          animationOptions={Motion.spring.settle}
          // Passar do painel só onde arrastar até o fim faz algo.
          overshootLeft={pontaDireita}
          overshootRight={pontaEsquerda}
          leftThreshold={botao / 2}
          rightThreshold={botao / 2}
          // No iPhone a borda esquerda de uma tela empurrada é o "voltar" do sistema: ali o arrasto
          // começa depois dela. Nas raízes de aba não há voltar, e a zona morta só atrapalhava.
          hitSlop={Platform.OS === 'ios' && temVoltar ? { left: -Space.xl } : undefined}
          containerStyle={forma === 'card' ? styles.recorteCard : undefined}
          renderLeftActions={tem && lados.direita.length ? renderDireita : undefined}
          renderRightActions={tem && esquerda.length ? renderEsquerda : undefined}
          onSwipeableWillOpen={(direcao) => {
            cardAberto.abriu(meu);
            // `right` é o conteúdo indo para a direita — o painel `direita`.
            abertoAntes.set(direcao === 'right' ? 'direita' : 'esquerda');
          }}
          // Fechando, o card já não é "o aberto": um toque noutro card logo em seguida navega.
          onSwipeableWillClose={() => {
            abertoAntes.set(null);
            cardAberto.fechou(meu);
          }}
          onSwipeableClose={() => {
            // Arrastar é o que a dica das listas ensina (`lista-arrasto`). Encerrada no FECHAR, não
            // no abrir: sumindo com o painel aberto, a lista subia e os botões andavam sob o dedo.
            usarDica('lista-arrasto');
            for (const l of [direita, esquerdaSV]) {
              l.passou.set(false);
              l.desligouEm.set(0);
            }
            cardAberto.fechou(meu);
          }}>
          <DentroDeArrasto.Provider value>
            {/*
              O fundo da `linha` mora AQUI, não no contêiner da biblioteca: aquele fica parado no
              painel aberto enquanto o card sai, e cobria metade da ponta com a linha já vazia.
            */}
            <Saida tx={tx} saida={saida} fundo={forma === 'linha' ? theme[fundo] : undefined}>
              {children}
            </Saida>
          </DentroDeArrasto.Provider>
        </ReanimatedSwipeable>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

type Lado = { passou: SharedValue<boolean>; desligouEm: SharedValue<number>; abriu: SharedValue<boolean> };

type Soltura = {
  inicio: SharedValue<number>;
  /** Um soltar por toque: sem isto, dois `onTouchesUp` do mesmo toque pediriam a ação duas vezes. */
  armado: SharedValue<boolean>;
  abertoAntes: SharedValue<'direita' | 'esquerda' | null>;
  largura: SharedValue<number>;
  direita: Lado;
  esquerda: Lado;
  botoes: { direita: number; esquerda: number };
  ponta: { direita: boolean; esquerda: boolean };
  botao: number;
  tx: SharedValue<number>;
  saida: SharedValue<number>;
  /** Pede a ação da ponta deste lado — chamado quando o card termina de sair. */
  pedir: (lado: 'direita' | 'esquerda') => void;
};

function marcarInicio(s: Soltura, e: GestureTouchEvent) {
  'worklet';
  if (e.numberOfTouches !== 1) return;
  s.inicio.set(e.changedTouches[0].absoluteX);
  s.armado.set(true);
}

/**
 * Soltou até o fim? Decidido no SOLTAR, na thread da UI, com o quanto o dedo andou no próprio
 * evento mais o painel que já estava aberto (`traducaoNoSoltar`). Ler o deslocamento do card no
 * aviso "vai abrir" pegava a mola da biblioteca já andando (131 a 355 para o mesmo dedo de 300),
 * e um valor gravado na UI às vezes chega ao JS DEPOIS desse aviso — os dois faziam o arrasto
 * rápido só abrir (medido no emulador em 24/09/2026).
 *
 * Worklet de MÓDULO, como os de `reorderable.tsx`: dentro do `useMemo` que monta o gesto o React
 * Compiler trata o corpo como render.
 */
function ladoQueExecuta(s: Soltura, e: GestureTouchEvent): 'direita' | 'esquerda' | null {
  'worklet';
  if (!s.armado.get()) return null;
  s.armado.set(false);
  const traducao = traducaoNoSoltar(s.abertoAntes.get(), e.changedTouches[0].absoluteX - s.inicio.get(), {
    direita: s.botoes.direita * s.botao,
    esquerda: s.botoes.esquerda * s.botao,
  });
  const lado = ladoDoSoltar(s.abertoAntes.get(), traducao);
  if (!lado) return null;
  const estado = s[lado];
  // O card nem chegou a abrir deste lado neste toque: não foi arrasto.
  if (!estado.abriu.get()) return null;
  const executa = executaAoSoltar({
    passou: estado.passou.get(),
    desligouEm: estado.desligouEm.get(),
    agora: Date.now(),
    traducao,
    lado,
    largura: s.largura.get(),
    botoes: s.botoes[lado],
    temPonta: s.ponta[lado],
    botao: s.botao,
  });
  if (!executa) return null;
  // Até o fim, o card SEMPRE sai da tela, com a ponta cobrindo a linha — e a ação só é pedida quando
  // a saída termina (o WhatsApp abre o que tiver que abrir depois da transição). Na thread da UI, no
  // quadro do soltar: esperar o JS deixava a mola da biblioteca puxar o card de volta por um instante.
  const pedir = s.pedir;
  s.saida.set(s.tx.get());
  s.saida.set(
    withTiming(
      lado === 'esquerda' ? -s.largura.get() : s.largura.get(),
      { duration: Motion.duration.base, easing: Motion.easing.out },
      (fim) => {
        if (fim) runOnJS(pedir)(lado);
      },
    ),
  );
  return lado;
}

function useLado(): Lado {
  const passou = useSharedValue(false);
  const desligouEm = useSharedValue(0);
  const abriu = useSharedValue(false);
  return useMemo(() => ({ passou, desligouEm, abriu }), [passou, desligouEm, abriu]);
}

/**
 * O card durante a SAÍDA (até o fim numa ação que tira o item da lista): ele segue até sair da tela
 * em vez de voltar para o lugar, e só então some — como no WhatsApp. Fora disso, não mexe em nada.
 */
function Saida({
  tx,
  saida,
  fundo,
  children,
}: {
  tx: SharedValue<number>;
  saida: SharedValue<number>;
  fundo?: string;
  children: ReactNode;
}) {
  const estilo = useAnimatedStyle(() => {
    const s = saida.get();
    return { transform: [{ translateX: Number.isNaN(s) ? 0 : s - tx.get() }] };
  });
  return <Animated.View style={[fundo ? { backgroundColor: fundo } : null, estilo]}>{children}</Animated.View>;
}

function Painel({
  lado,
  acoes,
  temPonta,
  botao,
  translation,
  largura,
  estado,
  tocar,
  dedo,
  tx,
  saida,
  base,
}: {
  lado: 'direita' | 'esquerda';
  acoes: ItemAction[];
  temPonta: boolean;
  botao: number;
  translation: SharedValue<number>;
  largura: SharedValue<number>;
  estado: Lado;
  tocar: (label: string) => void;
  dedo: GestureType;
  tx: SharedValue<number>;
  saida: SharedValue<number>;
  base: string;
}) {
  const theme = useTheme();
  // 0 → 1 quando o dedo passa do "até o fim": é ele que faz a ponta cobrir o painel.
  const cheio = useSharedValue(0);
  useAnimatedReaction(
    () => translation.get(),
    (v) => tx.set(v),
  );
  // O quanto o card revelou DESTE lado — na saída, o quanto ele já andou para fora.
  const revelado = useDerivedValue(() => {
    const s = saida.get();
    const t = Number.isNaN(s) ? translation.get() : s;
    return Math.max(0, lado === 'direita' ? t : -t);
  });
  // Um toque por gesto, no idioma do sistema: seleção ao cruzar o ponto de ABRIR, impacto leve
  // ao cruzar o ponto de "até o fim" (é ali que soltar passa a executar). Quem avisa o resultado
  // é o toast da ação, como no menu.
  useAnimatedReaction(
    () => abriuOLado(translation.get(), lado, botao),
    (agora, antes) => {
      if (agora === (antes ?? false)) return;
      estado.abriu.set(agora);
      if (agora) runOnJS(Haptics.selectionAsync)();
    },
  );
  useAnimatedReaction(
    () => passouAteOFim(translation.get(), lado, largura.get(), acoes.length, temPonta, botao),
    (agora, antes) => {
      if (agora === (antes ?? false)) return;
      estado.passou.set(agora);
      if (agora) runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
      else estado.desligouEm.set(Date.now());
    },
  );
  // A ponta cobre o painel até o fim E durante a saída: soltando, a biblioteca assenta o card no
  // painel aberto e o "até o fim" desliga — sem a saída aqui, os botões voltavam esticados na linha
  // inteira com o card já fora da tela.
  useAnimatedReaction(
    () =>
      passouAteOFim(translation.get(), lado, largura.get(), acoes.length, temPonta, botao) || !Number.isNaN(saida.get()),
    (agora, antes) => {
      if (agora === (antes ?? false)) return;
      // Sem quique: no WhatsApp a ponta desliza sobre os outros em ~0,3 s e assenta.
      cheio.set(withTiming(agora ? 1 : 0, { duration: Motion.duration.slow, easing: Motion.easing.out }));
    },
  );
  // A faixa mora na borda de FORA e cresce com o dedo; o `Radius.md` a mais é o pedaço que entra
  // sob o canto do card (`botaoNoArrasto`, `recuo`). A `View` de fora mantém a largura do painel
  // ABERTO, que é o que a biblioteca mede para saber onde o card para.
  const faixa = useAnimatedStyle(() => ({ width: revelado.get() + Math.min(Radius.md, revelado.get()) }));
  const n = acoes.length;

  return (
    <View style={{ width: n * botao }}>
      <Animated.View style={[styles.faixa, lado === 'esquerda' ? styles.faixaNaDireita : styles.faixaNaEsquerda, faixa]}>
        {acoes.map((acao, i) => {
          // Vermelho só para o que apaga; Arquivar e "Mais" são neutros (spec do arrasto). O neutro
          // usa `backgroundSelected`: no escuro o `backgroundElement` quase não se distinguia da linha.
          const cor = acao.destructive
            ? { fundo: theme.dangerSoft, tinta: 'danger' as const }
            : lado === 'direita'
              ? { fundo: theme.tintFill, tinta: 'onTint' as const }
              : { fundo: theme.backgroundSelected, tinta: 'text' as const };
          // Contado a partir do CARD: à esquerda do painel o colado é o primeiro; à direita, o último.
          const j = lado === 'esquerda' ? i : n - 1 - i;
          return (
            <BotaoDoPainel
              key={acao.label}
              label={acao.label}
              dedo={dedo}
              tocar={tocar}
              botao={botao}
              fundo={cor.fundo}
              base={base}
              j={j}
              n={n}
              lado={lado}
              revelado={revelado}
              cheio={cheio}
              // Dois neutros lado a lado ("Mais" e "Arquivar") liam como um bloco só: um fio da cor
              // do fundo na borda de dentro do de fora. É `View`, não borda.
              fio={j > 0 ? theme.background : null}>
              {acao.icon ? <Icon name={acao.icon} size="md" color={cor.tinta} /> : null}
              <ThemedText type="caption" themeColor={cor.tinta} style={styles.rotulo}>
                {acao.curto ?? acao.label}
              </ThemedText>
            </BotaoDoPainel>
          );
        })}
      </Animated.View>
    </View>
  );
}

/**
 * Um botão do painel: um `Tap` do gesture-handler SIMULTÂNEO ao gesto que observa o dedo.
 *
 * ⚠️ **No iOS o botão não respondia** (24/09/2026, medido no simulador): o `Pressable` do
 * gesture-handler dentro do painel perdia o toque para o `Gesture.Manual` que envolve o card — sem
 * ele, o mesmo toque abria o menu. O observador não pode sair (é ele que decide o "até o fim" no
 * soltar), então o toque do botão declara a relação com ele. No Android o `Pressable` da RN também
 * não serve: dentro do `ReanimatedSwipeable` o gesto nativo do arrasto fica com o toque. Um
 * caminho só, nas duas plataformas.
 *
 * **O movimento é o do WhatsApp no iPhone** (`botaoNoArrasto`): largura natural, conteúdo parado
 * no meio dela, saindo de baixo do card em degraus, o de fora por cima (`zIndex = j`).
 */
function BotaoDoPainel({
  label,
  dedo,
  tocar,
  botao,
  fundo,
  base,
  j,
  n,
  lado,
  revelado,
  cheio,
  fio,
  children,
}: {
  label: string;
  dedo: GestureType;
  tocar: (label: string) => void;
  botao: number;
  fundo: string;
  base: string;
  j: number;
  n: number;
  lado: 'direita' | 'esquerda';
  revelado: SharedValue<number>;
  cheio: SharedValue<number>;
  fio: string | null;
  children: ReactNode;
}) {
  const apertado = useSharedValue(0);
  const toque = useMemo(
    () =>
      Gesture.Tap()
        .simultaneousWithExternalGesture(dedo)
        .onBegin(() => apertado.set(1))
        .onFinalize(() => apertado.set(0))
        .onEnd((_e, deu) => {
          if (deu) runOnJS(tocar)(label);
        }),
    [dedo, apertado, tocar, label],
  );
  const caixa = useAnimatedStyle(() => {
    const r = revelado.get();
    const g = botaoNoArrasto(j, n, r, botao, cheio.get(), Radius.md);
    // A faixa começa `min(raio, r)` antes da borda do card; o início do botão conta a partir dela.
    const x = Math.min(Radius.md, r) + g.inicio;
    return {
      ...(lado === 'esquerda' ? { left: x } : { right: x }),
      width: g.largura,
      // Press-in de botão (design.md §5): a opacidade cai enquanto o dedo está em cima.
      opacity: apertado.get() ? 0.7 : 1,
    };
  });
  const conteudo = useAnimatedStyle(() => {
    const g = botaoNoArrasto(j, n, revelado.get(), botao, cheio.get(), Radius.md);
    const x = g.recuo + g.conteudo;
    return lado === 'esquerda' ? { left: x } : { right: x };
  });
  return (
    <GestureDetector gesture={toque}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        // O leitor de tela ativa pela ação, não pelo gesto.
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={() => tocar(label)}
        // Base OPACA sob a cor: o vermelho de apagar (`dangerSoft`) é translúcido, e cobrindo o
        // "Mais" até o fim deixava ver o ícone e o rótulo dele através.
        style={[styles.botao, { backgroundColor: base, zIndex: j }, caixa]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: fundo }]} />
        {fio ? <View style={[styles.fio, lado === 'esquerda' ? styles.fioNaEsquerda : styles.fioNaDireita, { backgroundColor: fio }]} /> : null}
        <Animated.View style={[styles.conteudo, { width: botao }, conteudo]}>{children}</Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // A faixa mora na borda de FORA do painel e cresce para dentro com o dedo.
  faixa: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden' },
  faixaNaDireita: { right: 0 },
  faixaNaEsquerda: { left: 0 },
  // `overflow: hidden`: o botão que encolhe (os outros, até o fim) não deixa o conteúdo vazar.
  // Cada botão é absoluto na faixa (`botaoNoArrasto`); o de fora cobre o de dentro.
  botao: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden' },
  // O conteúdo fica na largura natural, parado: o botão só o DESCOBRE.
  conteudo: { position: 'absolute', top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: Space.xs, paddingHorizontal: Space.xs },
  fio: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  fioNaEsquerda: { left: 0 },
  fioNaDireita: { right: 0 },
  // Rótulo não parte palavra nem trunca: centraliza e quebra entre palavras (design.md §3).
  rotulo: { textAlign: 'center', flexShrink: 0, maxWidth: '100%' },
  recorteCard: { borderRadius: Radius.md, borderCurve: 'continuous', overflow: 'hidden' },
});
