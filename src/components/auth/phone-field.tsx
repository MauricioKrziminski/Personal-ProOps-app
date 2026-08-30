import { forwardRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { HitTarget, Radius, Space, Type, tabular } from '@/design/tokens';
import { formatPhoneBR } from '@/lib/phone-br';
import { useTheme } from '@/hooks/use-theme';

interface PhoneFieldProps {
  /** Dígitos nacionais (sem DDI) — o dono do estado guarda o cru, o campo mostra formatado. */
  value: string;
  onChange: (digits: string) => void;
  onSubmit?: () => void;
  invalid?: boolean;
  autoFocus?: boolean;
  editable?: boolean;
}

/**
 * Entrada de telefone com o `+55` VISÍVEL.
 *
 * O código antigo prefixava `+55` em silêncio, dentro da função de envio. Isso é o pior tipo de
 * suposição: o usuário não vê para qual número o código vai, então quando ele não chega a única
 * hipótese disponível é "o app está quebrado".
 *
 * O prefixo é uma etiqueta fixa, não um campo — o produto é BR-only (ver `phone-br.ts`), e um
 * seletor de país seria uma escolha a mais para chegar sempre no mesmo lugar.
 */
export const PhoneField = forwardRef<TextInput, PhoneFieldProps>(function PhoneField(
  { value, onChange, onSubmit, invalid = false, autoFocus = false, editable = true },
  ref
) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: invalid ? theme.danger : theme.separator,
          borderWidth: invalid ? 2 : StyleSheet.hairlineWidth,
        },
      ]}>
      <ThemedText themeColor="textSecondary" style={[Type.body, tabular]}>
        +55
      </ThemedText>
      <View style={[styles.divider, { backgroundColor: theme.separator }]} />
      <TextInput
        ref={ref}
        value={formatPhoneBR(value)}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        editable={editable}
        autoFocus={autoFocus}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="go"
        placeholder="(11) 99999-9999"
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel="Número do WhatsApp com DDD"
        style={[styles.input, Type.body, tabular, { color: theme.text }]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 56,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: Space.md,
  },
  input: {
    flex: 1,
    minHeight: HitTarget,
  },
});
