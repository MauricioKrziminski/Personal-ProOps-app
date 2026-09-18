import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCortinaAberta } from '@/components/motion/session-curtain';
import { WaveCurtain } from '@/components/motion/wave-curtain';
import { Mark } from '@/components/ui/mark';
import { Motion, Space } from '@/design/tokens';
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
 *
 * ## No tema escuro a capa sobe um degrau
 *
 * A tinta da cortina é a mesma cor do fundo escuro, e a capa sumia. Ela nasce na cor da cortina
 * (a costura com a abertura continua idêntica) e, com a cortina aberta, a cor do bloco de tinta do
 * tema escuro (`heroSurface`) acende por cima. Já aberta (trocar entre entrar e criar conta), a
 * capa nasce acesa, igual à da tela que sai.
 */
export function AuthCap() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // A curva segue a altura em toda rotação/split view, na UI thread e sem um quadro de costura.
  const progresso = useDerivedValue(() => progressoDaCapa(height));
  const aberta = useCortinaAberta();
  const degrau = theme.heroSurface !== theme.curtain;
  const acesa = useSharedValue(aberta ? 1 : 0);
  useEffect(() => {
    if (aberta) acesa.set(withTiming(1, { duration: Motion.duration.slow, easing: Motion.easing.out }));
  }, [aberta, acesa]);
  const acender = useAnimatedStyle(() => ({ opacity: acesa.get() }));

  return (
    <View pointerEvents="none" style={[styles.capa, { width, height }]}>
      <WaveCurtain
        progress={progresso}
        fase="revelar"
        mode="up"
        color={theme.curtain}
        style={StyleSheet.absoluteFill}
      />
      {degrau ? (
        <Animated.View style={[StyleSheet.absoluteFill, acender]}>
          <WaveCurtain
            progress={progresso}
            fase="revelar"
            mode="up"
            color={theme.heroSurface}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
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
