import { useState } from 'react';
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

/** O que a pilha precisa de um cartão. Um subconjunto do `card_summary`, não a linha inteira. */
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

/** Quanto cada cartão de trás aparece por baixo do da frente. */
const PEEK = 14;
/** E quanto ele encolhe, para o empilhamento ler como profundidade e não como lista. */
const SHRINK = 0.04;

/**
 * A carteira: os cartões empilhados, o da frente aberto.
 *
 * Substitui uma lista de `Row`s — que respondia "quantos cartões existem" quando a pergunta real
 * é "quanto vou pagar e quando". Empilhados, os de trás continuam presentes (a pessoa vê que tem
 * três) sem cobrar três linhas de altura, e o da frente tem espaço para o que importa: o total
 * da fatura, a data de fechamento e quanto de limite sobrou.
 *
 * Tocar em um cartão de trás traz ele para a frente. É a interação que o gesto físico sugere, e
 * é a razão de a pilha existir em vez de um carrossel: não há o que descobrir, os outros cartões
 * estão à vista.
 *
 * **Sem cor de bandeira.** O desenho de referência pinta cada cartão com a cor do banco; aqui a
 * paleta é monocromática e a única cor é semântica, então quem separa um cartão do outro é a
 * posição na pilha e o nome. Pintar de roxo o cartão do Nubank traria a cor de outra marca para
 * dentro de uma tela que não tem cor própria.
 */
export function CardStack({
  cards,
  onOpen,
}: {
  cards: StackedCard[];
  onOpen: (card: StackedCard) => void;
}) {
  const [frente, setFrente] = useState(0);
  const visiveis = cards.slice(0, 3);

  return (
    <View style={[styles.palco, { height: 176 + (visiveis.length - 1) * PEEK }]}>
      {visiveis.map((card, i) => {
        // A ordem de desenho é a de PROFUNDIDADE: quem está na frente é o último da lista.
        const profundidade = (i - frente + visiveis.length) % visiveis.length;
        return (
          <CardFace
            key={card.account_id}
            card={card}
            depth={profundidade}
            total={visiveis.length}
            onPress={() => (profundidade === 0 ? onOpen(card) : setFrente(i))}
          />
        );
      })}
    </View>
  );
}

function CardFace({
  card,
  depth,
  total,
  onPress,
}: {
  card: StackedCard;
  depth: number;
  total: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const press = useSharedValue(1);

  const animado = useAnimatedStyle(() => ({
    // Mola porque teve dedo envolvido (regra de movimento §5): a troca de carta é um gesto, e
    // timing linear faria a pilha parecer um slideshow.
    transform: [
      { translateY: withSpring(depth * PEEK, Motion.spring.settle) },
      { scale: withSpring((1 - depth * SHRINK) * press.get(), Motion.spring.settle) },
    ],
    zIndex: total - depth,
    opacity: withSpring(depth === 0 ? 1 : 0.55, Motion.spring.settle),
  }));

  const aberto = depth === 0;
  const limite = Number(card.credit_limit_cents ?? 0);
  const usado = Number(card.invoice_total_cents ?? 0);
  const proporcao = limite > 0 ? Math.min(1, usado / limite) : 0;

  return (
    <Animated.View style={[styles.slot, animado]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          aberto
            ? `${card.name}, fatura de ${formatBRL(usado)}`
            : `Trazer ${card.name} para a frente`
        }
        onPressIn={() => press.set(withTiming(Motion.pressScale, { duration: Motion.duration.fast }))}
        onPressOut={() => press.set(withTiming(1, { duration: Motion.duration.fast }))}
        onPress={onPress}
        style={[
          styles.card,
          { backgroundColor: aberto ? theme.heroSurface : theme.surface, borderColor: theme.cardBorder },
        ]}>
        <View style={styles.topo}>
          <View style={styles.nomeWrap}>
            <ThemedText type="headline" numberOfLines={1} themeColor="onHero">
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
          <Icon name="creditcard" size="md" color="onHeroMuted" />
        </View>

        {aberto ? (
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
                      { width: `${Math.round(proporcao * 100)}%`, backgroundColor: theme.onHero },
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
  card: {
    minHeight: 176,
    padding: Space.gutter,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    gap: Space.md,
  },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  nomeWrap: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, flex: 1, minWidth: 0 },
  pill: { paddingHorizontal: Space.sm, paddingVertical: Space.half, borderRadius: Radius.pill },
  faturaRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Space.md },
  faturaWrap: { flex: 1, minWidth: 0, gap: Space.xs },
  fechaWrap: { alignItems: 'flex-end', gap: Space.xs },
  trilho: { height: 4, borderRadius: Radius.xs, overflow: 'hidden' },
  preenchido: { height: '100%', borderRadius: Radius.xs },
  rodape: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
});
