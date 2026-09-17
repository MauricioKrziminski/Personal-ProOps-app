import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { QuickActions, type QuickAction } from '@/components/ui/quick-actions';
import { useConceal } from '@/components/ui/conceal';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface HeroPanelProps {
  /** Controle que ESCOPA o número — hoje, o seletor de mês do Financeiro. */
  top?: React.ReactNode;
  /** Badge ou pílula de status opcional na linha do rótulo. */
  badge?: React.ReactNode;
  /** Rótulo curto — **sempre antes do valor** (`HeroLabel`, §2 de design.md). */
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
   * É um dos dois padrões repetidos do export: superfície um degrau mais escura, para o número
   * grande não precisar carregar contexto — o valor responde "quanto", o rodapé responde
   * "comparado com o quê".
   *
   * ⚠️ **Havia um `trend` aqui, e ele COMIA este slot em silêncio.** A condição era
   * `{!trend && footer ? ... : null}`, o Financeiro passava os dois, e o rodapé "Sobrou na
   * conta" simplesmente nunca renderizou — ele existia no `describeCycle` e morria aqui.
   * `trend` desenhava uma pílula com um delta, que é uma linha de ESTADO: `secondary` já faz
   * isso, acima do gráfico, sem disputar a faixa. Ele saiu junto com seu único caller, em vez
   * de ganhar uma regra de precedência que ninguém lembraria na próxima tela.
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
 * O painel de destaque — o bloco do topo das raízes.
 *
 * ## Anatomia
 *
 * Um bloco chapado com calha de 20. Dentro, nesta ordem: rótulo pequeno + os botões de
 * "…" e de olho, o número em `heroMoney`, a linha de estado em mono colorido, o gráfico, os
 * atalhos, e a faixa de rodapé sangrada.
 *
 * ## O desenho (16/09/2026)
 *
 * Um bloco escuro de canto 24 — tinta no tema claro, um degrau acima do fundo no escuro —, como
 * o bloco do saldo dos vídeos de referência. Sem gradiente, brilho ou contorno; tudo o que mora
 * aqui dentro usa os tokens `onHero*`/`heroChip`.
 *
 * A regra "um destaque por tela" não mudou.
 */
export function HeroPanel({
  top,
  badge,
  label,
  value,
  secondary,
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
        { backgroundColor: theme.heroSurface },
      ]}>
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
            <ThemedText type="meta" themeColor="onHeroMuted" style={styles.shrinkLabel}>
              {label}
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

      {footer ? (
        <View style={[styles.footer, { backgroundColor: theme.heroFooter }]}>{footer}</View>
      ) : null}

    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /**
   * O bloco do Concreto: chapado, o NEGATIVO da página (tinta no claro, papel no escuro), sem
   * gradiente, sem brilho e sem contorno — o contraste com a página já é a borda.
   */
  panel: {
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  /**
   * A calha vive AQUI e não no `panel`: a faixa do rodapé precisa encostar nas bordas, e com o
   * padding no card ela nasceria recuada — que era o `-mx-gutter-lg` do export sem o negativo.
   */
  inner: { padding: Space.gutter },
  shrink: { flex: 1, minWidth: 0 },
  shrinkLabel: { flexShrink: 1 },
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
    borderCurve: 'continuous',
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
});
