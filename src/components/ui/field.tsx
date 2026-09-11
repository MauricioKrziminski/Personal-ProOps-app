import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { HitTarget, Radius, Space, Type, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { maskBRDate } from '@/lib/dates';

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

interface DateFieldProps {
  /** Data em `dd/mm/aaaa`, como o usuário digita. */
  value: string;
  onChangeText: (br: string) => void;
  invalid?: boolean;
  accessibilityLabel?: string;
  placeholder?: string;
}

/**
 * Campo de data em `dd/mm/aaaa` — **com a máscara, que não é detalhe: sem ela o campo não
 * aceita ser digitado no iOS.**
 *
 * ⚠️ O teclado `number-pad` do iOS **não tem a tecla "/"**. Um campo de data que espera o
 * usuário digitar a barra só aceita texto colado — foi a queixa "não consigo mudar a data".
 * `maskBRDate` põe as barras a partir dos DÍGITOS (e por isso o backspace atravessa a barra
 * sozinho), e este componente existe para que nenhuma tela precise lembrar disso.
 *
 * Eram SEIS campos de data no app e só um tinha máscara — e esse um carregava uma cópia local
 * chamada `mascaraData`. Os outros cinco (prazo da meta, início e fim da recorrência, data e
 * "repetir até" do lembrete) estavam indigitáveis no iPhone, em silêncio, porque no Android o
 * teclado numérico TEM a barra e o defeito não aparece no emulador.
 *
 * ponytail: teto conhecido — ele pede que a pessoa SAIBA a data. Onde ver o dia da semana
 * importa, o caminho é o `Calendar` inline (`components/finance/calendar.tsx`), como fez a
 * Projeção. Trocar os cinco de uma vez é redesenhar cinco formulários; a máscara conserta o
 * que está quebrado hoje.
 */
export function DateField({ value, onChangeText, invalid, accessibilityLabel, placeholder }: DateFieldProps) {
  return (
    <TextField
      value={value}
      onChangeText={(texto) => onChangeText(maskBRDate(texto))}
      placeholder={placeholder ?? 'dd/mm/aaaa'}
      keyboardType="number-pad"
      maxLength={10}
      accessibilityLabel={accessibilityLabel}
      invalid={invalid}
    />
  );
}

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
