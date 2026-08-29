import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Mark } from '@/components/ui/mark';
import { QuickActions, type QuickAction } from '@/components/ui/quick-actions';
import { useConceal } from '@/components/ui/conceal';
import { Motion, Radius, Space, Type } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface HeroPanelProps {
  /** Rótulo curto, caixa alta — **sempre antes do valor**. */
  label: string;
  /** O número. Normalmente um `<Money variant="heroMoney" concealable />`. */
  value: React.ReactNode;
  /** Uma linha de contexto: "entrou X · saiu Y". */
  secondary?: string;
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
  label,
  value,
  secondary,
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
        { backgroundColor: theme.heroSurface },
      ]}>
      {/* A espiral da marca, recortada na borda. Marca monocromática ganha presença repetindo a
          FORMA em papéis utilitários — é o que faz a tela ser reconhecível sem logotipo. */}
      <View style={styles.watermark} pointerEvents="none">
        <Mark size={200} color="onHero" watermark />
      </View>

      <Pressable
        accessibilityRole={onPress ? 'button' : undefined}
        onPress={onPress}
        style={styles.body}>
        <ThemedText type="caption" themeColor="onHeroMuted" style={Type.meta}>
          {label.toUpperCase()}
        </ThemedText>

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
  panel: {
    paddingHorizontal: Space.lg,
    /**
     * `Space.lg` no topo, e **não** `insets.top`.
     *
     * O painel mora dentro do scroll, ABAIXO do header nativo — que já resolveu a safe area.
     * Somar o inset de novo abria ~48 px de nada entre o header e o rótulo, e o painel ficava
     * com um vazio no topo que lia como erro de layout.
     */
    paddingTop: Space.lg,
    paddingBottom: Space.lg,
    borderBottomLeftRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  body: {
    gap: Space.xs,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  chart: {
    marginTop: Space.md,
  },
  actions: {
    marginTop: Space.lg,
  },
  watermark: {
    position: 'absolute',
    right: -56,
    top: -24,
  },
});
