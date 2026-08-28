import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { HitTarget, Radius, Space, Type, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface FieldProps {
  /** Label VISÍVEL. Placeholder não é label — some quando o usuário digita. */
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

/**
 * Envelope de campo: label visível, erro inline junto do campo (não no topo do form) e hint.
 *
 * Hoje as telas mostram `Não deu para salvar (nome repetido?)` num texto solto abaixo do botão —
 * genérico, longe do campo, e nunca com a causa real.
 */
export function Field({ label, error, hint, children }: FieldProps) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      {children}
      {error ? (
        <ThemedText type="small" themeColor="danger">
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

export const TextField = forwardRef<TextInput, TextInputProps & { invalid?: boolean }>(
  function TextField({ invalid, style, ...rest }, ref) {
    const theme = useTheme();
    return (
      <TextInput
        ref={ref}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          {
            backgroundColor: theme.backgroundElement,
            color: theme.text,
            borderColor: invalid ? theme.danger : 'transparent',
          },
          style,
        ]}
        {...rest}
      />
    );
  }
);

interface MoneyFieldProps {
  /** Valor em centavos. Nunca float. */
  valueCents: number;
  onChangeCents: (cents: number) => void;
  autoFocus?: boolean;
  invalid?: boolean;
}

/**
 * Entrada de dinheiro: digita da direita para a esquerda, em centavos.
 *
 * O caret fica escondido de propósito — o campo não é um texto editável, é um contador. Teto em
 * R$ 999.999.999,99 para não estourar `bigint` por dedo pesado.
 */
export function MoneyField({ valueCents, onChangeCents, autoFocus, invalid }: MoneyFieldProps) {
  const theme = useTheme();
  const reais = (valueCents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <View
      style={[
        styles.money,
        { backgroundColor: theme.backgroundElement, borderColor: invalid ? theme.danger : 'transparent' },
      ]}>
      <ThemedText themeColor="textSecondary" style={Type.title2}>
        R$
      </ThemedText>
      <TextInput
        value={reais}
        onChangeText={(text) => {
          const digits = text.replace(/\D/g, '').slice(0, 11);
          onChangeCents(Number(digits || 0));
        }}
        keyboardType="number-pad"
        caretHidden
        autoFocus={autoFocus}
        accessibilityLabel="Valor em reais"
        style={[styles.moneyInput, Type.title2, tabular, { color: theme.text }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Space.sm,
  },
  input: {
    minHeight: HitTarget,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    fontSize: Type.body.fontSize,
  },
  money: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 56,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Space.lg,
  },
  moneyInput: {
    flex: 1,
    textAlign: 'right',
  },
});
