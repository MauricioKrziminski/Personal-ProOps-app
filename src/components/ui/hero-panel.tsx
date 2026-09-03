import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { GradientSurface } from '@/components/ui/gradient';
import { QuickActions, type QuickAction } from '@/components/ui/quick-actions';
import { useConceal } from '@/components/ui/conceal';
import { Motion, Radius, Space, Type } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface HeroPanelProps {
  /** Controle que ESCOPA o número — hoje, o seletor de mês do Financeiro. */
  top?: React.ReactNode;
  /** Badge ou pílula de status opcional na linha do rótulo. */
  badge?: React.ReactNode;
  /** Rótulo curto, caixa alta — **sempre antes do valor** (`HeroLabel`, §2 de design.md). */
  label: string;
  /** O número. Normalmente um `<Money variant="heroMoney" concealable />`. */
  value: React.ReactNode;
  /**
   * A linha logo abaixo do número, com ícone: "12 dias até virar o mês · Projeção positiva".
   *
   * No export ela é `label-code` colorida de `secondary` — mono, porque é dado, e verde porque
   * comunica ESTADO. Vermelha quando o estado é ruim.
   */
  secondary?: { text: string; icon?: React.ComponentProps<typeof Icon>['name']; negative?: boolean };
  /**
   * A faixa do rodapé, que **sangra até as bordas** do card.
   *
   * É um dos dois padrões repetidos do export (o outro é o mesmo rodapé no card de tendência):
   * uma pílula com o delta à esquerda e a comparação em texto corrido à direita, sobre uma
   * superfície um degrau mais escura. Ela existe para o número grande não precisar carregar
   * contexto: o valor responde "quanto", o rodapé responde "comparado com o quê".
   */
  trend?: { value: string; positive?: boolean; label?: string };
  /** Sparkline ou barra. Opcional. */
  chart?: React.ReactNode;
  /** Atalhos de decisão. Somem sozinhos quando não há nada pendente. */
  actions?: QuickAction[];
  /** Liga o botão de olho na linha do rótulo. */
  concealable?: boolean;
  onPress?: () => void;
}

/**
 * O painel de destaque — **o card do topo do Stitch**.
 *
 * ## Anatomia (medida do export)
 *
 * `rounded-xl` (12) com `p-gutter-lg` (20), fundo em gradiente vertical
 * `surface-container-high → low`, um brilho verde difuso saindo pelo canto superior direito e um
 * fio de luz de 1px atravessando o topo. Dentro, nesta ordem: rótulo em caixa alta + botão de
 * olho, o número em `display-hero-mobile` (32/700), a linha de estado em mono colorido, o
 * gráfico, e a faixa de rodapé sangrada.
 *
 * ## O que mudou em 03/09/2026
 *
 * Ele era **tinta chapada** (`heroSurface` sólido) com a espiral da marca como marca d'água. A
 * versão chapada existia para resolver o "sem graça" por contraste, mas continuava lendo como um
 * retângulo escuro com um número dentro. O export resolve o mesmo problema com luz: gradiente +
 * brilho + fio especular. O brilho ocupa o canto onde a marca d'água estava, então ela saiu — a
 * forma da marca continua nos outros quatro papéis (spinner, estado vazio, marcador de IA, ícone).
 *
 * A regra "um destaque por tela" não mudou.
 */
export function HeroPanel({
  top,
  badge,
  label,
  value,
  secondary,
  trend,
  chart,
  actions,
  concealable = false,
  onPress,
}: HeroPanelProps) {
  const theme = useTheme();
  const { concealed, toggle } = useConceal();

  return (
    <Animated.View
      entering={FadeIn.duration(Motion.duration.slow)}
      style={[
        styles.panel,
        {
          borderColor: theme.cardBorder,
          // Base embaixo do gradiente: o `GradientSurface` só monta o canvas depois que a `View`
          // mede, e sem isto o painel pisca transparente no primeiro frame.
          backgroundColor: theme.heroBottom,
        },
      ]}>
      <GradientSurface
        from={theme.heroTop}
        to={theme.heroBottom}
        // O `bg-secondary/10` do export. Fica no accent, que é o único matiz grande do design.
        sheen={`${theme.tint}1F`}
      />
      {/* O fio de luz do topo (`via-primary/20`): é ele que dá a impressão de superfície curva. */}
      <View style={[styles.specular, { backgroundColor: theme.heroSeparator }]} />

      <View style={styles.inner}>
        {top ? <View style={styles.top}>{top}</View> : null}

        <Pressable
          accessibilityRole={onPress ? 'button' : undefined}
          onPress={onPress}
          style={styles.body}>
          <View style={styles.labelRow}>
            <ThemedText type="caption" themeColor="onHeroMuted" style={Type.meta}>
              {label.toUpperCase()}
            </ThemedText>
            {badge}
            {concealable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={concealed ? 'Mostrar valor' : 'Ocultar valor'}
                onPress={toggle}
                hitSlop={Space.sm}
                style={[styles.eye, { backgroundColor: theme.heroChip }]}>
                <Icon name={concealed ? 'eye.slash' : 'eye'} size="sm" color="onHero" />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.valueRow}>{value}</View>

          {secondary ? (
            <View style={styles.secondaryRow}>
              {secondary.icon ? (
                <Icon
                  name={secondary.icon}
                  size="sm"
                  color={secondary.negative ? 'onHeroDanger' : 'onHeroSuccess'}
                />
              ) : null}
              <ThemedText
                type="code"
                themeColor={secondary.negative ? 'onHeroDanger' : 'onHeroSuccess'}
                style={styles.shrink}>
                {secondary.text}
              </ThemedText>
            </View>
          ) : null}

          {chart ? <View style={styles.chart}>{chart}</View> : null}
        </Pressable>

        {actions ? (
          <View style={styles.actions}>
            <QuickActions actions={actions} />
          </View>
        ) : null}
      </View>

      {trend ? (
        <View style={[styles.footer, { backgroundColor: theme.heroFooter }]}>
          <View style={[styles.trendPill, { backgroundColor: theme.heroChip }]}>
            <Icon
              name={trend.positive ? 'arrow.up.right' : 'arrow.down.right'}
              size="sm"
              color={trend.positive ? 'onHeroSuccess' : 'onHeroDanger'}
            />
            <ThemedText
              type="code"
              themeColor={trend.positive ? 'onHeroSuccess' : 'onHeroDanger'}>
              {trend.value}
            </ThemedText>
          </View>
          {trend.label ? (
            <ThemedText type="footnote" themeColor="onHeroMuted" numberOfLines={1} style={styles.shrink}>
              {trend.label}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  /**
   * A calha vive AQUI e não no `panel`: a faixa do rodapé precisa encostar nas bordas, e com o
   * padding no card ela nasceria recuada — que era o `-mx-gutter-lg` do export sem o negativo.
   */
  inner: { padding: Space.gutter },
  specular: { position: 'absolute', top: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth },
  shrink: { flex: 1, minWidth: 0 },
  top: { marginBottom: Space.lg },
  body: { gap: Space.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  eye: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  secondaryRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  chart: { marginTop: Space.lg },
  actions: { marginTop: Space.lg },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.gutter,
    paddingVertical: Space.sm + 2,
  },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.half,
    borderRadius: Radius.pill,
  },
});
