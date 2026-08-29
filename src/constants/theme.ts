/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * A paleta. **Monocromática por decisão de marca.**
 *
 * O `tint` era `#208AEF` — o azul do iOS, que não é de ninguém. A marca do ProOps é preto e
 * branco, então o accent virou **tinta**: quase-preto no claro, quase-branco no escuro.
 *
 * A consequência precisa ser entendida antes de mexer aqui: num sistema com accent colorido,
 * "isto é ação" se comunica por **matiz**. Sem matiz, passa a se comunicar por **superfície** —
 * o botão primário é uma pílula preenchida de tinta com o rótulo invertido (`onTint`). É como
 * Things e Linear funcionam, e é por isso que `onTint` **inverte junto** com o tema: branco
 * sobre preto no claro, preto sobre branco no escuro. Antes era branco nos dois, o que no tema
 * escuro daria branco sobre branco.
 *
 * `danger`, `success` e `warning` não mudaram e agora carregam **toda** a carga de cor do app.
 * Por isso a regra §2 (semântica nunca é decoração) fica mais séria, não menos: gastar vermelho
 * como enfeite queima a única alavanca de cor que sobrou.
 */
export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    tint: '#0A0A0B',
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
    /** fundo de estado ativo/selecionado derivado do tint — agora lavagem neutra, não azul */
    accentSoft: '#F0F0F2',
    /** rótulo sobre `tint` — substitui os 18 `#fff` hardcoded espalhados nas telas */
    onTint: '#FFFFFF',

    /**
     * O painel de destaque do topo (`HeroPanel`). Cor chapada, não vidro.
     *
     * No tema ESCURO ele é um degrau ACIMA do fundo (`#141416` sobre `#000000`): preto sobre
     * preto não é hero, é buraco.
     */
    heroSurface: '#0A0A0B',
    /** conteúdo sobre o hero */
    onHero: '#FFFFFF',
    /** rótulo e secundário do hero — o degrau de hierarquia lá dentro */
    onHeroMuted: 'rgba(255, 255, 255, 0.62)',
    /** hairline entre os tiles de ação dentro do hero */
    heroSeparator: 'rgba(255, 255, 255, 0.14)',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    tint: '#F5F5F7',
    danger: '#FF6369',
    success: '#3DD68C',
    warning: '#FFC53D',

    groupedBackground: '#000000',
    surface: '#1C1C1E',
    surfaceRaised: '#2C2C2E',
    separator: 'rgba(84, 84, 88, 0.65)',
    overlay: 'rgba(0, 0, 0, 0.60)',
    accentSoft: '#1A1A1D',
    /** inverte: sobre tinta clara o rótulo é escuro */
    onTint: '#0A0A0B',

    heroSurface: '#141416',
    onHero: '#F5F5F7',
    onHeroMuted: 'rgba(245, 245, 247, 0.58)',
    heroSeparator: 'rgba(255, 255, 255, 0.10)',
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
