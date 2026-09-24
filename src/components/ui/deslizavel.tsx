import * as Haptics from 'expo-haptics';
import { useFocusEffect, useSegments } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
// O `Pressable` do gesture-handler: o da RN, dentro do painel do `ReanimatedSwipeable`, não
// recebe o toque no Android (o gesto nativo do arrasto fica com ele) — medido no emulador.
import { Pressable } from 'react-native-gesture-handler';
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
  passouAteOFim,
  passouHaPouco,
  temArrasto,
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
  const atual = useRef({ direita: lados.direita, esquerda });
  useEffect(() => {
    atual.current = { direita: lados.direita, esquerda };
  });
  const tocar = useCallback((acao: ItemAction) => {
    const viva = [...atual.current.direita, ...atual.current.esquerda].find((x) => x.label === acao.label) ?? acao;
    eu.current?.close();
    viva.onPress?.();
  }, []);
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
    <View
      // Um toque num card com OUTRO aberto só fecha o aberto — não navega no mesmo toque. No
      // próprio card aberto o toque passa: é ele que aperta os botões revelados.
      onStartShouldSetResponderCapture={() => cardAberto.toqueEmOutro(meu)}
      onLayout={(e) => largura.set(e.nativeEvent.layout.width)}>
      <ReanimatedSwipeable
        ref={eu}
        enabled={tem}
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
          // Ao soltar: o dedo passou do fim DO LADO que abriu, com ação que se desfaz? `right` é o
          // conteúdo indo para a direita — o painel `direita`. Executa JÁ, sem esperar a mola
          // assentar no painel (no WhatsApp a ação sai ao soltar).
          const lado = direcao === 'right' ? direita : esquerdaSV;
          const ponta = direcao === 'right' ? lados.pontaDireita : lados.pontaEsquerda;
          if (ponta && passouHaPouco(lado.passou.get(), lado.desligouEm.get(), Date.now())) tocar(ponta);
        }}
        // Fechando, o card já não é "o aberto": um toque noutro card logo em seguida navega.
        onSwipeableWillClose={() => cardAberto.fechou(meu)}
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
  );
}

type Lado = { passou: SharedValue<boolean>; desligouEm: SharedValue<number>; abriu: SharedValue<boolean> };

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
