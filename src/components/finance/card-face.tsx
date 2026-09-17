import { LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import { Pressable, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useBRL } from '@/components/ui/conceal';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { SkiaCanvas } from '@/components/ui/skia-canvas';
import { ProgressBar } from '@/components/ui/sparkline';
import { brandColor, clarear, escurecer, tintaDoCartao } from '@/design/card-brands';
import { LARGURA_DE_DESENHO, alturaDoCartao } from '@/design/card-geometry';
import { Radius, Space, tabular } from '@/design/tokens';
import { formatBRL, formatDateBR } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';

/**
 * As três tintas de uma face: a do texto, a do texto secundário e a das pílulas.
 *
 * A face é a cor do EMISSOR nos dois temas, então as tintas também não seguem o tema: sobre o
 * roxo do Nubank vai a clara (`onHero*`, a mesma do herói escuro), sobre o amarelo do BB vai a
 * escura. Quem decide é o contraste (`tintaDoCartao`), não uma lista de bancos.
 */
export function tintasDoCartao(nome: string) {
  const marca = brandColor(nome);
  return tintaDoCartao(marca) === 'clara'
    ? ({ marca, tinta: 'onHero', suave: 'onHeroMuted', chip: 'heroChip' } as const)
    : ({ marca, tinta: 'onCardInk', suave: 'onCardInkMuted', chip: 'cardInkChip' } as const);
}

/**
 * A face do cartão de crédito — o cartão metálico de canto 18 dos vídeos, na cor do banco.
 *
 * ## Um desenho, qualquer tamanho
 *
 * O conteúdo é desenhado SEMPRE em `LARGURA_DE_DESENHO` e escalado para `largura`. É o que torna
 * o voo entre telas invisível (`flight-layer.tsx`): o clone voando e o cartão onde ele pousa são
 * o mesmo desenho, então o pouso não tem salto de tamanho de letra. Pelo mesmo motivo a miniatura
 * de 56px é esta face, não um retângulo colorido.
 *
 * "Em pé" (a Carteira) é esta face girada 90° por quem a usa — o desenho é sempre deitado.
 *
 * ## O que mora aqui e o que não
 *
 * A face desenha o metal, o nome, o estado de atraso e o contactless. A BASE é de quem usa
 * (`children`): a pilha mostra fatura, fechamento, limite e disponível; a fatura mostra o total
 * dela; a vitrine da Carteira não mostra nada, como no vídeo. O chip EMV saiu com a direção
 * Suave (não existe nos vídeos).
 */
export function CardFace({
  nome,
  largura,
  atrasada = false,
  children,
  style,
}: {
  nome: string;
  largura: number;
  atrasada?: boolean;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const altura = alturaDoCartao(largura, fontScale);
  const t = tintasDoCartao(nome);

  return (
    <View style={[styles.face, { width: largura, height: altura, backgroundColor: t.marca }, style]}>
      <Metal marca={t.marca} largura={largura} altura={altura} />
      <View
        style={[
          styles.desenho,
          {
            width: LARGURA_DE_DESENHO,
            height: alturaDoCartao(LARGURA_DE_DESENHO, fontScale),
            transform: [{ scale: largura / LARGURA_DE_DESENHO }],
          },
        ]}>
        <View style={styles.topo}>
          <View style={styles.nomeLinha}>
            {/* `flexShrink: 0` + `maxWidth`: o nome é identificador e quebra a linha inteira,
                nunca encolhe até sumir (§3 do design). */}
            <ThemedText type="headline" themeColor={t.tinta} style={styles.nome}>
              {nome}
            </ThemedText>
            {atrasada ? (
              <View style={[styles.pilula, { backgroundColor: theme[t.chip] }]}>
                <Icon name="exclamationmark.triangle.fill" size="xs" color={t.tinta} />
                <ThemedText type="meta" themeColor={t.tinta}>
                  Atrasada
                </ThemedText>
              </View>
            ) : null}
          </View>
          <Icon name="wave.3.right" size="md" color={t.suave} />
        </View>
        {children}
      </View>
    </View>
  );
}

/**
 * O metal: a cor do banco com um degradê diagonal curto (mais clara no canto de cima, mais escura
 * no de baixo) e uma faixa de brilho. Curto de propósito — a tinta foi escolhida pelo contraste
 * com a cor PURA, e um degradê largo tiraria o texto dessa faixa.
 */
function Metal({ marca, largura, altura }: { marca: string; largura: number; altura: number }) {
  const theme = useTheme();
  return (
    <SkiaCanvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={largura} height={altura}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(largura, altura)}
          colors={[clarear(marca, 0.14), marca, escurecer(marca, 0.16)]}
        />
      </Rect>
      <Rect x={0} y={0} width={largura} height={altura}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(largura, altura)}
          positions={[0.3, 0.45, 0.6]}
          colors={[theme.cardSheenClear, theme.cardSheen, theme.cardSheenClear]}
        />
      </Rect>
    </SkiaCanvas>
  );
}

/** O mínimo que a base da pilha precisa de um cartão (um recorte do `card_summary`). */
export interface CartaoDaPilha {
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
 * A base do cartão no Financeiro: fatura atual, o botão da fatura, limite, vencimento e
 * disponível. `onFatura` ausente desenha o mesmo conteúdo sem botão — é o clone do voo.
 */
export function BaseDaPilha({ card, onFatura }: { card: CartaoDaPilha; onFatura?: () => void }) {
  // O disponível é saldo: obedece ao "esconder saldo" como o resto do app.
  const brl = useBRL();
  const t = tintasDoCartao(card.name);
  const limite = Number(card.credit_limit_cents ?? 0);
  const usado = Number(card.invoice_total_cents ?? 0);

  const fecha = (
    <>
      <ThemedText type="meta" themeColor={t.suave}>
        {card.closing_date ? 'fecha em' : 'sem fatura'}
      </ThemedText>
      <View style={styles.fechaValor}>
        {card.closing_date ? (
          <ThemedText type="ticker" themeColor={t.tinta} style={tabular}>
            {formatDateBR(card.closing_date)}
          </ThemedText>
        ) : null}
        <Icon name="chevron.right" size="xs" color={t.suave} />
      </View>
    </>
  );

  return (
    <View style={styles.base}>
      <View style={styles.faturaLinha}>
        <View style={styles.fatura}>
          <ThemedText type="meta" themeColor={t.suave}>
            Fatura atual
          </ThemedText>
          <Money cents={usado} variant="title" tone={t.tinta} concealable />
        </View>
        {/* Um toque só não decide entre "ver os cartões" e "abrir a fatura": a fatura tem o
            botão dela, e o resto do cartão abre a Carteira. */}
        {onFatura ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Abrir a fatura de ${card.name}`}
            hitSlop={Space.md}
            onPress={onFatura}
            style={({ pressed }) => [styles.fecha, { opacity: pressed ? 0.6 : 1 }]}>
            {fecha}
          </Pressable>
        ) : (
          <View style={styles.fecha}>{fecha}</View>
        )}
      </View>

      {limite > 0 ? <ProgressBar value={usado} max={limite} tone={t.tinta} track={t.chip} /> : null}

      <View style={styles.rodape}>
        {/* `flexShrink: 0`: a data é a informação, não o complemento (§3 do design). */}
        <ThemedText type="meta" themeColor={t.suave} style={styles.rigido}>
          {card.due_date ? `vence ${formatDateBR(card.due_date)}` : 'sem vencimento'}
        </ThemedText>
        {limite > 0 ? (
          <ThemedText type="meta" themeColor={t.suave} style={tabular}>
            disponível {brl(Number(card.available_limit_cents ?? 0))}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

/** O rótulo do cartão para leitor de tela — o mesmo em todo lugar em que a face é tocável. */
export function rotuloDoCartao(card: Pick<CartaoDaPilha, 'name' | 'invoice_total_cents'>) {
  return `${card.name}, fatura de ${formatBRL(Number(card.invoice_total_cents ?? 0))}`;
}

const styles = StyleSheet.create({
  face: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  desenho: {
    position: 'absolute',
    top: 0,
    left: 0,
    transformOrigin: 'top left',
    padding: Space.gutter,
    justifyContent: 'space-between',
  },
  topo: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Space.sm },
  nomeLinha: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.sm },
  nome: { flexShrink: 0, maxWidth: '100%' },
  pilula: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.half,
    borderRadius: Radius.pill,
  },
  base: { gap: Space.sm },
  faturaLinha: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Space.md },
  fatura: { flex: 1, minWidth: 0, gap: Space.half },
  fecha: { alignItems: 'flex-end', gap: Space.half },
  fechaValor: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  rodape: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  rigido: { flexShrink: 0, maxWidth: '100%' },
});
