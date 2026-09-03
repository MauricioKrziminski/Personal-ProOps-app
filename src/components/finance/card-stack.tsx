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
import { GradientSurface } from '@/components/ui/gradient';
import { Money } from '@/components/ui/money';
import { alpha, blend, brandColor, CHIP_GOLD } from '@/design/card-brands';
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

/**
 * Altura do cartão.
 *
 * Numa calha de 16 a face fica com 358 de largura, o que dá ~1,75:1 — a proporção que o export
 * usa. Um cartão de crédito real é 1,586:1; o desenho é um tico mais largo de propósito, porque
 * o conteúdo (fatura + fechamento + limite + titular) não cabe na proporção exata sem apertar.
 */
const CARD_H = 202;
/** Quanto de cada cartão de trás aparece ACIMA do da frente, com a pilha fechada. */
const PEEK = 14;
/** Quanto cada cartão de trás recua de cada lado — é o `inset-x-2` / `inset-x-4` do export. */
const INSET = 8;
/**
 * O passo da pilha ABERTA.
 *
 * O bastante para o cabeçalho de cada cartão (bandeira, nome, número) e a fileira do chip
 * aparecerem inteiros. Menor que isso e o leque vira uma pilha de listras; maior e a carteira
 * ocupa a tela toda.
 */
const SPREAD = 92;

/**
 * A carteira: cartões DE VERDADE empilhados, que abrem em leque ao toque.
 *
 * ## O que mudou em 03/09/2026
 *
 * A versão anterior desenhava um card de conteúdo (chip redondo com um ícone, nome, fatura) e,
 * ao abrir, virava uma pilha de tiras de 46px — "abriu em formato de card, ficou feio". Duas
 * coisas estavam erradas e as duas são estruturais:
 *
 * 1. **Não tinha anatomia de cartão.** O export desenha o objeto físico: chip EMV dourado,
 *    contactless, fatura em display, barra de limite, e a cor do emissor no
 *    fundo. Sem isso nenhuma proporção salva — lê como card, porque é um card.
 * 2. **A pilha crescia para baixo.** Os cartões de trás apareciam ABAIXO do da frente. Numa
 *    carteira real (e no Wallet, e no export) eles aparecem ACIMA e mais estreitos: é a borda
 *    superior de cada um saindo por trás do de cima. Para baixo, a pilha lê como lista.
 *
 * Aberta, cada cartão continua sendo um CARTÃO inteiro, só deslocado — o leque mostra o topo de
 * cada um e o último por completo.
 *
 * ## A cor
 *
 * Vem do emissor (`design/card-brands.ts`), misturada com preto para o fundo e pura no ponto da
 * bandeira e na barra de limite. Decisão do dono do produto em 03/09/2026, contra a regra
 * anterior — o histórico está no cabeçalho daquele arquivo.
 *
 * ## O toque
 *
 * Fechada, tocar em qualquer cartão ABRE o leque. Aberta, tocar num cartão fecha a pilha com ele
 * na frente. O botão da fatura é SEPARADO: um toque só não pode decidir entre "ver os outros" e
 * "abrir a fatura".
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
  /** A largura do palco, para o estreitamento dos cartões de trás virar `scaleX` (§5). */
  const [largura, setLargura] = useState(0);
  const visiveis = cards.slice(0, 6);
  const atras = visiveis.length - 1;

  // Fechada, a pilha é o cartão da frente mais a faixa de cada um dos de trás EM CIMA dele.
  // Aberta, é um passo por cartão mais a altura do último, que aparece inteiro.
  const altura = aberta ? atras * SPREAD + CARD_H : CARD_H + atras * PEEK;

  const palco = useAnimatedStyle(() => ({
    height: withSpring(altura, Motion.spring.settle),
  }));

  const escolher = (i: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!aberta) {
      // Fechada, os cartões de trás são alvos de 14px — mirar neles seria loteria. Qualquer
      // toque abre, e a escolha acontece no leque, onde cada alvo tem 92px.
      setAberta(true);
      return;
    }
    setFrente(i);
    setAberta(false);
  };

  return (
    <Animated.View
      style={[styles.palco, palco]}
      onLayout={(e) => setLargura(e.nativeEvent.layout.width)}>
      {visiveis.map((card, i) => {
        /*
          O escolhido vai para a frente e **o resto NÃO se mexe**.

          Antes isto era uma rotação (`(i - frente + n) % n`), que é o que uma pilha de baralho
          faz: escolher o segundo cartão jogava o primeiro lá para trás e a ordem inteira
          embaralhava a cada toque. Numa carteira o usuário memoriza a posição — "o laranja é o
          do meio" — e reordenar sozinho apaga essa memória.

          Agora a profundidade é: o escolhido em 0, e os outros na ORDEM ORIGINAL logo abaixo.
        */
        const profundidade = i === frente ? 0 : 1 + (i < frente ? i : i - 1);
        return (
          <CardFace
            key={card.account_id}
            card={card}
            depth={profundidade}
            index={i}
            total={visiveis.length}
            atras={atras}
            largura={largura}
            aberta={aberta}
            onPress={() => escolher(i)}
            onOpen={() => onOpen(card)}
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
  atras,
  largura,
  aberta,
  onPress,
  onOpen,
}: {
  card: StackedCard;
  depth: number;
  index: number;
  total: number;
  atras: number;
  largura: number;
  aberta: boolean;
  onPress: () => void;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const press = useSharedValue(1);

  const marca = brandColor(card.name);

  /**
   * Fechada: o da frente encosta no fundo do palco e cada um de trás sobe uma faixa, com recuo
   * lateral crescente. Aberta: uma fileira de cartões inteiros, um passo cada.
   */
  /*
    Aberta e fechada usam a MESMA ordem (`depth`), nunca o índice do array.

    Com `index` no leque, abrir a carteira reordenava a pilha na cara do usuário: o cartão da
    frente saltava para a posição dele na lista e os outros se reorganizavam em volta. Uma
    carteira que se embaralha ao abrir não é uma carteira.
  */
  const y = aberta ? depth * SPREAD : (atras - depth) * PEEK;
  /**
   * O estreitamento dos cartões de trás, como ESCALA e não como `left`/`right`.
   *
   * O recuo é simétrico, então ele é exatamente um `scaleX` — e §5 do design manda animar só
   * `transform` e `opacity` em worklet: `left`/`right` disparam layout a cada frame.
   */
  const encolhe = aberta || largura <= 0 ? 1 : (largura - depth * INSET * 2) / largura;

  const animado = useAnimatedStyle(() => ({
    transform: [
      { translateY: withSpring(y, Motion.spring.settle) },
      // A multiplicação vai DENTRO do `withSpring`. Fora, o Reanimated não intercepta a chamada
      // no objeto de estilo e o resultado vira `NaN` — a view some sem erro nenhum no log.
      { scaleX: withSpring(encolhe, Motion.spring.settle) },
      { scale: withSpring(press.get(), Motion.spring.settle) },
    ],
    // Fechada, quem está na frente desenha por cima. Aberta, quem está EMBAIXO desenha por cima,
    // senão o leque volta a ser uma pilha.
    zIndex: aberta ? depth : total - depth,
  }));

  const limite = Number(card.credit_limit_cents ?? 0);
  const usado = Number(card.invoice_total_cents ?? 0);
  const proporcao = limite > 0 ? Math.min(1, usado / limite) : 0;

  return (
    <Animated.View style={[styles.slot, animado]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          `${card.name}, fatura de ${formatBRL(usado)}. ` +
          (aberta ? 'Toque para trazer para a frente.' : 'Toque para abrir a carteira.')
        }
        onPressIn={() => press.set(withTiming(Motion.pressScale, { duration: Motion.duration.fast }))}
        onPressOut={() => press.set(withTiming(1, { duration: Motion.duration.fast }))}
        onPress={onPress}
        style={[
          styles.card,
          {
            borderColor: alpha(marca, 0.35),
            // A cor de base embaixo do gradiente. O `GradientSurface` só monta o canvas depois
            // que a `View` mede, e sem isto o cartão pisca transparente no primeiro frame.
            backgroundColor: blend(marca, theme.heroBottom, 0.06),
          },
        ]}>
        {/*
          O fundo do cartão: a cor do emissor puxada quase toda para o preto, mais um brilho da
          própria cor saindo pelo canto. É o `from-[#1d142b] to-[#0c0a13]` do export, calculado em
          vez de digitado — assim um banco novo entra no mapa e ganha o cartão certo de graça.
        */}
        <GradientSurface
          from={blend(marca, theme.heroTop, 0.14)}
          to={blend(marca, theme.heroBottom, 0.06)}
          sheen={alpha(marca, 0.22)}
          sheenSize={90}
        />

        {/* Cabeçalho: a bandeira e o nome do cartão. */}
        <View style={styles.topo}>
          <View style={styles.nomeWrap}>
            <View style={[styles.bandeira, { backgroundColor: marca }]} />
            <ThemedText
              type="small"
              themeColor="onHero"
              numberOfLines={1}
              style={styles.shrink}>
              {card.name}
            </ThemedText>
            {card.overdue_count > 0 ? (
              <View style={[styles.pill, { backgroundColor: theme.heroChip }]}>
                <ThemedText type="meta" themeColor="onHeroDanger">
                  ATRASADA
                </ThemedText>
              </View>
            ) : null}
          </View>
          {/*
            Onde o export põe "•••• 4301" não vai NADA.
            O schema não guarda os quatro últimos dígitos, e a primeira versão daqui derivava
            quatro dígitos do UUID da conta. Num app de finanças isso lê como o número real do
            cartão — alguém compara com o cartão físico e conclui que o app está errado. Dado que
            não existe não vira enfeite; se a pílula fizer falta, o caminho é uma coluna `last4`.
          */}
        </View>

        {/*
          Chip EMV e contactless. É a fileira que faz o objeto ser lido como cartão antes de
          qualquer número ser lido — e é exatamente o que faltava na versão anterior.
        */}
        <View style={styles.fisico}>
          <View style={styles.chip}>
            <GradientSurface from={CHIP_GOLD.top} to={CHIP_GOLD.bottom} />
            <View style={[styles.chipGrade, { borderColor: theme.overlay }]} />
          </View>
          <Icon name="wave.3.right" size="md" color="onHeroMuted" />
        </View>

        {/* Fatura e fechamento. */}
        <View style={styles.faturaRow}>
          <View style={styles.faturaWrap}>
            <ThemedText type="meta" themeColor="onHeroMuted">
              FATURA ATUAL
            </ThemedText>
            <Money cents={usado} variant="title" tone="onHero" concealable />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Abrir a fatura de ${card.name}`}
            hitSlop={Space.sm}
            onPress={onOpen}
            style={styles.fechaWrap}>
            <ThemedText type="meta" themeColor="onHeroMuted">
              {card.closing_date ? 'FECHA EM' : 'SEM FATURA'}
            </ThemedText>
            <View style={styles.fechaValor}>
              {card.closing_date ? (
                <ThemedText type="ticker" themeColor="onHero" style={tabular}>
                  {formatDateBR(card.closing_date)}
                </ThemedText>
              ) : null}
              <Icon name="chevron.right" size="xs" color="onHeroMuted" />
            </View>
          </Pressable>
        </View>

        {/* Barra de limite, na cor da marca. É o único lugar em que ela aparece pura e larga. */}
        <View style={[styles.trilho, { backgroundColor: theme.heroSeparator }]}>
          <View
            style={[
              styles.preenchido,
              { width: `${Math.round(proporcao * 100)}%`, backgroundColor: marca },
            ]}
          />
        </View>

        {/* Rodapé do cartão: titular à esquerda, disponível à direita. */}
        <View style={styles.rodape}>
          <ThemedText type="meta" themeColor="onHeroMuted" numberOfLines={1} style={styles.shrink}>
            {card.due_date ? `VENCE ${formatDateBR(card.due_date)}` : 'SEM VENCIMENTO'}
          </ThemedText>
          {limite > 0 ? (
            <View style={styles.disponivel}>
              <ThemedText type="caption" themeColor="onHeroMuted">
                Disponível:
              </ThemedText>
              <ThemedText type="code" themeColor="onHeroSuccess" style={tabular}>
                {formatBRL(Number(card.available_limit_cents ?? 0))}
              </ThemedText>
            </View>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  palco: { width: '100%' },
  slot: { position: 'absolute', top: 0, left: 0, right: 0 },
  shrink: { flex: 1, minWidth: 0 },
  card: {
    height: CARD_H,
    padding: Space.gutter,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  nomeWrap: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, flex: 1, minWidth: 0 },
  /** O ponto da bandeira: 10px de cor pura, o único respingo de marca fora da barra de limite. */
  bandeira: { width: 10, height: 10, borderRadius: Radius.pill },
  pill: { paddingHorizontal: Space.sm, paddingVertical: Space.half, borderRadius: Radius.pill },
  fisico: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  chip: {
    width: 36,
    height: 28,
    borderRadius: Radius.xs,
    borderCurve: 'continuous',
    overflow: 'hidden',
    padding: 4,
  },
  /** O quadrado interno do chip — o desenho de contato, resolvido com uma borda só. */
  chipGrade: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 2, opacity: 0.6 },
  faturaRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Space.md },
  faturaWrap: { flex: 1, minWidth: 0, gap: Space.half },
  fechaWrap: { alignItems: 'flex-end', gap: Space.half },
  fechaValor: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  trilho: { height: 6, borderRadius: Radius.xs, overflow: 'hidden' },
  preenchido: { height: '100%', borderRadius: Radius.xs },
  rodape: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  disponivel: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  /** A alça de abrir/fechar — alvo explícito para quem não descobre o toque no cartão. */
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
