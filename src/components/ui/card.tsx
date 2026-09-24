import { useContext } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { DeslocamentoDoArrasto, useCantosDoArrasto } from '@/components/ui/arrasto-contexto';

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
export function Card(props: CardProps) {
  // Dentro de um arrasto de card, a superfície perde o canto do lado que abre (`arrasto-contexto`).
  return useContext(DeslocamentoDoArrasto) ? <CardNoArrasto {...props} /> : <CardChapado {...props} />;
}

function CardNoArrasto({ children, elevation = 'none', style }: CardProps) {
  const cantos = useCantosDoArrasto(Radius.md);
  return (
    <Animated.View style={[useEstiloDoCard(elevation), style, cantos]}>
      {/* Só o card de FORA encosta no painel; um card dentro dele fica como é. */}
      <DeslocamentoDoArrasto.Provider value={null}>{children}</DeslocamentoDoArrasto.Provider>
    </Animated.View>
  );
}

function CardChapado({ children, elevation = 'none', style }: CardProps) {
  return <View style={[useEstiloDoCard(elevation), style]}>{children}</View>;
}

function useEstiloDoCard(elevation: ElevationLevel): ViewStyle {
  const theme = useTheme();
  const scheme = useScheme();
  return {
    backgroundColor: theme.surface,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    // O fio de 1px é a assinatura do Concreto: sem sombra, é ele que diz onde o card
    // termina. 1dp e não `hairlineWidth`, que é um pixel físico e some em escala.
    borderWidth: 1,
    borderColor: theme.cardBorder,
    padding: Space.lg,
    boxShadow: Elevation[scheme][elevation],
  };
}
