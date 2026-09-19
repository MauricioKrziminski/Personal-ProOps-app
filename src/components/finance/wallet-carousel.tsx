import { useEffect, useMemo, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type AnimatedRef,
  type SharedValue,
} from 'react-native-reanimated';

import { CardFace } from '@/components/finance/card-face';
import { useFlightHidden } from '@/components/motion/flight-layer';
import { alturaDoCartao, proporcaoDoCartao, walletStageWidth } from '@/design/card-geometry';
import {
  alvoDoDeslize,
  comElastico,
  distanciaDoItem,
  indiceNoDeslocamento,
  indiceTocado,
  quadroDoItem,
} from '@/design/carousel-math';
import { Motion, Space } from '@/design/tokens';

type CartaoDaVitrine = { account_id: string; name: string; overdue_count: number };

/** A largura do cartão em pé, em frações da tela: sobra um pedaço de cada vizinho, como no vídeo. */
const LARGURA_EM_PE = 0.5;
const VAO = Space.lg;
/** Folga acima e abaixo: o giro em perspectiva cresce a borda de perto para fora da caixa. */
const FOLGA = Space.xl;
const PERSPECTIVA = 900;
const ANDROID = Platform.OS === 'android';
/** Quanto o dedo anda antes de o gesto decidir o eixo. */
const LIMIAR_DO_EIXO = 10;
/** Quanto arrastar para baixo (ou com que velocidade) para fechar. */
const LIMIAR_DE_FECHAR = 120;
const VELOCIDADE_DE_FECHAR = 800;

/** A geometria do carrossel numa tela — a Carteira usa a mesma conta para o resto do layout. */
export function useGeometriaDaVitrine(availableWidth?: number) {
  const { width, fontScale } = useWindowDimensions();
  const largura = walletStageWidth(width, availableWidth);
  const emPe = Math.round(largura * LARGURA_EM_PE);
  // Em pé, a altura da caixa é o LADO LONGO do cartão deitado.
  const deitado = emPe * proporcaoDoCartao(fontScale);
  return { largura, emPe, deitado, passo: emPe + VAO, altura: deitado + FOLGA * 2 };
}

/**
 * O carrossel da Carteira: cartões em pé, com o do centro girando no eixo Y enquanto troca.
 *
 * ## Um gesto só, que decide o eixo
 *
 * Trocar de cartão (horizontal) e fechar a Carteira (para baixo, com a página no topo) moram no
 * MESMO `Pan`, com ativação manual: o primeiro movimento além de 10pt escolhe o eixo, e para cima
 * o gesto desiste e a página rola. Eram dois gestos aninhados, e no iOS o de fechar (pai)
 * cancelava o deslize (filho) em todo arrasto que não fosse um peteleco — medido: `onBegin` e
 * `onFinalize` sem `onStart`, o cartão parado debaixo do dedo.
 *
 * ## Guiado pelo dedo, não por um `ScrollView` (16/09/2026)
 *
 * A primeira versão era um `ScrollView` horizontal com `snapToInterval`, e a troca terminava com
 * um PUXÃO — a queixa foi *"antes um pouco de terminar a animação indo para o outro cartão, ele
 * meio que puxa"*. Medido no emulador: o cartão andava quatro quadros e saltava para o fim. A
 * posição inicial ia como `contentOffset`, que mudava no meio do deslize (o cartão ativo troca
 * ali) e o scroll obedecia; e o encaixe nativo em `decelerationRate="fast"` para seco de todo
 * jeito, diferente em cada sistema.
 *
 * Agora o deslocamento é UM valor na UI thread (`x`): o dedo o move, e ao soltar uma mola parte
 * da velocidade do dedo e assenta no cartão escolhido (`alvoDoDeslize`, um cartão por deslize).
 * Sem emenda entre o dedo e a mola, e igual nas duas plataformas. Tocar durante a mola segura o
 * cartão onde ele está — e só segura: não escolhe (`parouAMola`).
 *
 * ## Tocar é escolher (19/09/2026, decisão do dono do produto)
 *
 * Deslizar é FOLHEAR: não grava nada. Tocar num cartão — o do centro ou um vizinho — o faz o
 * cartão da frente da pilha e fecha a Carteira (`onEscolher`). O vizinho primeiro vem ao centro
 * e só escolhe quando a mola TERMINA: um toque novo no meio dela cancela a mola (`onBegin` do
 * pan) e com ela a escolha, então dá para mudar de ideia. Os textos embaixo trocam já no toque
 * (`onIndice`), junto com a mola, como no deslize.
 *
 * O `Tap` e o `Pan` são exclusivos, com o pan na frente: o toque só vale se o dedo não andou o
 * bastante para decidir um eixo. Qual cartão foi tocado sai do ponto do toque e do deslocamento
 * VIVO (`indiceTocado`), não do cartão ativo — com a mola andando, é o que está sob o dedo.
 *
 * Cada cartão em pé é a face DEITADA girada 90°: o mesmo desenho da pilha, então o voo que chega
 * aqui pousa sem salto. A `moldura` é o lugar do cartão do centro, parada — a âncora `vitrine`.
 */
export function WalletCarousel({
  geometry: g,
  cards,
  indice,
  onIndice,
  onEscolher,
  x,
  arrasto,
  pagina,
  topoDaPagina,
  onFechar,
  prenderMoldura,
  molduraPosicionada,
}: {
  geometry: ReturnType<typeof useGeometriaDaVitrine>;
  cards: CartaoDaVitrine[];
  /** O cartão ativo. A posição inicial sai dele só na montagem; depois quem manda é o dedo. */
  indice: number;
  onIndice: (indice: number) => void;
  /** O toque num cartão: escolhê-lo para a frente da pilha e fechar. Chamado uma vez só. */
  onEscolher: (indice: number) => void;
  /** O deslocamento horizontal — da Carteira, porque os títulos e os pontos também leem dele. */
  x: SharedValue<number>;
  /** O deslocamento do arraste para fechar (a Carteira controla o gesto). */
  arrasto: SharedValue<number>;
  /** A rolagem da página em volta e o quanto ela rolou: fechar arrastando só vale no topo. */
  pagina?: AnimatedRef<Animated.ScrollView>;
  topoDaPagina?: SharedValue<number>;
  /** Arrastar o cartão para baixo além do limiar fecha a Carteira; recebe o quanto desceu. */
  onFechar?: (dy: number) => void;
  /** A âncora `vitrine` (de `useFlightAnchor`), presa na moldura parada. */
  prenderMoldura: (v: View | null) => void;
  molduraPosicionada: () => void;
}) {
  const reduzir = useReducedMotion();
  const total = cards.length;
  const [inicioDaVitrine] = useState(() => ({ indice, passo: g.passo }));
  const indiceAtual = useRef(indice);
  const passoAnterior = useRef(g.passo);
  const inicio = useSharedValue(0);
  const folga = useSharedValue(0);
  const toque = useSharedValue({ x: 0, y: 0 });
  const modo = useSharedValue<'nenhum' | 'deslize' | 'fechar' | 'fechando'>('nenhum');
  // Fora do `modo` porque o `onBegin` o zera a cada toque: fechando, nenhum toque escolhe mais.
  const fechando = useSharedValue(false);
  // O cartão que a Carteira mostra, na UI thread: o assentar só avisa quando ele muda.
  const mostrado = useSharedValue(indice);
  // Este toque terminou como TOQUE: o assentar do pan não pode passar por cima da mola dele.
  const tocou = useSharedValue(false);
  // O toque pegou o carrossel ANDANDO: ele só segura (e o pan assenta no mais perto), não escolhe.
  const parouAMola = useSharedValue(false);

  useEffect(() => {
    x.set(inicioDaVitrine.indice * inicioDaVitrine.passo);
  }, [inicioDaVitrine, x]);

  useEffect(() => {
    indiceAtual.current = indice;
    mostrado.set(indice);
  }, [indice, mostrado]);

  // Rotação/Split View muda o passo físico, não o cartão escolhido. Reposiciona apenas nessa
  // mudança de geometria; uma mudança normal de índice continua sendo guiada pela mola do gesto.
  useEffect(() => {
    if (passoAnterior.current === g.passo) return;
    passoAnterior.current = g.passo;
    x.set(indiceAtual.current * g.passo);
  }, [g.passo, x]);

  const tique = () => Haptics.selectionAsync();

  // O háptico marca a passagem de um cartão para o outro, no meio do caminho.
  useAnimatedReaction(
    () => indiceNoDeslocamento(x.get(), g.passo, total),
    (atual, anterior) => {
      if (anterior !== null && atual !== anterior) runOnJS(tique)();
    },
    [g.passo, total]
  );

  const passo = g.passo;
  const largura = g.largura;
  const gesto = useMemo(() => {
    const assentar = (destino: number, velocidade: number) => {
      'worklet';
      x.set(withSpring(destino * passo, { ...Motion.spring.carrossel, velocity: velocidade }));
    };
    const escolher = (i: number) => {
      'worklet';
      if (fechando.get()) return;
      fechando.set(true);
      runOnJS(onEscolher)(i);
    };
    const pan = Gesture.Pan()
      .manualActivation(true)
      .onBegin(() => {
        // O dedo segura o cartão onde ele estiver, inclusive no meio da mola. Medido ANTES de
        // cancelar: fora de um múltiplo do passo, o carrossel estava em movimento.
        parouAMola.set(Math.abs(x.get() - Math.round(x.get() / passo) * passo) >= 1);
        cancelAnimation(x);
        modo.set('nenhum');
        tocou.set(false);
      })
      .onTouchesDown((e) => {
        const t = e.allTouches[0];
        if (t) toque.set({ x: t.absoluteX, y: t.absoluteY });
      })
      .onTouchesMove((e, estado) => {
        const t = e.allTouches[0];
        if (!t || modo.get() !== 'nenhum') return;
        const dx = t.absoluteX - toque.get().x;
        const dy = t.absoluteY - toque.get().y;
        if (Math.abs(dx) > LIMIAR_DO_EIXO && Math.abs(dx) > Math.abs(dy)) {
          modo.set('deslize');
          estado.activate();
        } else if (dy > LIMIAR_DO_EIXO && dy > Math.abs(dx)) {
          // Para baixo só fecha com a página no topo; rolada, o gesto é dela.
          if (onFechar && topoDaPagina && topoDaPagina.get() <= 1) {
            modo.set('fechar');
            estado.activate();
          } else estado.fail();
        } else if (dy < -LIMIAR_DO_EIXO) estado.fail();
      })
      .onStart((e) => {
        inicio.set(x.get());
        // A folga até decidir o eixo não vira salto: o cartão parte de onde está.
        folga.set(modo.get() === 'deslize' ? e.translationX : e.translationY);
      })
      .onUpdate((e) => {
        if (modo.get() === 'deslize') {
          x.set(comElastico(inicio.get() - (e.translationX - folga.get()), passo, total));
        } else if (modo.get() === 'fechar') {
          arrasto.set(Math.max(0, e.translationY - folga.get()));
        }
      })
      .onEnd((e) => {
        if (modo.get() === 'deslize') {
          const velocidade = -e.velocityX;
          const alvo = alvoDoDeslize(inicio.get(), x.get(), velocidade, passo, total);
          assentar(alvo, velocidade);
          // A troca do cartão ativo (números, fatura pré-carregada) sai JUNTO com a mola, não no
          // meio do arraste: um re-render no meio do gesto não disputa quadro com o dedo.
          mostrado.set(alvo);
          runOnJS(onIndice)(alvo);
        } else if (modo.get() === 'fechar' && onFechar) {
          const dy = Math.max(0, e.translationY - folga.get());
          if (dy > LIMIAR_DE_FECHAR || e.velocityY > VELOCIDADE_DE_FECHAR) {
            modo.set('fechando');
            fechando.set(true);
            runOnJS(onFechar)(dy);
          }
        }
      })
      .onFinalize(() => {
        const m = modo.get();
        if (m === 'fechando') return;
        if (m === 'fechar') arrasto.set(withSpring(0, Motion.spring.encaixe));
        // Um toque sem deslize pode ter parado a mola no meio: volta ao cartão mais perto — e
        // AVISA, senão o carrossel pousava num cartão e os números embaixo mostravam outro.
        // ⚠️ No Android o orquestrador do RNGH ativa o toque que esperava (`onEnd` dele) ANTES de
        // entregar o fim do pan que falhou: sem `tocou`, este assentar substituía a mola do toque,
        // o callback dela vinha com `terminou = false`, e o vizinho tocado nunca escolhia.
        if (m !== 'deslize' && !tocou.get()) {
          const perto = indiceNoDeslocamento(x.get(), passo, total);
          assentar(perto, 0);
          if (perto !== mostrado.get()) {
            mostrado.set(perto);
            runOnJS(onIndice)(perto);
          }
        }
      });
    // Com a página: os dois andam juntos até o eixo ser decidido, e a rolagem vence para cima.
    const panComPagina = pagina
      ? pan.simultaneousWithExternalGesture(pagina as unknown as React.RefObject<React.ComponentType>)
      : pan;
    /*
      O toque só vale depois de o pan falhar (é o que o `Exclusive` garante); a ordem entre o
      `onFinalize` do pan e este `onEnd` varia por plataforma, e `tocou` a torna irrelevante. O
      centro escolhe na hora; o vizinho vem ao centro e escolhe no fim da mola — só se ela
      terminou (`terminou`): um toque novo no meio a cancela, e cancelar é mudar de ideia.
    */
    const tap = Gesture.Tap().onEnd((e, sucesso) => {
      // Tocar para PARAR um deslize em curso é segurar, não escolher: a pessoa quer olhar o
      // cartão, e fechar a Carteira ali trocaria o padrão sem ela ter pedido.
      if (!sucesso || fechando.get() || parouAMola.get()) return;
      tocou.set(true);
      const i = indiceTocado(e.x, largura, x.get(), passo, total);
      if (i !== mostrado.get()) {
        mostrado.set(i);
        runOnJS(onIndice)(i);
      }
      if (Math.abs(x.get() - i * passo) < 1) {
        escolher(i);
        return;
      }
      x.set(
        withSpring(i * passo, Motion.spring.carrossel, (terminou) => {
          if (terminou) escolher(i);
        })
      );
    });
    return Gesture.Exclusive(panComPagina, tap);
  }, [
    x,
    inicio,
    folga,
    toque,
    modo,
    fechando,
    mostrado,
    tocou,
    parouAMola,
    arrasto,
    passo,
    largura,
    total,
    onIndice,
    onEscolher,
    onFechar,
    pagina,
    topoDaPagina,
  ]);

  // Arrastar para baixo: o cartão desce e encolhe em volta do próprio centro.
  const arrastado = useAnimatedStyle(() => {
    const dy = arrasto.get();
    return { transform: [{ translateY: dy }, { scale: 1 - Math.min(dy / 900, 0.25) }] };
  });

  // Leitor de tela: o carrossel é um controle ajustável, com o nome do cartão como valor, e o
  // toque duplo (`activate`) escolhe o cartão mostrado — o mesmo caminho do toque no centro.
  const passarPara = (delta: number) => {
    const destino = Math.min(total - 1, Math.max(0, indice + delta));
    if (destino === indice) return;
    x.set(withSpring(destino * passo, Motion.spring.carrossel));
    onIndice(destino);
  };
  const escolherPeloLeitor = () => {
    if (fechando.get()) return;
    fechando.set(true);
    x.set(indice * passo);
    onEscolher(indice);
  };

  return (
    <GestureDetector gesture={gesto}>
      <Animated.View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Cartões"
        accessibilityValue={{ text: cards[indice]?.name ?? '' }}
        accessibilityHint="Toque duas vezes para pôr este cartão na frente."
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]}
        onAccessibilityAction={(e) => {
          const acao = e.nativeEvent.actionName;
          if (acao === 'activate') escolherPeloLeitor();
          else passarPara(acao === 'increment' ? 1 : -1);
        }}
        style={[styles.palco, { width: g.largura, height: g.altura }, arrastado]}>
        {cards.map((card, i) => (
          <CartaoEmPe
            key={card.account_id}
            card={card}
            indice={i}
            x={x}
            passo={passo}
            esquerda={(g.largura - g.emPe) / 2}
            emPe={g.emPe}
            deitado={g.deitado}
            reduzir={reduzir}
          />
        ))}
        <View
          ref={prenderMoldura}
          onLayout={molduraPosicionada}
          pointerEvents="none"
          style={[styles.moldura, { left: (g.largura - g.emPe) / 2, top: FOLGA, width: g.emPe, height: g.deitado }]}
        />
      </Animated.View>
    </GestureDetector>
  );
}

function CartaoEmPe({
  card,
  indice,
  x,
  passo,
  esquerda,
  emPe,
  deitado,
  reduzir,
}: {
  card: CartaoDaVitrine;
  indice: number;
  x: SharedValue<number>;
  passo: number;
  /** Onde fica o cartão do centro — todos partem daí e andam pelo próprio transform. */
  esquerda: number;
  emPe: number;
  deitado: number;
  reduzir: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const oculto = useFlightHidden(`vitrine:${card.account_id}`);
  /*
    ⚠️ **A posição mora NO MESMO transform do giro, e não num trilho transladado por fora.** Com o
    trilho animado e o giro 3D nos filhos, o iOS desenhava um cartão duas vezes — o do centro
    reaparecia sobre o vizinho da direita (medido no simulador). Um transform só por cartão.

    A ordem difere por plataforma: no Android `perspective` precisa ser o PRIMEIRO item (fora
    dele é ignorado, e lá ela vira a distância de câmera da própria view, então a translação não
    a afeta); no iOS ela vem DEPOIS da translação, para o ponto de fuga ser o centro do cartão e
    o giro sair simétrico.
  */
  const giro = useAnimatedStyle(() => {
    const d = distanciaDoItem(x.get(), passo, indice);
    const q = quadroDoItem(d, reduzir);
    const translateX = -d * passo;
    const rotateY = `${q.giroY}deg`;
    return {
      opacity: q.opacidade,
      transform: ANDROID
        ? [{ perspective: PERSPECTIVA }, { translateX }, { rotateY }, { scale: q.escala }]
        : [{ translateX }, { perspective: PERSPECTIVA }, { rotateY }, { scale: q.escala }],
    };
  });
  // A face deitada tem `deitado × altura`; girada 90° em volta do centro, ocupa `emPe × deitado`.
  const altura = alturaDoCartao(deitado, fontScale);

  return (
    <Animated.View style={[styles.cartao, { left: esquerda, width: emPe, height: deitado }, giro]}>
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
  // Sem `overflow: hidden`: os vizinhos passam das bordas da tela, e o giro, da caixa.
  palco: { alignSelf: 'center' },
  cartao: { position: 'absolute', top: FOLGA },
  moldura: { position: 'absolute' },
  deitada: { position: 'absolute', transform: [{ rotate: '90deg' }] },
});
