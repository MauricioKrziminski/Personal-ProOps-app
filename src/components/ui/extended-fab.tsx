import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/motion/pressable-scale';
import { Icon, type IconName } from '@/components/ui/icon';
import { TAB_BAR_CLEARANCE } from '@/components/ui/pill-tab-bar';
import { useRolagemDaTela } from '@/components/ui/screen-scroll';
import { Elevation, Motion, Radius, Space } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';

const ALTURA = 48;
/** Quanto a rolagem precisa andar para o botão mudar de estado — tremer no dedo não conta. */
const LIMIAR = 6;

/**
 * O FAB estendido do Material: pílula "+ Lançar" que recolhe para o círculo ao rolar para baixo e
 * volta ao rolar para cima (ou perto do topo). Lê a rolagem da tela na UI thread.
 *
 * A largura anima de propósito: é UM botão, e a alternativa (escala) amassaria o canto da pílula.
 */
export function ExtendedFab({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  const theme = useTheme();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();
  const reduzido = useReducedMotion();
  const rolagem = useRolagemDaTela();
  const aberto = useSharedValue(1);
  const alvo = useSharedValue(1);
  const [larguraAberta, setLarguraAberta] = useState(0);

  useAnimatedReaction(
    () => rolagem.get(),
    (y, anterior) => {
      const delta = anterior == null ? 0 : y - anterior;
      const novo = y < 24 ? 1 : delta > LIMIAR ? 0 : delta < -LIMIAR ? 1 : alvo.get();
      if (novo === alvo.get()) return;
      alvo.set(novo);
      aberto.set(reduzido ? novo : withTiming(novo, { duration: Motion.duration.base, easing: Motion.easing.out }));
    },
    [reduzido]
  );

  const estiloPilula = useAnimatedStyle(() =>
    larguraAberta > 0 ? { width: ALTURA + (larguraAberta - ALTURA) * aberto.get() } : {}
  );
  const estiloRotulo = useAnimatedStyle(() => ({
    opacity: aberto.get(),
    transform: [{ translateX: (1 - aberto.get()) * Space.sm }],
  }));

  return (
    <View
      // A âncora ocupa a linha inteira para o MEDIDOR abaixo não ser limitado pela largura do
      // botão (com a fonte do sistema crescendo, a medida ficava presa na largura antiga e o
      // rótulo saía cortado — "Lanc", medido a 384dp × 1,3). `box-none`: a faixa não rouba toque.
      pointerEvents="box-none"
      style={[
        styles.ancora,
        {
          // No Android o FAB sobe ACIMA da `PillTabBar` (que flutua); a folga já está na constante.
          bottom: insets.bottom + (Platform.OS === 'android' ? TAB_BAR_CLEARANCE : Space.xxl),
        },
      ]}>
      <PressableScale haptic="light" accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
        <Animated.View
          style={[
            styles.pilula,
            { backgroundColor: theme.tintFill, boxShadow: Elevation[scheme].floating },
            estiloPilula,
          ]}>
          <Icon name={icon} size="md" color="onTint" />
          <Animated.View style={estiloRotulo}>
            <ThemedText type="smallBold" themeColor="onTint" style={styles.semEncolher}>
              {label}
            </ThemedText>
          </Animated.View>
        </Animated.View>
      </PressableScale>
      {/* A medida da pílula aberta, invisível: é o alvo da largura. */}
      <View
        pointerEvents="none"
        style={[styles.pilula, styles.medida]}
        onLayout={(e) => setLarguraAberta(e.nativeEvent.layout.width)}>
        <Icon name={icon} size="md" color="onTint" />
        <ThemedText type="smallBold" style={styles.semEncolher}>
          {label}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ancora: { position: 'absolute', left: 0, right: Space.lg, alignItems: 'flex-end', zIndex: 11, elevation: 11 },
  pilula: {
    height: ALTURA,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: (ALTURA - 20) / 2,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  medida: { position: 'absolute', opacity: 0, right: 0, flexShrink: 0 },
  semEncolher: { flexShrink: 0 },
});
