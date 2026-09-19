import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

import { AuthBrand } from '@/components/auth/auth-brand';
import { WaveCurtain } from '@/components/motion/wave-curtain';
import { progressoDaCapa } from '@/design/wave-math';
import { useTheme } from '@/hooks/use-theme';

/**
 * A capa das telas de conta: a tinta da abertura, parada no topo — o cabeçalho curvo dos vídeos
 * de referência, com o wordmark do app.
 *
 * É a MESMA `WaveCurtain` da cortina da raiz, no mesmo progresso (`progressoDaCapa`) e do tamanho
 * da janela: quando a cortina para aqui e desmonta, a curva de baixo é idêntica e a passagem não
 * aparece. Por isso ela ocupa a JANELA inteira (a parte abaixo da curva é transparente) e fica fora
 * do fluxo — quem reserva o espaço do conteúdo é o `AuthScreen`, com `alturaDaCapa`.
 *
 * ## No tema escuro a capa continua visível
 *
 * A tinta da cortina sobe um degrau em relação ao fundo OLED (`curtain` é `heroSurface` no
 * escuro), então a capa permanece perceptível durante a passagem. A mesma cor é usada antes e
 * depois da cortina para não criar uma troca de tonalidade quando o conteúdo aparece.
 */
export function AuthCap() {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  // A curva segue a altura em toda rotação/split view, na UI thread e sem um quadro de costura.
  const progresso = useDerivedValue(() => progressoDaCapa(height));
  return (
    <View pointerEvents="none" style={[styles.capa, { width, height }]}>
      <WaveCurtain
        progress={progresso}
        fase="revelar"
        mode="up"
        color={theme.curtain}
        style={StyleSheet.absoluteFill}
      />
      <AuthBrand />
    </View>
  );
}

const styles = StyleSheet.create({
  capa: { position: 'absolute', top: 0, left: 0 },
});
