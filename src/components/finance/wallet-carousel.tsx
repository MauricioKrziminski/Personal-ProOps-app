import { useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';

import { CardFace } from '@/components/finance/card-face';
import { useFlightHidden } from '@/components/motion/flight-layer';
import { alturaDoCartao, proporcaoDoCartao } from '@/design/card-geometry';
import { distanciaDoItem, indiceNoDeslocamento, quadroDoItem } from '@/design/carousel-math';
import { Space } from '@/design/tokens';

type CartaoDaVitrine = { account_id: string; name: string; overdue_count: number };

/** A largura do cartão em pé, em frações da tela: sobra um pedaço de cada vizinho, como no vídeo. */
const LARGURA_EM_PE = 0.5;
const VAO = Space.lg;
/** Folga acima e abaixo: o giro em perspectiva cresce a borda de perto para fora da caixa. */
const FOLGA = Space.xl;
const PERSPECTIVA = 900;

/** A geometria do carrossel numa tela — a Carteira usa a mesma conta para o resto do layout. */
export function useGeometriaDaVitrine() {
  const { width, fontScale } = useWindowDimensions();
  const emPe = Math.round(width * LARGURA_EM_PE);
  // Em pé, a altura da caixa é o LADO LONGO do cartão deitado.
  const deitado = emPe * proporcaoDoCartao(fontScale);
  return { largura: width, emPe, deitado, passo: emPe + VAO, altura: deitado + FOLGA * 2 };
}

/**
 * O carrossel da Carteira: cartões em pé, com o do centro girando no eixo Y enquanto troca.
 *
 * Tudo sai de UM valor — o deslocamento horizontal —, na UI thread (`carousel-math.ts`). Cada
 * cartão em pé é a face DEITADA girada 90°: o mesmo desenho da pilha, então o voo que chega aqui
 * pousa sem salto.
 *
 * A `moldura` é o lugar do cartão do centro, PARADA por cima do scroll: é a âncora do voo
 * (`vitrine`). O cartão que pousa é sempre o do centro, e medir o item rolando mediria o
 * deslocamento de um scroll que talvez ainda não tenha assentado.
 */
export function WalletCarousel({
  cards,
  indiceInicial,
  onIndice,
  x,
  arrasto,
  prenderMoldura,
  molduraPosicionada,
}: {
  cards: CartaoDaVitrine[];
  indiceInicial: number;
  onIndice: (indice: number) => void;
  /** O deslocamento horizontal — da Carteira, porque os títulos e os pontos também leem dele. */
  x: SharedValue<number>;
  /** O deslocamento do arraste para fechar (a Carteira controla o gesto). */
  arrasto: SharedValue<number>;
  /** A âncora `vitrine` (de `useFlightAnchor`), presa na moldura parada. */
  prenderMoldura: (v: View | null) => void;
  molduraPosicionada: () => void;
}) {
  const g = useGeometriaDaVitrine();
  const reduzir = useReducedMotion();
  const scroll = useAnimatedRef<Animated.ScrollView>();
  const posicionado = useRef(false);

  const aoRolar = useAnimatedScrollHandler({
    onScroll: (e) => {
      x.set(e.contentOffset.x);
    },
    // O último evento de uma rolagem pode cair no `scrollEventThrottle`; o fim dela não.
    onMomentumEnd: (e) => {
      x.set(e.contentOffset.x);
    },
  });

  const trocou = (indice: number) => {
    Haptics.selectionAsync();
    onIndice(indice);
  };

  useAnimatedReaction(
    () => indiceNoDeslocamento(x.get(), g.passo, cards.length),
    (atual, anterior) => {
      if (anterior !== null && atual !== anterior) runOnJS(trocou)(atual);
    },
    [cards.length, g.passo]
  );

  // Arrastar para baixo: o cartão desce e encolhe em volta do próprio centro.
  const arrastado = useAnimatedStyle(() => {
    const dy = arrasto.get();
    return { transform: [{ translateY: dy }, { scale: 1 - Math.min(dy / 900, 0.25) }] };
  });

  return (
    <View style={{ height: g.altura }}>
      <Animated.ScrollView
        ref={scroll}
        horizontal
        onScroll={aoRolar}
        scrollEventThrottle={16}
        snapToInterval={g.passo}
        decelerationRate="fast"
        disableIntervalMomentum
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: indiceInicial * g.passo, y: 0 }}
        /*
          ⚠️ **A posição inicial é escrita à mão em `x`.** No iOS o scroll emite um evento em 0 ao
          montar e o `contentOffset` logo em seguida cai no `scrollEventThrottle`: o carrossel
          mostrava o cartão certo e `x` ficava em 0 — título, pontos e giro do cartão 0, e o
          cartão da frente apagado como vizinho (medido no simulador). No Android o
          `contentOffset` inicial nem é garantido, daí o `scrollTo`.
        */
        onLayout={() => {
          if (posicionado.current) return;
          posicionado.current = true;
          scroll.current?.scrollTo({ x: indiceInicial * g.passo, animated: false });
          x.set(indiceInicial * g.passo);
        }}
        style={[styles.scroll, arrastado]}
        contentContainerStyle={{
          paddingHorizontal: (g.largura - g.emPe) / 2,
          paddingVertical: FOLGA,
          gap: VAO,
        }}>
        {cards.map((card, i) => (
          <CartaoEmPe
            key={card.account_id}
            card={card}
            indice={i}
            x={x}
            passo={g.passo}
            emPe={g.emPe}
            deitado={g.deitado}
            reduzir={reduzir}
          />
        ))}
      </Animated.ScrollView>
      <View
        ref={prenderMoldura}
        onLayout={molduraPosicionada}
        pointerEvents="none"
        style={[styles.moldura, { left: (g.largura - g.emPe) / 2, top: FOLGA, width: g.emPe, height: g.deitado }]}
      />
    </View>
  );
}

function CartaoEmPe({
  card,
  indice,
  x,
  passo,
  emPe,
  deitado,
  reduzir,
}: {
  card: CartaoDaVitrine;
  indice: number;
  x: SharedValue<number>;
  passo: number;
  emPe: number;
  deitado: number;
  reduzir: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const oculto = useFlightHidden(`vitrine:${card.account_id}`);
  const giro = useAnimatedStyle(() => {
    const q = quadroDoItem(distanciaDoItem(x.get(), passo, indice), reduzir);
    return {
      opacity: q.opacidade,
      // `perspective` PRIMEIRO: no Android, fora da primeira posição ele é ignorado.
      transform: [{ perspective: PERSPECTIVA }, { rotateY: `${q.giroY}deg` }, { scale: q.escala }],
    };
  });
  // A face deitada tem `deitado × altura`; girada 90° em volta do centro, ocupa `emPe × deitado`.
  const altura = alturaDoCartao(deitado, fontScale);

  return (
    <Animated.View style={[{ width: emPe, height: deitado }, giro]}>
      <Animated.View style={[StyleSheet.absoluteFill, oculto]}>
        <View
          style={[
            styles.deitada,
            { width: deitado, height: altura, left: (emPe - deitado) / 2, top: (deitado - altura) / 2 },
          ]}>
          <CardFace nome={card.name} largura={deitado} atrasada={card.overdue_count > 0} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // `visible`: o giro em perspectiva passa um pouco da caixa, e cortado ele lê como defeito.
  scroll: { flexGrow: 0, overflow: 'visible' },
  moldura: { position: 'absolute' },
  deitada: { position: 'absolute', transform: [{ rotate: '90deg' }] },
});
