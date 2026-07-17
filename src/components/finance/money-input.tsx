import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface MoneyInputProps {
  /** Valor SEMPRE em centavos inteiros — nunca float. */
  valueCents: number;
  onChangeCents: (cents: number) => void;
  autoFocus?: boolean;
}

/**
 * Input monetário estilo caixa: digita da direita para a esquerda em centavos
 * (4 -> R$ 0,04; 45 -> R$ 0,45; 4500 -> R$ 45,00).
 */
export function MoneyInput({ valueCents, onChangeCents, autoFocus }: MoneyInputProps) {
  const theme = useTheme();
  const display = (valueCents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="subtitle" themeColor="textSecondary" style={styles.prefix}>
        R$
      </ThemedText>
      <TextInput
        value={display}
        onChangeText={(text) => {
          const digits = text.replace(/\D/g, '');
          onChangeCents(digits ? Math.min(parseInt(digits, 10), 999_999_999_99) : 0);
        }}
        keyboardType="number-pad"
        autoFocus={autoFocus}
        caretHidden
        style={[styles.input, { color: theme.text }]}
        accessibilityLabel="Valor em reais"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  prefix: {
    fontSize: 24,
    lineHeight: 32,
  },
  input: {
    fontSize: 36,
    lineHeight: 44,
    fontWeight: '600',
    minWidth: 120,
    textAlign: 'center',
    padding: 0,
  },
});
