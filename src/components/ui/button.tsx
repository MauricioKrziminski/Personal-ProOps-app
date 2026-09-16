import { useEffect } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/motion/pressable-scale';
import { TileSpinner } from '@/components/motion/tile-spinner';
import { Icon } from '@/components/ui/icon';
import { ThemedText } from '@/components/themed-text';
import { HitTarget, Motion, Radius, Space, Type } from '@/design/tokens';
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
  style?: StyleProp<ViewStyle>;
}

/** Altura VISUAL total (face + base). O alvo de toque chega em 44 pelo `hitSlop`. */
const HEIGHT: Record<Size, number> = { sm: 36, md: 48, lg: 54 };
/** Profundidade da tecla: quanto da base aparece embaixo da face. */
const DEPTH: Record<Size, number> = { sm: 2, md: 3, lg: 4 };
const SLOP: Record<Size, number> = { sm: (HitTarget - HEIGHT.sm) / 2, md: 0, lg: 0 };
/** O rótulo rola uma linha inteira a cada toque. */
const ROLL_MS = 340;

/**
 * O único botão do app — no mundo Concreto, uma TECLA de canto aparado.
 *
 * ## A anatomia
 *
 * Três camadas irmãs, e a separação é o que deixa cada animação barata e sem distorção:
 *
 * 1. **Base** — um tom abaixo da face (`tintDeep`, `dangerDeep`, `keyBase`), aparecendo só na
 *    borda de baixo. É a profundidade de um azulejo assentado.
 * 2. **Face** — a cor do botão. No toque ela AFUNDA até a base (`translateY`), que é o feedback
 *    principal; a escala do `PressableScale` fica mínima, só para o dedo sentir o bloco inteiro.
 * 3. **Conteúdo** — rótulo e ícone, que afundam junto com a face e ROLAM uma linha: o texto sobe
 *    e uma cópia idêntica entra por baixo. A cópia é a mesma frase, então o reinício no fim da
 *    rolagem é invisível.
 *
 * ## O morph de carregamento
 *
 * Carregando, face e base encolhem até um quadrado (`scaleX`, nunca `width`) e um azulejo gira
 * dentro dele em quartos de volta. A caixa externa mantém a largura: o formulário não pula. Com
 * Reduce Motion não há encolhimento nem rolagem — o rótulo só dá lugar ao azulejo parado.
 *
 * Desabilitado NÃO é "o mesmo botão mais claro": perde a cor, o peso e a profundidade.
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
  style,
}: ButtonProps) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const inert = disabled || loading;
  const altura = HEIGHT[size];
  const fundo = variant === 'ghost' ? 0 : DEPTH[size];
  const alturaFace = altura - fundo;
  const tipo = size === 'sm' ? 'caption' : 'smallBold';
  const linha = size === 'sm' ? Type.caption.lineHeight : Type.subhead.lineHeight;
  /**
   * A largura medida, num valor COMPARTILHADO: lida da captura do worklet, ela pode ficar presa no
   * 0 do primeiro render, e o morph deixaria de encolher.
   */
  const largura = useSharedValue(0);

  const off = disabled && !loading;
  const face: Record<Variant, string> = {
    primary: theme.tintFill,
    secondary: theme.keyFace,
    ghost: 'transparent',
    destructive: theme.danger,
  };
  const base: Record<Variant, string> = {
    primary: theme.tintDeep,
    secondary: theme.keyBase,
    ghost: 'transparent',
    destructive: theme.dangerDeep,
  };
  // Ghost é texto puro ao lado do primário preenchido — o par Cancelar/Salvar.
  const labelColor: ThemeColor = off
    ? 'textSecondary'
    : variant === 'primary' || variant === 'destructive'
      ? 'onTint'
      : 'text';

  /** 0 = botão, 1 = quadrado carregando. */
  const morph = useSharedValue(loading ? 1 : 0);
  /** 0 = em repouso, 1 = afundado. */
  const afundado = useSharedValue(0);
  /** 0 → 1 rola o rótulo uma linha. */
  const rolagem = useSharedValue(0);

  useEffect(() => {
    morph.set(
      loading
        ? withSpring(1, Motion.spring.encaixe)
        : withTiming(0, { duration: Motion.duration.base, easing: Motion.easing.out })
    );
  }, [loading, morph]);

  const podeEncolher = !reduzido && variant !== 'ghost';
  const escalaMorph = (m: number) => {
    'worklet';
    const w = largura.get();
    const alvo = podeEncolher && w > alturaFace ? alturaFace / w : 1;
    return interpolate(m, [0, 1], [1, alvo]);
  };

  const estiloBase = useAnimatedStyle(() => ({
    transform: [{ scaleX: escalaMorph(morph.get()) }],
  }));
  const estiloFace = useAnimatedStyle(() => ({
    transform: [
      { translateY: afundado.get() * fundo },
      { scaleX: escalaMorph(morph.get()) },
    ],
  }));
  const estiloConteudo = useAnimatedStyle(() => ({
    opacity: interpolate(morph.get(), [0, 0.35], [1, 0], 'clamp'),
    transform: [
      { translateY: afundado.get() * fundo },
      { scale: interpolate(morph.get(), [0, 1], [1, 0.92]) },
    ],
  }));
  const estiloRolo = useAnimatedStyle(() => ({
    transform: [{ translateY: -rolagem.get() * linha }],
  }));
  const estiloGiro = useAnimatedStyle(() => ({
    opacity: interpolate(morph.get(), [0.4, 1], [0, 1], 'clamp'),
    transform: [
      { translateY: afundado.get() * fundo },
      { scale: interpolate(morph.get(), [0, 1], [0.5, 1]) },
    ],
  }));

  const medir = (e: LayoutChangeEvent) => largura.set(e.nativeEvent.layout.width);

  const rotulo = (copia: boolean) => (
    <View
      style={[styles.rotulo, size === 'sm' && styles.rotuloSm, { height: linha }]}
      importantForAccessibility={copia ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={copia}>
      {/* No `sm` o ícone acompanha o rótulo: 20px ao lado de um texto de 13 pesa demais. */}
      {icon ? <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} color={labelColor} /> : null}
      <ThemedText type={tipo} themeColor={labelColor} style={styles.semEncolher}>
        {label}
      </ThemedText>
    </View>
  );

  return (
    <View style={[block ? styles.block : styles.hug, style]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inert, busy: loading }}
        disabled={inert}
        hitSlop={SLOP[size]}
        haptic="light"
        scaleTo={0.985}
        onPress={onPress}
        onPressIn={() => {
          afundado.set(withTiming(1, { duration: 70, easing: Easing.out(Easing.quad) }));
          if (reduzido) return;
          rolagem.set(0);
          rolagem.set(
            withTiming(1, { duration: ROLL_MS, easing: Motion.easing.out }, (fim) => {
              // A cópia é idêntica: voltar a 0 no fim não se vê.
              if (fim) rolagem.set(0);
            })
          );
        }}
        onPressOut={() => {
          afundado.set(withSpring(0, Motion.spring.snap));
        }}
        onLayout={medir}
        style={{ height: altura }}>
        {fundo > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.camada,
              { top: fundo, height: alturaFace, backgroundColor: off ? theme.backgroundSelected : base[variant] },
              estiloBase,
            ]}
          />
        ) : null}
        {variant !== 'ghost' ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.camada,
              {
                top: 0,
                height: alturaFace,
                backgroundColor: off ? theme.backgroundElement : face[variant],
                // O secundário claro é branco sobre papel: o fio é o que desenha a borda da tecla.
                borderWidth: variant === 'secondary' && !off ? 1 : 0,
                borderColor: theme.cardBorder,
              },
              estiloFace,
            ]}
          />
        ) : null}

        <Animated.View
          style={[
            styles.conteudo,
            { height: alturaFace, paddingHorizontal: size === 'sm' ? Space.md + 2 : Space.xl },
            estiloConteudo,
          ]}>
          <View style={[styles.janela, { height: linha }]}>
            <Animated.View style={estiloRolo}>
              {rotulo(false)}
              {rotulo(true)}
            </Animated.View>
          </View>
        </Animated.View>

        {loading ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.giro, { height: alturaFace }, estiloGiro]}>
            {Platform.OS === 'web' ? (
              // O CanvasKit não é inicializado no bundle web; o spinner do sistema mantém o estado.
              <ActivityIndicator size="small" color={theme[labelColor]} />
            ) : (
              <TileSpinner size={size === 'sm' ? 12 : 16} color={labelColor} />
            )}
          </Animated.View>
        ) : null}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  camada: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  conteudo: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** A janela da rolagem: mostra UMA linha e corta a outra. */
  janela: { overflow: 'hidden' },
  rotulo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
  },
  rotuloSm: { gap: Space.xs },
  /** O rótulo do botão não encolhe: dentro da janela, encolher cortaria a palavra. */
  semEncolher: { flexShrink: 0 },
  giro: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // O wrapper leva o MESMO raio da face: `boxShadow` passado por `style` (o FAB do Financeiro faz
  // isso) desenharia um retângulo com outro canto atrás do botão.
  block: {
    alignSelf: 'stretch',
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  /** Sem `block`, o botão abraça o rótulo — senão o pai com `alignItems: stretch` o estica. */
  hug: {
    alignSelf: 'flex-start',
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
});
