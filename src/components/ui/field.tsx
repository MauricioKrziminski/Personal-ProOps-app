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
 *
 * ## Label e hint NÃO podem ter o mesmo estilo
 *
 * Os dois eram `type="small"` + `textSecondary`, byte por byte — em 47 campos.
 * Nada separava "o que é o campo" de "explicação sobre o campo", e um formulário
 * com quatro ou cinco hints virava uma parede de cinza de 15px onde o olho não
 * acha onde começa nada. Foi a queixa literal do dono do produto sobre a tela de
 * cartão: *"esses textos explicativos... está muito feio"*.
 *
 * A distinção anda em DOIS eixos, porque um só não sobrevive a 1,3×:
 * **tamanho** (15 → 13) e **cor** (`text` → `textSecondary`). É a régua que
 * `themed-text.tsx` já descreve: hierarquia sai de tamanho, peso e cor, nunca de
 * dois pixels de diferença.
 */
export function Field({ label, error, hint, children }: FieldProps) {
  return (
    <View style={styles.field}>
      {/* O label é IDENTIFICADOR do campo, e por isso vai na cor cheia. */}
      <ThemedText type="small">{label}</ThemedText>
      {children}
      {/*
        O erro NÃO apaga mais o hint. Eles se excluíam por um ternário, e o
        resultado era a explicação sumir exatamente quando ela mais importa: o
        campo está errado e a frase que diz o que ele espera desapareceu junto.
        Mesma geometria (footnote) nos dois, então a altura não pula na validação.
      */}
      {error ? (
        <ThemedText type="footnote" themeColor="danger">
          {error}
        </ThemedText>
      ) : null}
      {hint ? (
        <ThemedText type="footnote" themeColor="textSecondary">
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
