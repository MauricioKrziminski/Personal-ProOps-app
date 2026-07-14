import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { StyleSheet, useColorScheme, View, type StyleProp, type ViewStyle } from 'react-native';

import { Spacing } from '@/constants/theme';

interface GlassCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 'regular' segue o Liquid Glass padrão; 'clear' é mais translúcido (iOS 26+). */
  variant?: 'regular' | 'clear';
}

/**
 * Superfície em liquid glass — diretriz de design do ProOps.
 * iOS 26+: GlassView nativo (Liquid Glass real).
 * iOS antigo/Android: BlurView como fallback visualmente próximo.
 */
export function GlassCard({ children, style, variant = 'regular' }: GlassCardProps) {
  const scheme = useColorScheme();

  if (isLiquidGlassAvailable()) {
    return (
      <GlassView glassEffectStyle={variant} style={[styles.card, style]}>
        {children}
      </GlassView>
    );
  }

  return (
    <View style={[styles.card, styles.fallbackClip, style]}>
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
    borderRadius: Spacing.four,
    padding: Spacing.three,
  },
  fallbackClip: {
    overflow: 'hidden',
  },
});
