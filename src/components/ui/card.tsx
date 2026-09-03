import { StyleSheet, View, useColorScheme, type StyleProp, type ViewStyle } from 'react-native';

import { Elevation, Radius, Space, type ElevationLevel } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface CardProps {
  children: React.ReactNode;
  /** `raised` é o padrão de card de conteúdo; `overlay` só para sheet/popover. */
  elevation?: ElevationLevel;
  style?: StyleProp<ViewStyle>;
}

/**
 * Card opaco — a superfície PADRÃO do app.
 *
 * `GlassCard` fica reservado para a CHROME. O destaque de uma raiz de aba é o `HeroPanel`
 * (tinta chapada); o de uma tela secundária é este `Card`
 * (`.claude/rules/design.md` §1). Card de lista é este aqui.
 */
export function Card({ children, elevation = 'raised', style }: CardProps) {
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderRadius: Radius.md,
          borderCurve: 'continuous',
          // O contorno de 1px é a assinatura do design: no fundo quase-preto a sombra some, e sem
          // ele o card não tem onde terminar — era o que fazia a tela ler como um bloco só.
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.cardBorder,
          padding: Space.lg,
          boxShadow: Elevation[scheme][elevation],
        },
        style,
      ]}>
      {children}
    </View>
  );
}
