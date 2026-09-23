import { Host, TimePickerDialog } from '@expo/ui/jetpack-compose';

import { useTheme } from '@/hooks/use-theme';
import { horaComoData, timeBR } from '@/lib/dates';
import type { TimePickerProps } from './time-picker.types';

/**
 * **Escolher uma HORA** — Android: o relógio do Material 3, em diálogo.
 *
 * O diálogo abre quando o componente MONTA e quem chama o desmonta no `onClose` (é o contrato do
 * `@expo/ui`: não há `open()` imperativo). O diálogo é do sistema, não um `Modal` do React Native,
 * então não disputa janela com o sheet do formulário.
 *
 * Por que não um campo de texto: `HH:MM` digitado exige a tecla ":" — que o teclado numérico do
 * iPhone não tem — e, apagado, o campo não tinha como voltar a ser uma hora válida (a queixa de
 * 23/09/2026). O relógio do sistema tem os dois modos (mostrador e teclado) e não aceita hora
 * inválida.
 *
 * ⚠️ **As cores vão uma a uma (`elementColors`), nunca só `color`.** Sem nada, o Compose pinta o
 * azul do tema padrão do Material — um segundo accent no app monocromático. Só com `color` na
 * tinta, a hora selecionada saía azul-escuro sobre preto, ilegível. O mapeamento abaixo é o do
 * resto do app: a escolha é TINTA com rótulo `onTint`, o resto é papel.
 */
export function TimePicker({ value, onChange, onClose }: TimePickerProps) {
  const theme = useTheme();
  return (
    <Host>
      <TimePickerDialog
        is24Hour
        initialDate={horaComoData(value).toISOString()}
        confirmButtonLabel="OK"
        dismissButtonLabel="Cancelar"
        color={theme.tint}
        elementColors={{
          containerColor: theme.surface,
          clockDialColor: theme.backgroundElement,
          clockDialSelectedContentColor: theme.onTint,
          clockDialUnselectedContentColor: theme.text,
          selectorColor: theme.tintFill,
          timeSelectorSelectedContainerColor: theme.tintFill,
          timeSelectorSelectedContentColor: theme.onTint,
          timeSelectorUnselectedContainerColor: theme.backgroundElement,
          timeSelectorUnselectedContentColor: theme.text,
        }}
        onDateSelected={(escolhida) => {
          onChange(timeBR(escolhida));
          onClose();
        }}
        onDismissRequest={onClose}
      />
    </Host>
  );
}
