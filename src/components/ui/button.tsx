import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { ThemedText } from '@/components/themed-text';
import { HitTarget, Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
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

const HEIGHT: Record<Size, number> = { sm: HitTarget, md: 48, lg: 54 };

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
  const labelColor = variant === 'primary' || variant === 'destructive' ? 'onTint' : 'text';

  return (
    <Animated.View style={[animated, block ? styles.block : styles.hug, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inert, busy: loading }}
        disabled={inert}
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
            backgroundColor: surface[variant],
            opacity: inert ? 0.5 : 1,
            paddingHorizontal: size === 'sm' ? Space.md : Space.xl,
          },
        ]}>
        {loading ? (
          <ActivityIndicator color={theme[labelColor]} />
        ) : (
          <View style={styles.content}>
            {icon ? <Icon name={icon} size="md" color={labelColor} /> : null}
            <ThemedText type="smallBold" themeColor={labelColor}>
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
