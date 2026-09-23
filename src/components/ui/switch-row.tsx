import { StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Space } from '@/design/tokens';

/**
 * Interruptor de formulário: UMA linha — o que ele faz — e o switch.
 *
 * Existia montado à mão em quatro formulários com TRÊS textos para um toggle só: rótulo do
 * `Field` ("Confirmar automático"), a legenda ao lado ("Entrar como pago na data") e uma dica que
 * trocava com o estado ("Ligado, o lançamento já entra como pago na data."). A queixa foi de
 * texto demais (23/09/2026); a legenda sozinha já diz tudo.
 */
export function SwitchRow({
  label,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.linha}>
      <ThemedText type="default" style={styles.texto}>
        {label}
      </ThemedText>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.md },
  texto: { flex: 1 },
});
