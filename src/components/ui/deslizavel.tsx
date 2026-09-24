import * as Haptics from 'expo-haptics';
import { useFocusEffect, useSegments } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
// O `Pressable` do gesture-handler: o da RN, dentro do painel do `ReanimatedSwipeable`, não
// recebe o toque no Android (o gesto nativo do arrasto fica com ele) — medido no emulador.
import { Gesture, GestureDetector, Pressable, type GestureTouchEvent } from 'react-native-gesture-handler';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { DentroDeArrasto } from '@/components/ui/money';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import {
  abriuOLado,
  cardAberto,
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

  // Os botões leem a lista MAIS NOVA na hora do toque: o painel só é redesenhado quando o que
  // aparece nele muda (a assinatura), então o `onPress` guardado nele pode ser de outro render.
  const atual = useRef({ direita: lados.direita, esquerda, pontas: lados });
  useEffect(() => {
    atual.current = { direita: lados.direita, esquerda, pontas: lados };
  });
  const tocar = useCallback((acao: ItemAction) => {
    const viva = [...atual.current.direita, ...atual.current.esquerda].find((x) => x.label === acao.label) ?? acao;
    eu.current?.close();
    viva.onPress?.();
  }, []);
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
    const ponta = pedido.lado === 'direita' ? pontas.pontaDireita : pontas.pontaEsquerda;
    if (ponta) tocar(ponta);
  }, [pedido, tocar]);
  const nDireita = lados.direita.length;
  const nEsquerda = esquerda.length;
  const pontaD = Boolean(lados.pontaDireita);
  const pontaE = Boolean(lados.pontaEsquerda);
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
    }),
    [inicio, armado, abertoAntes, largura, direita, esquerdaSV, nDireita, nEsquerda, pontaD, pontaE, botao],
  );
  // Este gesto só observa o dedo: nunca ativa, e corre junto do arrasto da biblioteca.
  const dedo = useMemo(
    () =>
      Gesture.Manual()
        .onTouchesDown((e) => marcarInicio(soltura, e))
        .onTouchesUp((e) => {
          const lado = ladoQueExecuta(soltura, e);
          if (lado) runOnJS(setPedido)({ lado });
        }),
    [soltura],
  );
  const assinatura = (lista: ItemAction[]) =>
    lista.map((x) => [x.label, x.curto, x.icon, x.destructive, x.desfaz].join('|')).join('¦');
  const chaveDireita = assinatura(lados.direita);
  const chaveEsquerda = assinatura(esquerda);
  const pontaDireita = Boolean(lados.pontaDireita);
  const pontaEsquerda = Boolean(lados.pontaEsquerda);

  const renderDireita = useCallback(
    (_p: SharedValue<number>, translation: SharedValue<number>) => (
      <Painel lado="direita" acoes={lados.direita} temPonta={pontaDireita} botao={botao} translation={translation} largura={largura} estado={direita} tocar={tocar} />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a assinatura É a dependência da lista
    [chaveDireita, pontaDireita, botao, largura, direita, tocar],
  );
  const renderEsquerda = useCallback(
    (_p: SharedValue<number>, translation: SharedValue<number>) => (
      <Painel lado="esquerda" acoes={esquerda} temPonta={pontaEsquerda} botao={botao} translation={translation} largura={largura} estado={esquerdaSV} tocar={tocar} />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a assinatura É a dependência da lista
    [chaveEsquerda, pontaEsquerda, botao, largura, esquerdaSV, tocar],
  );

  return (
    // O gesto do soltar mora FORA do arrasto: com o painel aberto a biblioteca põe o conteúdo em
    // `pointerEvents: 'box-only'`, e preso a ele o gesto deixava de ver o dedo — continuar
    // arrastando a partir do painel aberto não executava mais.
    <GestureDetector gesture={dedo}>
      <View
        collapsable={false}
        // Um toque num card com OUTRO aberto só fecha o aberto — não navega no mesmo toque. No
        // próprio card aberto o toque passa: é ele que aperta os botões revelados.
        onStartShouldSetResponderCapture={() => cardAberto.toqueEmOutro(meu)}
        onLayout={(e) => largura.set(e.nativeEvent.layout.width)}>
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
          childrenContainerStyle={forma === 'linha' ? { backgroundColor: theme[fundo] } : undefined}
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
            for (const l of [direita, esquerdaSV]) {
              l.passou.set(false);
              l.desligouEm.set(0);
            }
            cardAberto.fechou(meu);
          }}>
          <DentroDeArrasto.Provider value>{children}</DentroDeArrasto.Provider>
        </ReanimatedSwipeable>
      </View>
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
  return executa ? lado : null;
}

function useLado(): Lado {
  const passou = useSharedValue(false);
  const desligouEm = useSharedValue(0);
  const abriu = useSharedValue(false);
  return useMemo(() => ({ passou, desligouEm, abriu }), [passou, desligouEm, abriu]);
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
}: {
  lado: 'direita' | 'esquerda';
  acoes: ItemAction[];
  temPonta: boolean;
  botao: number;
  translation: SharedValue<number>;
  largura: SharedValue<number>;
  estado: Lado;
  tocar: (acao: ItemAction) => void;
}) {
  const theme = useTheme();
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

  return (
    <Animated.View style={[styles.painel, lado === 'esquerda' && styles.painelEsquerda]}>
      {acoes.map((acao, i) => {
        // Vermelho só para o que apaga; Arquivar e "Mais" são neutros (spec do arrasto). O neutro
        // usa `backgroundSelected`: no escuro o `backgroundElement` quase não se distinguia da linha.
        const cor = acao.destructive
          ? { fundo: theme.dangerSoft, tinta: 'danger' as const }
          : lado === 'direita'
            ? { fundo: theme.tintFill, tinta: 'onTint' as const }
            : { fundo: theme.backgroundSelected, tinta: 'text' as const };
        return (
          <Pressable
            key={acao.label}
            accessibilityRole="button"
            accessibilityLabel={acao.label}
            onPress={() => tocar(acao)}
            style={({ pressed }) => [
              styles.botao,
              { width: botao, backgroundColor: cor.fundo },
              pressed && styles.pressionado,
            ]}>
            {/* Dois neutros lado a lado ("Mais" e "Arquivar") liam como um bloco só: um fio da cor
                do fundo separa um botão do outro. É `View`, não borda — o botão nativo do
                gesture-handler não desenha borda de um lado só no Android. */}
            {i > 0 ? <View style={[styles.fio, { backgroundColor: theme.background }]} /> : null}
            {acao.icon ? <Icon name={acao.icon} size="md" color={cor.tinta} /> : null}
            <ThemedText type="caption" themeColor={cor.tinta} style={styles.rotulo}>
              {acao.curto ?? acao.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  painel: { flexDirection: 'row' },
  painelEsquerda: { justifyContent: 'flex-end' },
  botao: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.xs,
  },
  fio: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 1 },
  // Press-in de botão (design.md §5): a opacidade cai enquanto o dedo está em cima.
  pressionado: { opacity: 0.7 },
  // Rótulo não parte palavra nem trunca: centraliza e quebra entre palavras (design.md §3).
  rotulo: { textAlign: 'center', flexShrink: 0, maxWidth: '100%' },
  recorteCard: { borderRadius: Radius.md, borderCurve: 'continuous', overflow: 'hidden' },
});
