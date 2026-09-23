import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { StyleSheet, View } from 'react-native';

import { useScheme, useTheme } from '@/hooks/use-theme';
import { horaComoData, timeBR } from '@/lib/dates';
import type { TimePickerProps } from './time-picker.types';

/**
 * **Escolher uma HORA** — iOS: a roda do sistema, no lugar (como no app Lembretes).
 *
 * Aberta dentro do formulário, não em popover: a linha "Hora" abre e fecha a roda, e cada giro já
 * é o valor. `onClose` não é chamado aqui — quem fecha é a própria linha.
 */
export function TimePicker({ value, onChange, inlineStyle }: TimePickerProps) {
  const theme = useTheme();
  const scheme = useScheme();
  return (
    <View style={inlineStyle}>
      <DateTimePicker
        mode="time"
        display="spinner"
        locale="pt_BR"
        themeVariant={scheme}
        accentColor={theme.tint}
        value={horaComoData(value)}
        onValueChange={(_evento, escolhida) => onChange(timeBR(escolhida))}
        style={styles.roda}
      />
    </View>
  );
}

const styles = StyleSheet.create({ roda: { width: '100%' } });
