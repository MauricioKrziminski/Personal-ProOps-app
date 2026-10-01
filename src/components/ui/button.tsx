import { useLayoutEffect, useRef, useState } from 'react';
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
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { DotsLoader } from '@/components/motion/dots-loader';
import { useCortina } from '@/components/motion/session-curtain';
import { PressableScale } from '@/components/motion/pressable-scale';
import { usePresenca, usePresencaAtiva } from '@/components/motion/presenca';
import { useCoresSuaves, useOpacidadeSuave } from '@/components/motion/cores-suaves';
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
  /**
   * Só no `secondary`: rótulo em `danger`, para a ação destrutiva que mora no fim de um
   * formulário ("Apagar lançamento"). Ela precisa PARECER botão — como `ghost`, texto solto,
   * não parecia clicável —, e o vermelho cheio do `destructive` grita demais ali; a
   * confirmação continua no action sheet.
   */
  tone?: 'danger';
  style?: StyleProp<ViewStyle>;
}

/** Altura visual mínima. O alvo de toque do `sm` chega em 44 pelo `hitSlop`. */
const HEIGHT: Record<Size, number> = { sm: 36, md: 50, lg: 54 };
const SLOP: Record<Size, number> = { sm: (HitTarget - HEIGHT.sm) / 2, md: 0, lg: 0 };
/** Largura da cápsula de carregamento, em alturas. */
const CAPSULA = 1.9;

/**
 * Botão compartilhado do app. No iOS 26+ as variantes usam GlassView nativo;
 * nas demais plataformas conservam a superfície do tema.
 *
 * ## As variantes
 *
 * | variante | desenho |
 * |---|---|
 * | `primary` | tinta cheia (`tintFill`: preto no claro, branco no escuro), rótulo em `onTint` |
 * | `secondary` | cinza de elemento, rótulo em tinta — lê igual sobre o papel e sobre card branco |
 * | `ghost` | texto puro, SÓ como o par do primário (Cancelar/Salvar, "Reenviar código"). Sozinho ele não parece botão — use `secondary` |
 * | `destructive` | vermelho cheio |
 *
 * ## O carregamento
 *
 * Nas plataformas sem vidro, a pílula ENCOLHE até uma cápsula e dois pontos trocam de lugar; a caixa externa
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
  tone,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const cortina = useCortina();
  const caixa = useRef<View>(null);
  const reduzido = useReducedMotion();
  const ativo = usePresencaAtiva();
  // A própria cortina comunica a troca de sessão. O botão só mostra loader quando a ação
  // explicitamente pede isso; assim ele não faz um segundo movimento enquanto a onda cobre a tela.
  const loadingVisual = loading;
  const { presente: loaderPresente } = usePresenca(Boolean(loadingVisual));
  const inert = disabled || loading || !ativo;
  // O Text já aplica a escala nativa. A caixa cresce com sua medida, sem escalar a fonte de
  // novo nem limitar Dynamic Type; a altura medida serve só para desenhar a superfície.
  const [medida, setMedida] = useState({ width: 0, height: 0 });
  const altura = Math.max(HEIGHT[size], medida.height);
  // Muitas linhas podem deixar a caixa mais alta que larga. As tampas continuam dentro dela.
  const raio = Math.min(altura, medida.width || altura) / 2;
  const off = disabled && !loadingVisual;
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
      : tone === 'danger'
        ? 'danger'
        : 'text';
  // O material é decidido uma vez para todas as variantes. A cor comunica a ação; o
  // GlassView nativo fornece a superfície no iOS 26+.
  const vidro = supportsLiquidGlass();
  const cor = vidro ? 'transparent' : off ? theme.backgroundElement : fill[variant];
  const glassTint =
    variant === 'primary'
      ? theme.glassActionTint
      : variant === 'destructive'
        ? theme.glassDangerTint
        : variant === 'secondary'
          ? theme.glassElementTint
          : undefined;

  /** 0 = botão, 1 = cápsula carregando. */
  const morph = useSharedValue(loadingVisual ? 1 : 0);
  useLayoutEffect(() => {
    morph.set(withTiming(Number(Boolean(loadingVisual)), {
      duration: Motion.duration.morph, easing: Motion.easing.inOut, reduceMotion: ReduceMotion.System,
    }));
  }, [loadingVisual, morph]);
  const superficie = useCoresSuaves({ backgroundColor: cor });
  const desligado = useOpacidadeSuave(off ? 1 : 0);

  // A cápsula de carregamento é uma composição opaca. No iOS o vidro permanece estável
  // enquanto o conteúdo troca pelo indicador de progresso.
  const podeEncolher = !reduzido && !vidro && variant !== 'ghost';
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
    const meio = Math.max(1, w - 2 * raio);
    const r = recuo(morph.get());
    return { transform: [{ scaleX: Math.max(0, (meio - 2 * r) / meio) }] };
  });
  const conteudo = useAnimatedStyle(() => ({
    opacity: 1 - morph.get(),
    transform: [{ scale: interpolate(morph.get(), [0, 1], [1, 0.94]) }],
  }));
  const pontos = useAnimatedStyle(() => ({
    opacity: morph.get(),
    transform: [{ scale: interpolate(morph.get(), [0, 1], [0.6, 1]) }],
  }));

  const medir = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    largura.set(width);
    setMedida(anterior => anterior.width === width && anterior.height === height ? anterior : { width, height });
  };
  const tampa = { width: 2 * raio, height: altura, borderRadius: raio, backgroundColor: cor };

  return (
    <Animated.View ref={caixa} style={[block ? styles.block : styles.hug, style]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inert, busy: loadingVisual }}
        disabled={inert}
        hitSlop={SLOP[size]}
        haptic="light"
        scaleTo={0.97}
        onPress={() => {
          if (inert) return;
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
        style={[styles.pilula, { minHeight: HEIGHT[size], borderRadius: raio }]}>
        {vidro ? (
          <GlassBackdrop
            fallbackColor={fill[variant]}
            radius={raio}
            tintColor={glassTint}
            effectStyle={variant === 'ghost' ? 'clear' : 'regular'}
          />
        ) : null}
        {vidro ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill,
          { backgroundColor: theme.backgroundElement, borderRadius: raio }, desligado]} /> : null}
        {variant !== 'ghost' && !vidro ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={[styles.peca, { left: raio, right: raio, height: altura, backgroundColor: cor }, miolo, superficie]}
            />
            <Animated.View pointerEvents="none" style={[styles.peca, { left: 0 }, tampa, tampaEsquerda, superficie]} />
            <Animated.View pointerEvents="none" style={[styles.peca, { right: 0 }, tampa, tampaDireita, superficie]} />
          </>
        ) : null}

        <Animated.View
          style={[
            styles.conteudo,
            { minHeight: HEIGHT[size], paddingHorizontal: size === 'sm' ? Space.lg : Space.xl },
            conteudo,
          ]}>
          {/* Rótulo e ícone medem a largura natural imediatamente ao mudar: a pílula abraça
              o conteúdo novo sem ficar limitada pela largura de uma camada de crossfade. */}
          {/* No `sm` o ícone acompanha o rótulo: 20px ao lado de um texto de 12 pesa demais. */}
          {icon ? <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} color={labelColor} /> : null}
          <ThemedText
            type={size === 'sm' ? 'caption' : 'smallBold'}
            themeColor={labelColor}
            style={styles.semEncolher}>
            {label}
          </ThemedText>
        </Animated.View>

        {loaderPresente ? (
          <Animated.View pointerEvents="none" style={[styles.pontos, { height: altura }, pontos]}>
            <DotsLoader size={size === 'sm' ? 5 : 7} color={labelColor} />
          </Animated.View>
        ) : null}
      </PressableScale>
    </Animated.View>
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
    paddingVertical: Space.sm,
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
