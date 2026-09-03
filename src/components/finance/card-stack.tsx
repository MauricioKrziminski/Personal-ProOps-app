import { useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import { formatBRL, formatDateBR } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';

/** O que a carteira precisa de um cartão. Um subconjunto do `card_summary`, não a linha inteira. */
export interface StackedCard {
  account_id: string;
  name: string;
  invoice_id: string | null;
  invoice_total_cents: number;
  credit_limit_cents: number | null;
  available_limit_cents: number | null;
  closing_date: string | null;
  due_date: string | null;
  overdue_count: number;
}

/** Altura do cartão da frente, aberto. */
const CARD_H = 178;
/** Quanto cada cartão de trás aparece quando a pilha está FECHADA. */
const PEEK = 15;
/** E quanto ele encolhe, para o empilhamento ler como profundidade e não como lista. */
const SHRINK = 0.045;
/** O passo da pilha ABERTA — o suficiente para o nome e o valor de cada cartão respirarem. */
const SPREAD = 84;

/**
 * A carteira: cartões empilhados que **abrem em leque ao toque**, como o Apple Wallet.
 *
 * ## Os dois estados
 *
 * **Fechada** — o cartão da frente aberto (fatura, fechamento, limite) e os outros aparecendo por
 * uma faixa atrás. Responde "quanto vou pagar e quando" sem cobrar uma linha de altura por
 * cartão, e ainda assim diz quantos existem.
 *
 * **Aberta** — os cartões se afastam e cada um mostra o próprio cabeçalho: nome, bandeira do
 * vencimento e o valor da fatura. Tocar em um deles fecha a pilha com ele na frente.
 *
 * O leque abre para BAIXO e a pilha simplesmente fica mais alta, sem scroll próprio: a página já
 * rola, e uma área rolável dentro de outra rouba o gesto de quem só queria continuar descendo a
 * tela. É a mesma razão de o Wallet abrir o leque na página inteira em vez de numa janelinha.
 *
 * ## Sem cor de bandeira
 *
 * O desenho de referência pinta cada cartão com a cor do banco. Aqui a cor é do sistema, e trazer
 * o roxo do Nubank para dentro da tela seria trazer a marca de outra empresa para o lugar de
 * maior destaque do app. Quem separa um cartão do outro é a posição e o nome.
 */
export function CardStack({
  cards,
  onOpen,
}: {
  cards: StackedCard[];
  onOpen: (card: StackedCard) => void;
}) {
  const [frente, setFrente] = useState(0);
  const [aberta, setAberta] = useState(false);
  const visiveis = cards.slice(0, 6);

  const altura = aberta
    ? (visiveis.length - 1) * SPREAD + CARD_H
    : CARD_H + (visiveis.length - 1) * PEEK;

  const palco = useAnimatedStyle(() => ({
    height: withSpring(altura, Motion.spring.settle),
  }));

  const escolher = (i: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!aberta) {
      // Tocar no cartão da frente ABRE o leque; tocar num de trás também, porque na pilha fechada
      // eles são alvos de 15px e mirar neles é loteria.
      setAberta(true);
      return;
    }
    setFrente(i);
    setAberta(false);
  };

  return (
    <Animated.View style={[styles.palco, palco]}>
      {visiveis.map((card, i) => {
        // Ordem de PROFUNDIDADE quando fechada; ordem da lista quando aberta.
        const profundidade = (i - frente + visiveis.length) % visiveis.length;
        return (
          <CardFace
            key={card.account_id}
            card={card}
            depth={profundidade}
            index={i}
            total={visiveis.length}
            aberta={aberta}
            onPress={() => (aberta || profundidade !== 0 ? escolher(i) : onOpen(card))}
            onLongPress={() => (aberta ? undefined : setAberta(true))}
          />
        );
      })}

      {visiveis.length > 1 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={aberta ? 'Fechar a carteira' : 'Abrir a carteira'}
          hitSlop={Space.sm}
          onPress={() => {
            Haptics.selectionAsync();
            setAberta((v) => !v);
          }}
          style={styles.alca}>
          <Icon name={aberta ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

function CardFace({
  card,
  depth,
  index,
  total,
  aberta,
  onPress,
  onLongPress,
}: {
  card: StackedCard;
  depth: number;
  index: number;
  total: number;
  aberta: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const theme = useTheme();
  const press = useSharedValue(1);

  const y = aberta ? index * SPREAD : depth * PEEK;
  const escala = aberta ? 1 : 1 - depth * SHRINK;
  const opacidade = aberta ? 1 : depth === 0 ? 1 : 0.6;

  const animado = useAnimatedStyle(() => ({
    transform: [
      { translateY: withSpring(y, Motion.spring.settle) },
      { scale: withSpring(escala, Motion.spring.settle) * press.get() },
    ],
    // Aberta, quem está EMBAIXO tem que desenhar por cima — senão o cartão de baixo some atrás
    // do de cima e o leque vira uma pilha again.
    zIndex: aberta ? index : total - depth,
    opacity: withTiming(opacidade, { duration: Motion.duration.fast }),
  }));

  const detalhado = !aberta && depth === 0;
  const limite = Number(card.credit_limit_cents ?? 0);
  const usado = Number(card.invoice_total_cents ?? 0);
  const proporcao = limite > 0 ? Math.min(1, usado / limite) : 0;

  return (
    <Animated.View style={[styles.slot, animado]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          detalhado
            ? `${card.name}, fatura de ${formatBRL(usado)}. Toque para abrir a carteira.`
            : `${card.name}, fatura de ${formatBRL(usado)}`
        }
        onPressIn={() => press.set(withTiming(Motion.pressScale, { duration: Motion.duration.fast }))}
        onPressOut={() => press.set(withTiming(1, { duration: Motion.duration.fast }))}
        onPress={onPress}
        onLongPress={onLongPress}
        style={[
          styles.card,
          {
            minHeight: detalhado ? CARD_H : SPREAD + Space.md,
            backgroundColor: detalhado ? theme.heroSurface : theme.surface,
            borderColor: theme.cardBorder,
          },
        ]}>
        <View style={styles.topo}>
          <View style={styles.nomeWrap}>
            <View style={[styles.chip, { backgroundColor: theme.backgroundSelected }]}>
              <Icon name="creditcard" size="sm" color={detalhado ? 'onHero' : 'text'} />
            </View>
            <ThemedText
              type="headline"
              numberOfLines={1}
              themeColor={detalhado ? 'onHero' : 'text'}
              style={styles.shrink}>
              {card.name}
            </ThemedText>
            {card.overdue_count > 0 ? (
              <View style={[styles.pill, { backgroundColor: theme.dangerSoft }]}>
                <ThemedText type="meta" themeColor="danger">
                  ATRASADA
                </ThemedText>
              </View>
            ) : null}
          </View>
          {!detalhado ? (
            <ThemedText type="ticker" style={tabular}>
              {formatBRL(usado)}
            </ThemedText>
          ) : null}
        </View>

        {detalhado ? (
          <>
            <View style={styles.faturaRow}>
              <View style={styles.faturaWrap}>
                <ThemedText type="meta" themeColor="onHeroMuted">
                  FATURA ATUAL
                </ThemedText>
                <Money cents={usado} variant="money" tone="onHero" concealable />
              </View>
              <View style={styles.fechaWrap}>
                <ThemedText type="meta" themeColor="onHeroMuted">
                  {card.closing_date ? 'FECHA EM' : 'SEM FATURA'}
                </ThemedText>
                {card.closing_date ? (
                  <ThemedText type="ticker" themeColor="onHero" style={tabular}>
                    {formatDateBR(card.closing_date)}
                  </ThemedText>
                ) : null}
              </View>
            </View>

            {limite > 0 ? (
              <>
                <View style={[styles.trilho, { backgroundColor: theme.heroSeparator }]}>
                  <View
                    style={[
                      styles.preenchido,
                      { width: `${Math.round(proporcao * 100)}%`, backgroundColor: theme.tint },
                    ]}
                  />
                </View>
                <View style={styles.rodape}>
                  <ThemedText type="caption" themeColor="onHeroMuted">
                    {card.due_date ? `vence ${formatDateBR(card.due_date)}` : 'sem vencimento'}
                  </ThemedText>
                  <ThemedText type="code" themeColor="onHeroMuted" style={tabular}>
                    {`livre ${formatBRL(Number(card.available_limit_cents ?? 0))}`}
                  </ThemedText>
                </View>
              </>
            ) : null}
          </>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  palco: { width: '100%' },
  slot: { position: 'absolute', left: 0, right: 0, top: 0 },
  shrink: { flex: 1, minWidth: 0 },
  card: {
    padding: Space.gutter,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    gap: Space.md,
  },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  nomeWrap: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, flex: 1, minWidth: 0 },
  chip: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: { paddingHorizontal: Space.sm, paddingVertical: Space.half, borderRadius: Radius.pill },
  faturaRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Space.md },
  faturaWrap: { flex: 1, minWidth: 0, gap: Space.xs },
  fechaWrap: { alignItems: 'flex-end', gap: Space.xs },
  trilho: { height: 4, borderRadius: Radius.xs, overflow: 'hidden' },
  preenchido: { height: '100%', borderRadius: Radius.xs },
  rodape: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  /** A alça de abrir/fechar, no canto — alvo explícito para quem não descobre o toque no cartão. */
  alca: {
    position: 'absolute',
    right: Space.md,
    bottom: -Space.xl,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
