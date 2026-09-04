import * as Haptics from 'expo-haptics';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { Mark } from '@/components/ui/mark';
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
  style?: StyleProp<ViewStyle>;
}

/**
 * Altura VISUAL. `sm` desceu de 44 para 36 (03/09/2026).
 *
 * 44 é o alvo mínimo de toque, não a altura mínima de um botão — e usar o alvo como altura
 * deixava "Paguei" com a mesma presença de um submit de formulário dentro de uma linha de lista.
 * O alvo continua em 44 pelo `hitSlop`, que é como o iOS resolve o mesmo problema em toda barra
 * de ferramentas. É o `h-10` do export, com o rótulo um degrau menor.
 */
const HEIGHT: Record<Size, number> = { sm: 36, md: 48, lg: 54 };
/** Quanto falta para o alvo chegar em 44 quando o botão é menor que isso. */
const SLOP: Record<Size, number> = { sm: (HitTarget - HEIGHT.sm) / 2, md: 0, lg: 0 };

/**
 * O único botão do app.
 *
 * Substitui ~20 `Pressable` estilizados à mão e, com eles, os 18 `color: '#fff'` hardcoded que
 * existiam só para escrever rótulo em cima do `tint`.
 *
 * Press-in em 120 ms com `scale 0.97` (regra de movimento). Linha de lista NÃO usa este
 * componente — lá o feedback é highlight de fundo, não escala.
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
  const scale = useSharedValue(1);
  const inert = disabled || loading;

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const surface: Record<Variant, string> = {
    primary: theme.tint,
    secondary: theme.backgroundElement,
    ghost: 'transparent',
    destructive: theme.danger,
  };

  // Desabilitado NÃO é "o mesmo botão mais claro": azul a 50% continua lendo como ação
  // disponível. Perde a cor e o peso — em carregamento, ao contrário, a ação segue sendo
  // aquela, então o accent fica.
  const off = disabled && !loading;
  // `ghost` levava o accent, porque sem superfície e sem cor ele não parecia ação. Com o `tint`
  // monocromático isso deixou de funcionar: accent = cor do texto, então o ghost voltaria a ler
  // como rótulo — e pior, calado.
  //
  // A correção não é dar cor de volta, é olhar o PAR: ghost é sempre "Cancelar"/"Fechar" ao
  // lado de um primário, e o primário virou uma pílula preta sólida. Texto puro contra pílula
  // preenchida é exatamente como o iOS desenha esse par. O contraste entre os dois é a
  // affordance; pintar os dois seria duas ações disputando.
  const labelColor: ThemeColor = off
    ? 'textSecondary'
    : variant === 'primary' || variant === 'destructive'
      ? 'onTint'
      : 'text';

  return (
    <Animated.View style={[animated, block ? styles.block : styles.hug, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inert, busy: loading }}
        disabled={inert}
        hitSlop={SLOP[size]}
        onPressIn={() => {
          scale.set(withTiming(Motion.pressScale, { duration: Motion.duration.fast }));
        }}
        onPressOut={() => {
          scale.set(withTiming(1, { duration: Motion.duration.fast }));
        }}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        style={[
          styles.base,
          {
            height: HEIGHT[size],
            backgroundColor: off ? theme.backgroundElement : surface[variant],
            opacity: loading ? 0.7 : 1,
            paddingHorizontal: size === 'sm' ? Space.md + 2 : Space.xl,
            // Secundário ganha borda porque o primário deixou de ser colorido: com o `tint`
            // monocromático a distância entre primário e secundário aumentou, e a de secundário
            // para DESABILITADO encolheu (os dois eram `backgroundElement` liso). A borda é o
            // que separa "posso tocar" de "não posso" — desabilitado continua sem ela.
            borderWidth: variant === 'secondary' && !off ? StyleSheet.hairlineWidth : 0,
            borderColor: theme.separator,
          },
        ]}>
        {loading && Platform.OS === 'web' ? (
          // O CanvasKit do Skia não é inicializado pelo bundle web atual. O fallback mantém o
          // estado de carregamento funcional sem alterar a marca usada nos apps nativos.
          <ActivityIndicator size="small" color={theme[labelColor]} />
        ) : loading ? (
          // A espiral da marca no lugar do `ActivityIndicator`. Não é enfeite: com marca
          // monocromática, a personalidade vem de **repetir a forma** em papéis utilitários —
          // é o que torna a Vercel reconhecível pelo ▲ no prompt e no loading. Um spinner do
          // sistema é de todo mundo; este é deste app.
          <Mark size={20} color={labelColor} spinning />
        ) : (
          <View style={[styles.content, size === 'sm' && styles.contentSm]}>
            {/* No `sm` o ícone acompanha o rótulo: 20px ao lado de um texto de 13 pesa demais. */}
            {icon ? <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} color={labelColor} /> : null}
            <ThemedText
              type={size === 'sm' ? 'caption' : 'smallBold'}
              themeColor={labelColor}
              numberOfLines={1}>
              {label}
            </ThemedText>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  contentSm: { gap: Space.xs },
  // O wrapper precisa do MESMO raio do miolo: `boxShadow` passado por `style` (o FAB do
  // Financeiro faz isso) desenhava um retângulo claro atrás da pílula — o "fundo branco".
  block: {
    alignSelf: 'stretch',
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
  /** Sem `block`, o botão abraça o rótulo — senão o pai com `alignItems: stretch` o estica. */
  hug: {
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
});
