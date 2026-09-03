import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Mark } from '@/components/ui/mark';
import { QuickActions, type QuickAction } from '@/components/ui/quick-actions';
import { useConceal } from '@/components/ui/conceal';
import { Motion, Radius, Space, Type } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * As opções de header das telas que têm painel — **o cabeçalho veste a mesma cor**.
 *
 * Com cabeçalho branco em cima do painel de tinta, a faixa preta lia como um bloco colado no
 * meio da tela em vez do topo dela: apareciam duas superfícies disputando o alto, e a costura
 * entre as duas era a primeira coisa que o olho achava. Bancos que usam esse padrão pintam o
 * cabeçalho junto — é o que dá o "topo é uma coisa só".
 *
 * O large title, os ícones de ação e o botão de voltar vão para `onHero`. Vale só nas telas com
 * painel; o resto do app segue com o cabeçalho padrão do sistema.
 *
 * ⚠️ Não é `headerTransparent`. Transparente faria o conteúdo rolar por baixo do título, e o
 * projeto já pagou esse preço uma vez na Notas — a área do large title precisa ser opaca, senão
 * a lista desenha por cima dela.
 */
export function heroHeaderOptions(theme: ReturnType<typeof useTheme>) {
  return {
    headerStyle: { backgroundColor: theme.heroSurface },
    headerLargeStyle: { backgroundColor: theme.heroSurface },
    headerTintColor: theme.onHero,
    headerTitleStyle: { color: theme.onHero },
    headerLargeTitleStyle: { color: theme.onHero },
    headerShadowVisible: false,
  } as const;
}

interface HeroPanelProps {
  /**
   * Controle que ESCOPA o número — hoje, o seletor de mês do Financeiro.
   *
   * Fica dentro do painel de propósito: quem muda o mês muda o valor grande, e fora dali o
   * controle flutuava entre o header e a faixa de tinta sem dizer sobre o que ele manda.
   */
  top?: React.ReactNode;
  /** Badge ou pílula de status opcional no topo do painel. */
  badge?: React.ReactNode;
  /** Rótulo curto, caixa alta — **sempre antes do valor**. */
  label: string;
  /** O número. Normalmente um `<Money variant="heroMoney" concealable />`. */
  value: React.ReactNode;
  /** Uma linha de contexto: "entrou X · saiu Y". */
  secondary?: string;
  /** Indicador de variação ou tendência (ex: +14.2% vs mês anterior). */
  trend?: {
    value: string;
    positive?: boolean;
    label?: string;
  };
  /** Sparkline ou barra. Opcional. */
  chart?: React.ReactNode;
  /** Atalhos de decisão. Somem sozinhos quando não há nada pendente. */
  actions?: QuickAction[];
  /** Liga o toque-para-esconder no valor. */
  concealable?: boolean;
  onPress?: () => void;
}

/**
 * O painel de destaque do topo — **cor chapada, não vidro**.
 *
 * ## Por que ele existe
 *
 * O destaque das telas principais era um `GlassCard`. Vidro precisa de algo atrás para refratar;
 * sobre o fundo chapado do app ele virava um retângulo cinza com um número dentro, e foi essa a
 * origem concreta do diagnóstico "as telas saíram corretas e sem graça". Um painel de tinta
 * sólida sangrando até as bordas resolve pelo caminho oposto: em vez de tentar somar textura,
 * ele soma **contraste** — a área mais escura da tela é a que carrega a resposta.
 *
 * ## Por que preto, e não uma cor
 *
 * Porque a marca do ProOps é preto e branco. Sem cor própria, a identidade tem que vir de
 * superfície, tipografia e densidade — e é aqui que os três se encontram.
 *
 * ## O que isto muda numa regra escrita
 *
 * `design.md` §1 dizia que o destaque de cada tela é um `GlassCard`. Passa a ser: telas com
 * painel usam `HeroPanel`; `GlassCard` fica na chrome e nas telas secundárias. A regra "um
 * destaque por tela" continua valendo — o que mudou foi o material, não a contagem.
 *
 * ## O toque no número
 *
 * Quem esconde o valor é **o próprio número**, não um ícone de olho ao lado. O ícone separado é
 * redundante quando o número já é o alvo, e é a fonte clássica de inversão de significado (o
 * olho deve mostrar a *ação*, não o estado). O olho aqui é só um indicador discreto do estado
 * atual, e fica dentro da mesma área de toque.
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
        { borderColor: theme.cardBorder },
        { backgroundColor: theme.heroSurface },
      ]}>
      {/* A espiral da marca, recortada na borda. Marca monocromática ganha presença repetindo a
          FORMA em papéis utilitários — é o que faz a tela ser reconhecível sem logotipo. */}
      <View style={styles.watermark} pointerEvents="none">
        <Mark size={200} color="onHero" watermark />
      </View>

      {top ? <View style={styles.top}>{top}</View> : null}

      <Pressable
        accessibilityRole={onPress ? 'button' : undefined}
        onPress={onPress}
        style={styles.body}>
        <View style={styles.labelRow}>
          <ThemedText type="caption" themeColor="onHeroMuted" style={Type.meta}>
            {label.toUpperCase()}
          </ThemedText>
          {badge ? <View style={styles.badgeWrap}>{badge}</View> : null}
        </View>

        <Pressable
          accessibilityRole={concealable ? 'button' : undefined}
          accessibilityLabel={concealable ? (concealed ? 'Mostrar valor' : 'Ocultar valor') : undefined}
          onPress={concealable ? toggle : undefined}
          style={styles.valueRow}
          hitSlop={Space.md}>
          {value}
          {concealable ? (
            <Icon name={concealed ? 'eye.slash' : 'eye'} size="md" color="onHeroMuted" />
          ) : null}
        </Pressable>

        {trend ? (
          <View style={styles.trendRow}>
            <View style={[styles.trendPill, { backgroundColor: theme.heroSeparator }]}>
              <Icon
                name={trend.positive ? 'arrow.up.right' : 'arrow.down.right'}
                size="sm"
                color={trend.positive ? 'success' : 'danger'}
              />
              <ThemedText
                type="caption"
                themeColor={trend.positive ? 'success' : 'danger'}
                style={styles.trendValue}>
                {trend.value}
              </ThemedText>
            </View>
            {trend.label ? (
              <ThemedText type="caption" themeColor="onHeroMuted">
                {trend.label}
              </ThemedText>
            ) : null}
          </View>
        ) : null}

        {secondary ? (
          <ThemedText type="footnote" themeColor="onHeroMuted">
            {secondary}
          </ThemedText>
        ) : null}

        {chart ? <View style={styles.chart}>{chart}</View> : null}
      </Pressable>

      {actions ? (
        <View style={styles.actions}>
          <QuickActions actions={actions} />
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /**
   * **Card flutuante, não faixa sangrada** (design Stitch, 03/09/2026).
   *
   * Ele nascia colado no header nativo, com raio só embaixo e uma peça de costura (`joint`) no
   * `Screen` para o conteúdo não ser cortado por uma reta ao rolar. Com o `AppHeader` no topo
   * isso virava duas superfícies escuras empilhadas sem separação nenhuma — o desenho resolve
   * com um card de raio inteiro, contorno de 1px e ar em volta, e a costura deixa de ser
   * necessária porque não há mais o que costurar.
   */
  panel: {
    padding: Space.gutter,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  top: {
    marginBottom: Space.lg,
  },
  body: {
    gap: Space.xs,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badgeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginTop: Space.xs,
    marginBottom: Space.xs,
  },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.half,
    borderRadius: Radius.pill,
  },
  trendValue: {
    fontWeight: '600',
  },
  chart: {
    marginTop: Space.md,
  },
  actions: {
    marginTop: Space.lg,
  },
  /**
   * Ancorada embaixo à direita e quase toda fora do quadro.
   *
   * Estava no topo à direita e funcionava na Hoje — mas no Financeiro, onde o painel ganhou o
   * seletor de mês, a seta do "próximo mês" caía **em cima** da espiral e as duas viravam uma
   * mancha só. O canto inferior direito é o único que nenhum dos dois painéis usa: em cima moram
   * rótulo e controle, à esquerda o valor, e a faixa de atalhos não chega na borda.
   */
  watermark: {
    position: 'absolute',
    right: -64,
    bottom: -56,
  },
});
