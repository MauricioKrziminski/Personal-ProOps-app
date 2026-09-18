import { useEffect, useRef } from 'react';
import {
  Dimensions,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { DotsLoader } from '@/components/motion/dots-loader';
import { useCortina } from '@/components/motion/session-curtain';
import { PressableScale } from '@/components/motion/pressable-scale';
import { GlassBackdrop, supportsLiquidGlass } from '@/components/ui/glass-backdrop';
import { Icon } from '@/components/ui/icon';
import { ThemedText } from '@/components/themed-text';
import { HitTarget, Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { ThemeColor } from '@/constants/theme';
import type { SymbolViewProps } from 'expo-symbols';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  icon?: SymbolViewProps['name'];
  loading?: boolean;
  disabled?: boolean;
  /** Ocupa a largura disponível — submit de formulário. */
  block?: boolean;
  /**
   * O botão que ENTRA na conta: no toque ele registra o próprio centro na cortina, e a cobertura
   * da troca de sessão nasce dele (o círculo de tinta dos vídeos de referência).
   */
  origemDaCortina?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Altura visual. O alvo de toque do `sm` chega em 44 pelo `hitSlop`. */
const HEIGHT: Record<Size, number> = { sm: 36, md: 50, lg: 54 };
const SLOP: Record<Size, number> = { sm: (HitTarget - HEIGHT.sm) / 2, md: 0, lg: 0 };
/** Largura da cápsula de carregamento, em alturas. */
const CAPSULA = 1.9;

/**
 * O único botão do app — uma pílula chapada, como nos vídeos de referência.
 *
 * ## As variantes
 *
 * | variante | desenho |
 * |---|---|
 * | `primary` | tinta cheia (`tintFill`: preto no claro, branco no escuro), rótulo em `onTint` |
 * | `secondary` | cinza de elemento, rótulo em tinta — lê igual sobre o papel e sobre card branco |
 * | `ghost` | texto puro, o par do primário (Cancelar/Salvar) |
 * | `destructive` | vermelho cheio |
 *
 * ## O carregamento
 *
 * A pílula ENCOLHE até uma cápsula e dois pontos trocam de lugar dentro dela; a caixa externa
 * mantém a largura, então o formulário não pula. Encolher uma pílula com `scaleX` achataria as
 * pontas, então a pílula é feita de três peças da mesma cor: duas tampas circulares que deslizam
 * para o centro e um miolo reto que encolhe. Tudo em `transform`, nenhum `width` animado.
 *
 * Com Reduce Motion não há encolhimento: o rótulo só dá lugar aos pontos parados.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  block = false,
  origemDaCortina = false,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const cortina = useCortina();
  const caixa = useRef<View>(null);
  const reduzido = useReducedMotion();
  const inert = disabled || loading;
  const altura = HEIGHT[size];
  const off = disabled && !loading;
  /**
   * A largura medida num valor COMPARTILHADO: lida da captura do worklet, ela ficaria presa no 0
   * do primeiro render e a cápsula não encolheria.
   */
  const largura = useSharedValue(0);

  const fill: Record<Variant, string> = {
    primary: theme.tintFill,
    secondary: theme.backgroundElement,
    ghost: 'transparent',
    destructive: theme.danger,
  };
  const labelColor: ThemeColor = off
    ? 'textSecondary'
    : variant === 'primary' || variant === 'destructive'
      ? 'onTint'
      : 'text';
  const vidro = supportsLiquidGlass() && variant === 'secondary' && !loading && !disabled;
  const cor = vidro ? 'transparent' : off ? theme.backgroundElement : fill[variant];

  /** 0 = botão, 1 = cápsula carregando. */
  const morph = useSharedValue(loading ? 1 : 0);
  useEffect(() => {
    morph.set(
      loading
        ? withSpring(1, Motion.spring.encaixe)
        : withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.out })
    );
  }, [loading, morph]);

  const podeEncolher = !reduzido && variant !== 'ghost';
  /** Quanto cada tampa anda para dentro quando a pílula vira cápsula. */
  const recuo = (m: number) => {
    'worklet';
    const w = largura.get();
    const alvo = altura * CAPSULA;
    return podeEncolher && w > alvo ? interpolate(m, [0, 1], [0, (w - alvo) / 2]) : 0;
  };

  const tampaEsquerda = useAnimatedStyle(() => ({
    transform: [{ translateX: recuo(morph.get()) }],
  }));
  const tampaDireita = useAnimatedStyle(() => ({
    transform: [{ translateX: -recuo(morph.get()) }],
  }));
  const miolo = useAnimatedStyle(() => {
    const w = largura.get();
    const meio = Math.max(1, w - altura);
    const r = recuo(morph.get());
    return { transform: [{ scaleX: Math.max(0, (meio - 2 * r) / meio) }] };
  });
  const conteudo = useAnimatedStyle(() => ({
    opacity: interpolate(morph.get(), [0, 0.35], [1, 0], 'clamp'),
    transform: [{ scale: interpolate(morph.get(), [0, 1], [1, 0.94]) }],
  }));
  const pontos = useAnimatedStyle(() => ({
    opacity: interpolate(morph.get(), [0.45, 1], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(morph.get(), [0, 1], [0.6, 1]) }],
  }));

  const medir = (e: LayoutChangeEvent) => largura.set(e.nativeEvent.layout.width);
  const tampa = { width: altura, height: altura, borderRadius: altura / 2, backgroundColor: cor };

  return (
    <View ref={caixa} style={[block ? styles.block : styles.hug, style]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inert, busy: loading }}
        disabled={inert}
        hitSlop={SLOP[size]}
        haptic="light"
        scaleTo={0.97}
        onPress={() => {
          if (origemDaCortina) {
            caixa.current?.measureInWindow((x, y, w, h) => {
              const tela = Dimensions.get('window');
              if (tela.width > 0 && tela.height > 0) {
                cortina.lembrarOrigem({ x: (x + w / 2) / tela.width, y: (y + h / 2) / tela.height });
              }
            });
          }
          onPress();
        }}
        onLayout={medir}
        style={[styles.pilula, { height: altura, borderRadius: altura / 2 }]}>
        {vidro ? <GlassBackdrop fallbackColor={theme.backgroundElement} radius={altura / 2} /> : null}
        {variant !== 'ghost' ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={[styles.peca, { left: altura / 2, right: altura / 2, height: altura, backgroundColor: cor }, miolo]}
            />
            <Animated.View pointerEvents="none" style={[styles.peca, { left: 0 }, tampa, tampaEsquerda]} />
            <Animated.View pointerEvents="none" style={[styles.peca, { right: 0 }, tampa, tampaDireita]} />
          </>
        ) : null}

        <Animated.View
          style={[
            styles.conteudo,
            { height: altura, paddingHorizontal: size === 'sm' ? Space.lg : Space.xl },
            conteudo,
          ]}>
          {/* No `sm` o ícone acompanha o rótulo: 20px ao lado de um texto de 12 pesa demais. */}
          {icon ? <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} color={labelColor} /> : null}
          <ThemedText
            type={size === 'sm' ? 'caption' : 'smallBold'}
            themeColor={labelColor}
            style={styles.semEncolher}>
            {label}
          </ThemedText>
        </Animated.View>

        {loading ? (
          <Animated.View pointerEvents="none" style={[styles.pontos, { height: altura }, pontos]}>
            <DotsLoader size={size === 'sm' ? 5 : 7} color={labelColor} />
          </Animated.View>
        ) : null}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  pilula: { justifyContent: 'center' },
  peca: { position: 'absolute', top: 0 },
  conteudo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
  },
  /**
   * O rótulo do botão não encolhe: ele é o identificador da ação (design.md §7), e o botão
   * abraça o texto.
   */
  semEncolher: { flexShrink: 0 },
  pontos: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `borderRadius` pílula no wrapper: `boxShadow` passado por `style` (o FAB do Financeiro faz
  // isso) desenha com o mesmo canto do botão.
  block: { alignSelf: 'stretch', borderRadius: Radius.pill, borderCurve: 'continuous' },
  /** Sem `block`, o botão abraça o rótulo — senão o pai com `alignItems: stretch` o estica. */
  hug: { alignSelf: 'flex-start', borderRadius: Radius.pill, borderCurve: 'continuous' },
});
