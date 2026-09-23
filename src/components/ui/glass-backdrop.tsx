import { createContext, useContext, type ReactNode } from 'react';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';
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
  colorScheme,
  effectStyle = 'regular',
}: {
  fallbackColor: string;
  radius: number;
  style?: StyleProp<ViewStyle>;
  tintColor?: string;
  colorScheme?: 'light' | 'dark';
  effectStyle?: 'regular' | 'clear';
}) {
  const appScheme = useScheme();
  const ready = useContext(GlassReadyContext);
  const surfaceStyle = [StyleSheet.absoluteFill, { borderRadius: radius }, style];
  const appearance = colorScheme ?? appScheme;
  // Em modo escuro, o vidro regular pode ficar claro ao refratar conteúdo luminoso
  // (por exemplo, um cartão colorido). Uma tinta escura translúcida mantém o texto legível.
  const resolvedTint = tintColor ?? (appearance === 'dark' && radius > 0 ? Colors.dark.overlay : undefined);

  /*
    ⚠️ Com `tintColor`, o conteúdo por cima foi escolhido para a TINTA (o `onTint` do dia escolhido,
    do chip ativo, do botão de enviar). O vidro montado dentro de um ancestral ainda em `FadeIn` não
    pinta — medido no iPhone escuro: o dia escolhido do "Meu mês" ficou preto sobre preto. A cor
    sólida por baixo garante o estado mesmo quando o vidro falha; quando ele pinta, fica por cima.
  */
  return supportsLiquidGlass() && ready ? (
    <>
      {tintColor ? (
        <View pointerEvents="none" style={[surfaceStyle, { backgroundColor: fallbackColor }]} />
      ) : null}
      <GlassView
        pointerEvents="none"
        glassEffectStyle={effectStyle}
        colorScheme={appearance}
        tintColor={resolvedTint}
        style={surfaceStyle}
      />
    </>
  ) : (
    <View pointerEvents="none" style={[surfaceStyle, { backgroundColor: fallbackColor }]} />
  );
}
