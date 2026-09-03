import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { Radius, Space } from '@/design/tokens';
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
          // O chip inativo leva contorno; o ativo não precisa, porque a cor já o separa. É o par
          // `bg-secondary text-black` / `bg-surface border-white/6` do export.
          borderColor: selected ? 'transparent' : theme.cardBorder,
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
            // Dentro do chip ativo o badge é um VÉU sobre o accent (`bg-black/15`), não um
            // disco sólido: sólido ele virava um segundo botão dentro do botão.
            { backgroundColor: selected ? theme.overlay : theme.backgroundSelected },
          ]}>
          <ThemedText type="code" themeColor={selected ? 'onTint' : 'textSecondary'}>
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
    gap: Space.sm,
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.xs + 2,
    // Pílula, como todo controle do design — `Spacing.four` (24) era um raio fora da escala.
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    minWidth: 20,
    paddingHorizontal: Space.xs,
    paddingVertical: 1,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
