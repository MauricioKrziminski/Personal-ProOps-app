import { Platform, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MudancaSuave, usePresencaAtiva } from '@/components/motion/presenca';
import { Space } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';

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
      <MudancaSuave valor={label} style={styles.texto}>
      <ThemedText type="default">
        {label}
      </ThemedText>
      </MudancaSuave>
      <Interruptor value={value} onValueChange={onValueChange} disabled={disabled} accessibilityLabel={label} />
    </View>
  );
}

/** O `Switch` com as cores do app no Android — o mesmo do `SwitchRow`, para linhas de lista (`Row trailing`). */
export function Interruptor({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  const ativo = usePresencaAtiva();
  const theme = useTheme();
  const scheme = useScheme();
  // Polegar desligado: no escuro `surface` é a cor do card e o polegar sumia (meia-lua); `text` contrasta.
  const polegarDesligado = scheme === 'dark' ? theme.text : theme.surface;
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled || !ativo}
      accessibilityLabel={accessibilityLabel}
      trackColor={Platform.OS === 'android' ? { false: theme.textSecondary, true: theme.tint } : undefined}
      // Desligado: trilho em `textSecondary` (≥ 4,5:1 sobre o card nos dois temas, contrast.test.ts) —
      // o cinza do sistema sumia no escuro. No iOS o trilho desligado é o `ios_backgroundColor`.
      ios_backgroundColor={theme.textSecondary}
      thumbColor={Platform.OS === 'android' ? (value ? theme.onTint : polegarDesligado) : undefined}
    />
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.md },
  texto: { flex: 1 },
});
