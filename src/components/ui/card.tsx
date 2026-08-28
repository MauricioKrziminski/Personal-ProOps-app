import { View, useColorScheme, type StyleProp, type ViewStyle } from 'react-native';

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
 * `GlassCard` fica reservado para a chrome e para o único card de destaque de cada tela
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
          padding: Space.lg,
          boxShadow: Elevation[scheme][elevation],
        },
        style,
      ]}>
      {children}
    </View>
  );
}
