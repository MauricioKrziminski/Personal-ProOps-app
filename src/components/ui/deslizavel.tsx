import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { BOTAO, cardAberto, fecharCardAberto, ladosDoArrasto, passouAteOFim, temArrasto } from '@/lib/arrasto';
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
  const eu = useRef<SwipeableMethods>(null);
  // Um objeto estável no registro: o `ref` do gesto só existe enquanto o arrasto está montado.
  const meu = useMemo(() => ({ close: () => eu.current?.close() }), []);
  // Saiu da tela (voltar, trocar de aba) ou desmontou: esquece o aberto daqui.
  useFocusEffect(useCallback(() => () => cardAberto.esquecer(meu), [meu]));
  useEffect(() => () => cardAberto.esquecer(meu), [meu]);
  const largura = useSharedValue(0);
  const passouDireita = useSharedValue(false);
  const passouEsquerda = useSharedValue(false);
  /** A ação da ponta decidida AO SOLTAR — depois a mola volta ao painel e o "passou" desliga. */
  const pendente = useRef<ItemAction | null>(null);

  if (!temArrasto(acoes)) return <>{children}</>;
  const lados = ladosDoArrasto(acoes);

  const tocar = (acao: ItemAction) => {
    eu.current?.close();
    acao.onPress?.();
  };
  const mais: ItemAction = { label: 'Mais', icon: 'ellipsis', onPress: () => showItemActions(titulo, acoes) };
  // Como no WhatsApp: "Mais" por dentro, a ação de tirar na BORDA — é ela que "até o fim" executa.
  const esquerda = lados.mais ? [mais, ...lados.esquerda] : lados.esquerda;

  return (
    <View
      // Um toque num card com OUTRO aberto só fecha o aberto — não navega no mesmo toque. No
      // próprio card aberto o toque passa: é ele que aperta os botões revelados.
      onStartShouldSetResponderCapture={() => cardAberto.toqueEmOutro(meu)}
      onLayout={(e) => largura.set(e.nativeEvent.layout.width)}>
      <ReanimatedSwipeable
        ref={eu}
        friction={1}
        overshootFriction={1}
        // Passar do painel só onde arrastar até o fim faz algo.
        overshootLeft={Boolean(lados.pontaDireita)}
        overshootRight={Boolean(lados.pontaEsquerda)}
        leftThreshold={BOTAO / 2}
        rightThreshold={BOTAO / 2}
        // No iPhone a borda esquerda é o "voltar" do sistema: o arrasto começa depois dela.
        hitSlop={Platform.OS === 'ios' ? { left: -Space.xl } : undefined}
        containerStyle={forma === 'card' ? styles.recorteCard : undefined}
        childrenContainerStyle={forma === 'linha' ? { backgroundColor: theme[fundo] } : undefined}
        renderLeftActions={
          lados.direita.length
            ? (_p, translation) => (
                <Painel lado="direita" acoes={lados.direita} temPonta={Boolean(lados.pontaDireita)} translation={translation} largura={largura} passou={passouDireita} tocar={tocar} />
              )
            : undefined
        }
        renderRightActions={
          esquerda.length
            ? (_p, translation) => (
                <Painel lado="esquerda" acoes={esquerda} temPonta={Boolean(lados.pontaEsquerda)} translation={translation} largura={largura} passou={passouEsquerda} tocar={tocar} />
              )
            : undefined
        }
        onSwipeableWillOpen={(direcao) => {
          cardAberto.abriu(meu);
          // Ao soltar: o dedo passou do fim DO LADO que abriu, com ação que se desfaz? `right` é o
          // conteúdo indo para a direita — o painel `direita`.
          pendente.current =
            direcao === 'right'
              ? passouDireita.get() ? lados.pontaDireita : null
              : passouEsquerda.get() ? lados.pontaEsquerda : null;
          if (!pendente.current) Haptics.selectionAsync();
        }}
        onSwipeableOpen={() => {
          const ponta = pendente.current;
          pendente.current = null;
          if (ponta) tocar(ponta);
        }}
        onSwipeableClose={() => {
          passouDireita.set(false);
          passouEsquerda.set(false);
          cardAberto.fechou(meu);
        }}>
        <DentroDeArrasto.Provider value>{children}</DentroDeArrasto.Provider>
      </ReanimatedSwipeable>
    </View>
  );
}

function Painel({
  lado,
  acoes,
  temPonta,
  translation,
  largura,
  passou,
  tocar,
}: {
  lado: 'direita' | 'esquerda';
  acoes: ItemAction[];
  temPonta: boolean;
  translation: SharedValue<number>;
  largura: SharedValue<number>;
  passou: SharedValue<boolean>;
  tocar: (acao: ItemAction) => void;
}) {
  const theme = useTheme();
  // Cruzou o ponto de "até o fim": marca e dá o toque leve — uma vez por cruzamento.
  useAnimatedReaction(
    () => passouAteOFim(translation.get(), lado, largura.get(), acoes.length, temPonta),
    (agora, antes) => {
      if (agora === antes) return;
      passou.set(agora);
      if (agora) runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
    },
  );

  return (
    <Animated.View style={[styles.painel, lado === 'esquerda' && styles.painelEsquerda]}>
      {acoes.map((acao) => {
        const cor = acao.destructive
          ? { fundo: theme.dangerSoft, tinta: 'danger' as const }
          : lado === 'direita'
            ? { fundo: theme.tintFill, tinta: 'onTint' as const }
            : { fundo: theme.backgroundElement, tinta: 'text' as const };
        return (
          <Pressable
            key={acao.label}
            accessibilityRole="button"
            accessibilityLabel={acao.label}
            onPress={() => tocar(acao)}
            style={[styles.botao, { backgroundColor: cor.fundo }]}>
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
    width: BOTAO,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.xs,
  },
  // Rótulo não parte palavra nem trunca: centraliza e quebra entre palavras (design.md §3).
  rotulo: { textAlign: 'center', flexShrink: 0, maxWidth: '100%' },
  recorteCard: { borderRadius: Radius.md, borderCurve: 'continuous', overflow: 'hidden' },
});
