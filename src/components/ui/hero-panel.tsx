import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

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
  /**
   * Conteúdo livre na MESMA faixa de rodapé do `trend` (a que sangra até as bordas, §1 de
   * design.md). Serve para o par de números que não cabe na pílula — "tenho hoje / a receber".
   * `trend` ganha quando os dois vêm: a faixa é uma só.
   */
  footer?: React.ReactNode;
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
  footer,
  chart,
  actions,
  concealable = false,
  onPress,
}: HeroPanelProps) {
  const theme = useTheme();
  const { concealed, toggle } = useConceal();
  // Press-in do card (§5): 0.97 em 120ms, o mesmo do `Shortcut`. Só existe quando há destino.
  const escala = useSharedValue(1);
  const aoTocar = useAnimatedStyle(() => ({ transform: [{ scale: escala.get() }] }));

  return (
    <Animated.View
      entering={FadeIn.duration(Motion.duration.slow)}
      style={[
        styles.panel,
        aoTocar,
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

        {/*
          O toque existia desde sempre e NINGUÉM sabia: este `Pressable` não tinha chevron, nem
          press-in, nem haptic, nem rótulo de acessibilidade — o dono do produto pediu "abrir
          alguma coisa com mais opções" numa função que já estava lá, invisível.

          O que ganhou: press-in de `scale 0.97` (§5 de design.md pede em card) e o chip "…" ao
          lado do olho. **Não é chevron**: chevron é promessa de tela nova, e `row.tsx:20-24` já
          registra essa regra — o glyph de menu do projeto é o "…" do `HeaderMenu`.

          Haptic NÃO entra aqui: `showItemActions` já chama `selectionAsync()`, e dois no mesmo
          frame quebra §6 ("um por ação do usuário").
        */}
        <Pressable
          accessibilityRole={onPress ? 'button' : undefined}
          accessibilityLabel={onPress ? `${label}, abre mais opções` : undefined}
          onPress={onPress}
          onPressIn={
            onPress
              ? () => escala.set(withTiming(Motion.pressScale, { duration: Motion.duration.fast }))
              : undefined
          }
          onPressOut={
            onPress ? () => escala.set(withTiming(1, { duration: Motion.duration.fast })) : undefined
          }
          style={styles.body}>
          <View style={styles.labelRow}>
            <ThemedText type="caption" themeColor="onHeroMuted" style={Type.meta}>
              {label.toUpperCase()}
            </ThemedText>
            {badge}
            {/*
              Os dois chips andam JUNTOS, num grupo só.
              
              A `labelRow` é `space-between`, e com três filhos soltos (rótulo, "…", olho) ela
              espalhava os TRÊS: o "…" caía no meio da linha, longe do olho e longe do rótulo,
              parecendo um botão perdido. Agrupados, o `space-between` volta a ter dois lados —
              rótulo de um, ações do outro.
            */}
            {onPress || concealable ? (
              <View style={styles.acoes}>
                {onPress ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Mais opções"
                    onPress={onPress}
                    hitSlop={Space.sm}
                    style={[styles.eye, { backgroundColor: theme.heroChip }]}>
                    <Icon name="ellipsis" size="sm" color="onHero" />
                  </Pressable>
                ) : null}
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

      {!trend && footer ? (
        <View style={[styles.footer, { backgroundColor: theme.heroFooter }]}>{footer}</View>
      ) : null}

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
            <ThemedText type="footnote" themeColor="onHeroMuted" style={styles.shrink}>
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
  /** O par de chips. `flexShrink: 0` pela mesma razão do `eye` logo abaixo. */
  acoes: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, flexShrink: 0 },
  /**
   * `flexShrink: 0`: o rótulo ao lado agora encolhe (ver `ThemedText`), mas sem isto o Yoga
   * distribuiria o aperto entre os dois e o chip do olho viraria uma elipse estreita — que é
   * exatamente o "cortando um pouco à direita do ícone" relatado num aparelho com fonte grande.
   */
  eye: {
    flexShrink: 0,
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  // `flex-start`: com fonte grande o texto de estado quebra em três linhas e o ícone, centrado,
  // flutuava no meio do bloco em vez de marcar a primeira linha.
  secondaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.xs },
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
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.half,
    borderRadius: Radius.pill,
  },
});
