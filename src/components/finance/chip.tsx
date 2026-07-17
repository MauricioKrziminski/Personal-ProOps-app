import { Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/** Chip de seleção (categorias, filtros, tipos de conta). */
export function Chip({ label, selected, onPress }: ChipProps) {
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
      <ThemedText type="smallBold" style={selected ? styles.selectedLabel : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
  },
  selectedLabel: {
    color: '#fff',
  },
});
