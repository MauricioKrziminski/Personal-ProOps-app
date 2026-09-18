import { createContext, useContext, type ReactNode } from 'react';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useScheme } from '@/hooks/use-theme';

const GlassReadyContext = createContext(true);

/** Mount native glass only once an ancestor's entrance opacity has reached its final value. */
export function GlassReady({ ready, children }: { ready: boolean; children: ReactNode }) {
  if (Platform.OS !== 'ios') return <>{children}</>;
  return <GlassReadyContext.Provider value={ready}>{children}</GlassReadyContext.Provider>;
}

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
  effectStyle = 'regular',
}: {
  fallbackColor: string;
  radius: number;
  style?: StyleProp<ViewStyle>;
  tintColor?: string;
  effectStyle?: 'regular' | 'clear';
}) {
  const scheme = useScheme();
  const ready = useContext(GlassReadyContext);
  const surfaceStyle = [StyleSheet.absoluteFill, { borderRadius: radius }, style];

  return supportsLiquidGlass() && ready ? (
    <GlassView
      pointerEvents="none"
      glassEffectStyle={effectStyle}
      colorScheme={scheme}
      tintColor={tintColor}
      style={surfaceStyle}
    />
  ) : (
    <View pointerEvents="none" style={[surfaceStyle, { backgroundColor: fallbackColor }]} />
  );
}
