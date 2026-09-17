import { useState } from 'react';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';

import { BaseDaPilha, CardFace, FaceEmVoo, rotuloDoCartao } from '@/components/finance/card-face';
import { useFlight, useFlightAnchor, useFlightHidden } from '@/components/motion/flight-layer';
import { PressableScale } from '@/components/motion/pressable-scale';
import { alturaDoCartao } from '@/design/card-geometry';
import { Motion, Space } from '@/design/tokens';
import { useCartaoEscolhido } from '@/hooks/use-cartao-escolhido';
import type { CartaoDaPilha } from '@/lib/card-status';
import { useBRL } from '@/components/ui/conceal';

/** O que a pilha precisa de um cartão. Um recorte do `card_summary`, não a linha inteira. */
export type StackedCard = CartaoDaPilha;

/** Quanto de cada cartão de trás aparece ACIMA do da frente. */
const PEEK = 12;
/** Quanto cada cartão de trás recua de cada lado. */
const RECUO = 8;
/** Quantos cartões a pilha desenha; o resto está a um deslize, na Carteira. */
const VISIVEIS = 6;

/**
 * A carteira do Financeiro: os cartões empilhados, sempre fechados.
 *
 * ## O toque (fase 4 do Suave, 16/09/2026)
 *
 * Tocar na pilha LEVANTA o cartão da frente e o leva voando até a Carteira, onde ele fica em pé
 * num carrossel — o vídeo de referência. O leque que abria aqui e a alça ▾/▴ saíram: trocar de
 * cartão é deslizar na Carteira, a um toque. O botão da fatura continua NA face ("fecha em ›"),
 * separado do resto do cartão: um toque só não decide entre "ver os cartões" e "abrir a fatura".
 *
 * ## A ordem
 *
 * O escolhido vai para a frente e **o resto NÃO se mexe** — os outros ficam na ordem original
 * logo atrás. Numa carteira o usuário memoriza a posição ("o laranja é o do meio"), e uma rotação
 * de baralho apagaria essa memória. A escolha vem de `useCartaoEscolhido`, a mesma loja que a
 * Carteira grava: trocar lá reordena aqui por baixo, e o cartão volta voando para a frente certa.
 *
 * Fechada, os de trás aparecem ACIMA e mais estreitos — como uma carteira de verdade e como o
 * Wallet. Para baixo, a pilha leria como lista.
 */
export function CardStack({
  cards,
  onOpen,
}: {
  cards: StackedCard[];
  /** A fatura do cartão — o botão "fecha ›" da face. */
  onOpen: (card: StackedCard) => void;
}) {
  const brl = useBRL();
  const escolhido = useCartaoEscolhido();
  const frente = Math.max(0, cards.findIndex((c) => c.account_id === escolhido));
  const naFrente = cards[frente];

  const { width, fontScale } = useWindowDimensions();
  const [largura, setLargura] = useState(width - Space.lg * 2);
  const cardH = alturaDoCartao(largura, fontScale);
  const visiveis = cards.slice(0, VISIVEIS);
  const atras = visiveis.length - 1;

  const { voar } = useFlight();
  const { prender, aoPosicionar } = useFlightAnchor('pilha');

  const abrirCarteira = () => {
    if (!naFrente) return;
    const id = naFrente.account_id;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void voar({
      de: 'pilha',
      poseDe: 'deitado',
      esconderDe: `pilha:${id}`,
      para: 'vitrine',
      posePara: 'em-pe',
      esconderPara: `vitrine:${id}`,
      desenho: (progresso) => (
        <FaceEmVoo
          nome={naFrente.name}
          atrasada={naFrente.overdue_count > 0}
          progresso={progresso}
          baseDe={<BaseDaPilha card={naFrente} />}
        />
      ),
    }).then((ok) => ok && router.push({ pathname: '/finance/wallet', params: { card: id, origem: 'pilha' } }));
  };

  if (!naFrente) return null;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${rotuloDoCartao(naFrente, brl)}. Toque para abrir a carteira.`}
      // O "fecha ›" mora DENTRO deste botão, e o leitor de tela não alcança botão aninhado: a
      // fatura vira uma ação do próprio cartão.
      accessibilityActions={[{ name: 'fatura', label: 'Abrir a fatura' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'fatura') onOpen(naFrente);
      }}
      scaleTo={0.985}
      onPress={abrirCarteira}
      onLayout={(e) => setLargura(e.nativeEvent.layout.width)}
      style={{ height: atras * PEEK + cardH }}>
      {visiveis.map((card, i) => {
        const profundidade = i === frente ? 0 : 1 + (i < frente ? i : i - 1);
        return (
          <CartaoNaPilha
            key={card.account_id}
            card={card}
            profundidade={profundidade}
            total={visiveis.length}
            y={(atras - profundidade) * PEEK}
            encolhe={largura > 0 ? (largura - profundidade * RECUO * 2) / largura : 1}
            largura={largura}
            onFatura={profundidade === 0 ? () => onOpen(card) : undefined}
          />
        );
      })}
      {/* A âncora do voo: o lugar do cartão da frente, parado — quem estiver na frente pousa aqui. */}
      <View
        ref={prender}
        onLayout={aoPosicionar}
        pointerEvents="none"
        style={[styles.ancora, { top: atras * PEEK, height: cardH }]}
      />
    </PressableScale>
  );
}

function CartaoNaPilha({
  card,
  profundidade,
  total,
  y,
  encolhe,
  largura,
  onFatura,
}: {
  card: StackedCard;
  profundidade: number;
  total: number;
  y: number;
  encolhe: number;
  largura: number;
  onFatura?: () => void;
}) {
  const oculto = useFlightHidden(`pilha:${card.account_id}`);
  // `withSpring` direto no valor da propriedade: fora dela (multiplicado) o Reanimated não
  // intercepta e a view some sem erro (§1 do design).
  const posicao = useAnimatedStyle(() => ({
    transform: [
      { translateY: withSpring(y, Motion.spring.encaixe) },
      { scaleX: withSpring(encolhe, Motion.spring.encaixe) },
    ],
    // Quem está mais embaixo desenha por cima, e quem está mais embaixo é o de menor profundidade.
    zIndex: total - profundidade,
  }));

  return (
    <Animated.View style={[styles.slot, posicao]}>
      <Animated.View style={oculto}>
        <CardFace nome={card.name} largura={largura} atrasada={card.overdue_count > 0}>
          {/* Os de trás só mostram a faixa de cima: a base deles nunca aparece. */}
          {profundidade === 0 ? <BaseDaPilha card={card} onFatura={onFatura} /> : null}
        </CardFace>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', top: 0, left: 0, right: 0 },
  ancora: { position: 'absolute', left: 0, right: 0 },
});
