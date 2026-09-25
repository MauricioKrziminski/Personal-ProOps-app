import { View, type StyleProp, type ViewStyle } from 'react-native';

import { Elevation, Radius, Space, type ElevationLevel } from '@/design/tokens';
import { useTheme, useScheme } from '@/hooks/use-theme';

interface CardProps {
  children: React.ReactNode;
  /** Card de conteúdo é chapado (`none`); `floating`/`overlay` só para o que flutua. */
  elevation?: ElevationLevel;
  style?: StyleProp<ViewStyle>;
}

/**
 * Card opaco — a superfície PADRÃO do app.
 *
 * No Concreto o card é CHAPADO: a hierarquia sai do fio de 1px e do degrau de cor, não de
 * sombra. O destaque de uma raiz de aba é o `HeroPanel` (o negativo da página); o de uma tela
 * secundária é este `Card`. Card de lista é este aqui.
 */
export function Card({ children, elevation = 'none', style }: CardProps) {
  const theme = useTheme();
  const scheme = useScheme();

  return (
    <View
      style={[
        {
          backgroundColor: theme.surface,
          borderRadius: Radius.md,
          borderCurve: 'continuous',
          // O fio de 1px é a assinatura do Concreto: sem sombra, é ele que diz onde o card
          // termina. 1dp e não `hairlineWidth`, que é um pixel físico e some em escala.
          borderWidth: 1,
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
