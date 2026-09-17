import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WaveCurtain } from '@/components/motion/wave-curtain';
import { Mark } from '@/components/ui/mark';
import { Space } from '@/design/tokens';
import { progressoDaCapa } from '@/design/wave-math';
import { useTheme } from '@/hooks/use-theme';

/**
 * A capa das telas de conta: a tinta da abertura, parada no topo — o cabeçalho curvo dos vídeos
 * de referência, com a marca.
 *
 * É a MESMA `WaveCurtain` da cortina da raiz, no mesmo progresso (`progressoDaCapa`) e do tamanho
 * da janela: quando a cortina para aqui e desmonta, a curva de baixo é idêntica e a passagem não
 * aparece. Por isso ela ocupa a JANELA inteira (a parte abaixo da curva é transparente) e fica fora
 * do fluxo — quem reserva o espaço do conteúdo é o `AuthScreen`, com `alturaDaCapa`.
 */
export function AuthCap() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const progresso = useSharedValue(progressoDaCapa(height));

  return (
    <View pointerEvents="none" style={[styles.capa, { width, height }]}>
      <WaveCurtain
        progress={progresso}
        fase="revelar"
        mode="up"
        color={theme.curtain}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.marca, { top: insets.top + Space.lg }]}>
        <Mark size={40} color="onCurtain" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  capa: { position: 'absolute', top: 0, left: 0 },
  marca: { position: 'absolute', left: Space.xl },
});
