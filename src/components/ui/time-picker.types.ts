import type { StyleProp, ViewStyle } from 'react-native';

/** O contrato das duas implementações (`time-picker.tsx` e `time-picker.ios.tsx`). */
export interface TimePickerProps {
  /** `HH:MM`, o formato do formulário. */
  value: string;
  onChange: (hhmm: string) => void;
  /** O seletor terminou (Android: o diálogo fechou, com ou sem escolha). */
  onClose: () => void;
  /**
   * A moldura de quando o seletor abre NO LUGAR (iOS). No Android ele é um diálogo do sistema e
   * não ocupa espaço na tela — quem chama não precisa saber qual dos dois é.
   */
  inlineStyle?: StyleProp<ViewStyle>;
}
