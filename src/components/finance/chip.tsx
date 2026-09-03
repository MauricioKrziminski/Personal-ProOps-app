import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /**
   * Contagem, desenhada como BADGE dentro do chip.
   *
   * Antes ela era concatenada no rótulo (`mercado · 4`), e o número disputava leitura com o nome
   * do filtro na mesma cor e no mesmo peso. Como badge ele lê como quantidade — e em mono, que é
   * o tipo que o sistema usa para dado.
   */
  count?: number;
}

/** Chip de seleção (categorias, filtros, tipos de conta). */
export function Chip({ label, selected, onPress, count }: ChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      hitSlop={8}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.tint : theme.backgroundElement,
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      <ThemedText type="smallBold" themeColor={selected ? 'onTint' : 'text'}>
        {label}
      </ThemedText>
      {count != null ? (
        <View
          style={[
            styles.badge,
            { backgroundColor: selected ? theme.onTint : theme.backgroundSelected },
          ]}>
          <ThemedText type="code" themeColor={selected ? 'tint' : 'textSecondary'}>
            {count}
          </ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
  },
  badge: {
    minWidth: 20,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
    borderRadius: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
