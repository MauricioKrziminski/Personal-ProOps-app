import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { StyleSheet, useColorScheme, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface GlassCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 'regular' segue o Liquid Glass padrão; 'clear' é mais translúcido (iOS 26+). */
  variant?: 'regular' | 'clear';
}

/**
 * Superfície em liquid glass — diretriz de design do Personal ProOps app.
 * iOS 26+: GlassView nativo (Liquid Glass real).
 * iOS antigo/Android: BlurView como fallback visualmente próximo.
 *
 * **Piso de legibilidade (hairline).** Vidro mostra o que está ATRÁS dele; sobre o
 * `groupedBackground` — que é uma cor chapada — não há nada para refratar e o card sumia por
 * completo no tema claro (o número de destaque ficava boiando no fundo da tela). A hairline dá a
 * borda que define a superfície sem inventar cor: é o mínimo para o card existir nos dois temas.
 */
export function GlassCard({ children, style, variant = 'regular' }: GlassCardProps) {
  const scheme = useColorScheme();
  const theme = useTheme();

  const edge = { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.separator };

  if (isLiquidGlassAvailable()) {
    return (
      <GlassView glassEffectStyle={variant} style={[styles.card, edge, style]}>
        {children}
      </GlassView>
    );
  }

  return (
    <View style={[styles.card, styles.fallbackClip, edge, style]}>
      <BlurView
        intensity={50}
        tint={scheme === 'dark' ? 'systemThickMaterialDark' : 'systemThickMaterialLight'}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    // Escala `Radius`/`Space`, não a `Spacing` ordinal antiga: `lg` é o raio de card de destaque.
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    padding: Space.lg,
  },
  fallbackClip: {
    overflow: 'hidden',
  },
});
