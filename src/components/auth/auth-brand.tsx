import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Mark } from '@/components/ui/mark';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/design/tokens';

/**
 * Wordmark da porta de autenticação.
 *
 * A marca e o nome vivem num componente só porque aparecem na capa parada do login. A posição e a
 * tipografia ficam estáveis enquanto a onda cobre ou revela a tela, evitando um salto no cabeçalho.
 */
export function AuthBrand({ style }: { style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();

  return (
    <View
      accessible
      accessibilityLabel="ProOps"
      style={[styles.brand, { top: insets.top + Space.lg }, style]}>
      <Mark size={32} color="onCurtain" />
      <ThemedText type="subtitle" themeColor="onCurtain" style={styles.name}>
        ProOps
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    position: 'absolute',
    left: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  name: { letterSpacing: -0.8 },
});
