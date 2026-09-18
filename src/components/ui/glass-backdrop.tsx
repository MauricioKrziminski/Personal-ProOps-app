import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useScheme } from '@/hooks/use-theme';

/** O vidro nativo só entra quando o binário e o iOS oferecem a API completa. */
export function supportsLiquidGlass(): boolean {
  return Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
}

/** Superfície atrás de um controle; o próprio controle conserva toque, foco e acessibilidade. */
export function GlassBackdrop({
  fallbackColor,
  radius,
  style,
  tintColor,
}: {
  fallbackColor: string;
  radius: number;
  style?: StyleProp<ViewStyle>;
  tintColor?: string;
}) {
  const scheme = useScheme();
  const surfaceStyle = [StyleSheet.absoluteFill, { borderRadius: radius }, style];

  return supportsLiquidGlass() ? (
    <GlassView
      pointerEvents="none"
      glassEffectStyle="regular"
      colorScheme={scheme}
      tintColor={tintColor}
      style={surfaceStyle}
    />
  ) : (
    <View pointerEvents="none" style={[surfaceStyle, { backgroundColor: fallbackColor }]} />
  );
}
