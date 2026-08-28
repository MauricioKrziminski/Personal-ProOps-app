/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    tint: '#208AEF',
    danger: '#E5484D',
    success: '#30A46C',
    warning: '#E8A33D',

    /** fundo de página de lista agrupada — o card branco descansa em cima dele */
    groupedBackground: '#F2F2F7',
    /** card opaco (o padrão; glass é só chrome + 1 destaque por tela) */
    surface: '#FFFFFF',
    /** superfície acima de um card — sheet, popover */
    surfaceRaised: '#FFFFFF',
    /** hairline entre linhas de lista */
    separator: 'rgba(60, 60, 67, 0.29)',
    /** scrim atrás de modal e sheet */
    overlay: 'rgba(0, 0, 0, 0.40)',
    /** fundo de estado ativo/selecionado derivado do tint */
    accentSoft: '#E7F1FD',
    /** rótulo sobre `tint` — substitui os 18 `#fff` hardcoded espalhados nas telas */
    onTint: '#FFFFFF',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    tint: '#4DA3FF',
    danger: '#FF6369',
    success: '#3DD68C',
    warning: '#FFC53D',

    groupedBackground: '#000000',
    surface: '#1C1C1E',
    surfaceRaised: '#2C2C2E',
    separator: 'rgba(84, 84, 88, 0.65)',
    overlay: 'rgba(0, 0, 0, 0.60)',
    accentSoft: '#12283F',
    onTint: '#FFFFFF',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
