/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';

/** Tema travado em dark (OLED, fiel ao Stitch) — `Colors.light` fica só como referência. */
export function useTheme() {
  return Colors.dark;
}

/**
 * Estilo dos ícones da status bar — claro ou escuro.
 */
export function useBarStyle(): 'light' | 'dark' {
  return 'light';
}
