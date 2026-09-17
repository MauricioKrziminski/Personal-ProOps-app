/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * A paleta **Suave** (16/09/2026) — papel morno, tinta e nada mais.
 *
 * Substituiu o mundo Concreto no mesmo dia, por decisão do dono do produto diante dos vídeos de
 * referência: *"estou sentindo muito quadrado as coisas, quero algo moderno, minimalista, nível o
 * vídeo"*. O histórico do que foi testado antes (o roxo devolvido, o verde, o azul Bulcão) mora em
 * `.claude/rules/design.md`; aqui fica a régua que vale agora.
 *
 * ## Quatro decisões
 *
 * 1. **Papel morno e tinta.** `#F2F1EE` e `#0B0B0C`, uma família de cinza entre eles. A
 *    hierarquia sai de superfície branca sobre papel, raio generoso e escala de tipo.
 * 2. **Monocromático: a ação é TINTA.** O botão primário é preto no claro e branco no escuro
 *    (`tintFill`, rótulo em `onTint`), como no vídeo. `tint` é o mesmo tom, para texto e ícone
 *    de ação. Não há matiz de marca — a marca é monocromática (design.md §9).
 * 3. **O destaque é um bloco escuro nos dois temas.** Tinta no claro; no escuro, um degrau acima
 *    do fundo (`#1C1C1E`) — um bloco branco no tema escuro ofuscava. Os tokens `onHero*` são
 *    claros nos dois.
 * 4. **Semântica é só semântica.** Verde é dinheiro que entra, vermelho é erro e atraso,
 *    âmbar é atenção. Nenhum decora.
 *
 * Contraste de cada par é conferido por `src/design/contrast.test.ts`, que lê ESTE arquivo.
 *
 * `heroTop`/`heroBottom` são aliases de `heroSurface` enquanto o cartão de crédito e o
 * onboarding ainda os leem.
 */
export const Colors = {
  light: {
    text: '#0B0B0C',
    background: '#F2F1EE',
    backgroundElement: '#E8E7E3',
    backgroundSelected: '#DDDCD7',
    textSecondary: '#6B6B70',
    tint: '#0B0B0C',
    tintFill: '#0B0B0C',
    danger: '#C0362C',
    success: '#157A45',
    warning: '#8A5300',

    groupedBackground: '#F2F1EE',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    separator: 'rgba(11, 11, 12, 0.08)',
    overlay: 'rgba(11, 11, 12, 0.40)',
    accentSoft: '#E8E7E3',
    onTint: '#FFFFFF',

    heroSurface: '#0B0B0C',
    heroTop: '#0B0B0C',
    heroBottom: '#0B0B0C',
    /** A faixa do rodapé do herói, que sangra até as bordas: um degrau dentro do bloco. */
    heroFooter: 'rgba(255, 255, 255, 0.06)',
    /** O press da faixa quando ela é tocável — sempre um degrau além de `heroFooter`. */
    heroFooterPress: 'rgba(255, 255, 255, 0.12)',
    onHero: '#F4F4F2',
    onHeroMuted: 'rgba(244, 244, 242, 0.60)',
    heroSeparator: 'rgba(244, 244, 242, 0.12)',
    /**
     * Cores DE DENTRO do herói. A superfície dele é escura nos dois temas, então os controles de
     * dentro não usam os tokens normais: dentro do herói, só `onHero*` e `heroChip`.
     */
    heroChip: 'rgba(255, 255, 255, 0.12)',
    onHeroSuccess: '#4CD68A',
    onHeroDanger: '#FF8A7F',
    onHeroWarning: '#F2B356',
    cardBorder: 'rgba(11, 11, 12, 0.06)',
    dangerSoft: 'rgba(192, 54, 44, 0.10)',
    successSoft: 'rgba(21, 122, 69, 0.10)',
    warningSoft: 'rgba(138, 83, 0, 0.10)',

    /** Face do cartão de crédito: escura nos dois temas (chip e contactless precisam). */
    cardFace: '#141413',
    /** A cortina da abertura e das trocas de sessão. Igual ao splash nativo, nos dois temas. */
    curtain: '#0B0B0C',
    onCurtain: '#F4F4F2',
    onCurtainMuted: 'rgba(244, 244, 242, 0.60)',
    /**
     * A faixa de rodapé de um CARD comum, que sangra até as bordas — um degrau mais escuro que o
     * card, nos dois temas.
     */
    cardFooter: 'rgba(11, 11, 12, 0.04)',
    /** O polegar do segmentado: branco sobre o trilho cinza no claro, um degrau acima no escuro. */
    thumb: '#FFFFFF',
    cardFooterPress: 'rgba(11, 11, 12, 0.08)',
  },
  dark: {
    text: '#F4F4F2',
    background: '#0B0B0C',
    backgroundElement: '#1C1C1E',
    backgroundSelected: '#2A2A2D',
    textSecondary: '#9B9BA0',
    tint: '#F4F4F2',
    tintFill: '#F4F4F2',
    danger: '#FF8A7F',
    success: '#4CD68A',
    warning: '#F2B356',

    groupedBackground: '#0B0B0C',
    surface: '#161618',
    surfaceRaised: '#222225',
    separator: 'rgba(244, 244, 242, 0.10)',
    overlay: 'rgba(0, 0, 0, 0.62)',
    accentSoft: '#1C1C1E',
    onTint: '#0B0B0C',

    heroSurface: '#1C1C1E',
    heroTop: '#1C1C1E',
    heroBottom: '#1C1C1E',
    heroFooter: 'rgba(255, 255, 255, 0.04)',
    heroFooterPress: 'rgba(255, 255, 255, 0.08)',
    onHero: '#F4F4F2',
    onHeroMuted: 'rgba(244, 244, 242, 0.60)',
    heroSeparator: 'rgba(244, 244, 242, 0.10)',
    heroChip: 'rgba(255, 255, 255, 0.10)',
    onHeroSuccess: '#4CD68A',
    onHeroDanger: '#FF8A7F',
    onHeroWarning: '#F2B356',
    cardBorder: 'rgba(244, 244, 242, 0.06)',
    dangerSoft: 'rgba(255, 138, 127, 0.14)',
    successSoft: 'rgba(76, 214, 138, 0.14)',
    warningSoft: 'rgba(242, 179, 86, 0.14)',

    cardFace: '#141413',
    curtain: '#0B0B0C',
    onCurtain: '#F4F4F2',
    onCurtainMuted: 'rgba(244, 244, 242, 0.60)',
    cardFooter: 'rgba(0, 0, 0, 0.24)',
    thumb: '#3A3A3E',
    cardFooterPress: 'rgba(0, 0, 0, 0.36)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * **Plus Jakarta Sans**, uma família só (16/09/2026, mundo Suave).
 *
 * É a grotesca dos vídeos de referência: aberta, de pesos leves, com numerais tabulares (`tnum`),
 * então carrega texto, título e dinheiro. Substituiu Jost + Martian Mono — o par geométrico com
 * mono era a voz do Concreto, e o mono em cada valor pesava contra o "limpo" pedido.
 *
 * **Nome por PESO, nunca `fontWeight`.** Fonte custom no Android ignora `fontWeight` e cai no
 * regular com bold sintético; no iOS a família também é resolvida pelo nome do arquivo. Quem
 * escolhe o peso é a variante de `Type`, apontando para a face exata.
 */
export const Fonts = {
  regular: 'PlusJakartaSans_400Regular',
  /**
   * Itálico é FACE, não `fontStyle` — mesma regra do peso.
   *
   * Com `fontStyle: 'italic'` o iOS sintetiza uma oblíqua e o Android troca pela itálica do
   * SISTEMA: a citação do WhatsApp sairia numa fonte diferente do resto do card.
   */
  italic: 'PlusJakartaSans_400Regular_Italic',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  /**
   * As duas faces que a marcação INLINE da nota precisa: `*negrito*` e `_itálico_` dentro de um
   * `# título`. `faceKey` (`src/design/note-face.ts`) resolve peso × itálico para uma delas.
   */
  semiboldItalic: 'PlusJakartaSans_600SemiBold_Italic',
  boldItalic: 'PlusJakartaSans_700Bold_Italic',
  /**
   * Mono só para o `código` inline da nota — é conteúdo que o usuário marcou como código, e
   * código em fonte proporcional desalinha. Nenhum rótulo do app usa esta face.
   */
  mono: 'MartianMono_400Regular',
} as const;

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

/**
 * A paleta de COR DE NOTA E DE PASTA — oito nomes, cada um com par claro/escuro.
 *
 * ## Por que aqui, e não num arquivo allowlistado como `card-brands.ts`
 *
 * O argumento que tirou as cores dos bancos da paleta é que **cor de terceiro não tem par**: o
 * roxo do Nubank é o mesmo roxo nos dois temas ou deixa de ser o roxo do Nubank. Estas são
 * NOSSAS e precisam de par — sobre `#F7F8F8` e sobre `#131315` o mesmo valor não serve —, então
 * elas moram onde mora toda cor do app.
 *
 * ## Por que oito cores não quebram "um accent só"
 *
 * Elas são **conteúdo do usuário**, não estado da interface, e vivem em geometria fechada: o
 * trilho de 3px na borda do cartão e o ladrilho do ícone da pasta. Nunca pintam texto, superfície
 * de card, botão ou ícone de ação. É a mesma fronteira que liberou a cor do emissor DENTRO da
 * forma de um cartão de crédito.
 *
 * ⚠️ **Nenhum dos oito é igual a `tint`, `danger` ou `warning`.** Reaproveitar o verde do accent
 * faria uma nota colorida ler como "selecionada"; reaproveitar o vermelho faria ler como erro —
 * e a cor semântica é a última alavanca de cor que este design tem.
 *
 * Os valores são tom 40 (claro) e tom 80 (escuro) do Material 3, a mesma régua com que `danger`
 * (`#BA1A1A` / `#FFB4AB`) foi construído: contraste suficiente para o trilho existir nos dois
 * temas sem virar um bloco de tinta.
 *
 * `violeta` está na lista de propósito. A regra «se um dia a cor voltar, que não seja roxo» vale
 * para o ACCENT do app — uma escolha do usuário num trilho de 3px não lê como marca de banco.
 */
export const NoteColors = {
  light: {
    grafite: '#545F71',
    oceano: '#00639C',
    violeta: '#6750A4',
    magenta: '#984061',
    terra: '#8F4C38',
    mostarda: '#6D5E00',
    musgo: '#3F6939',
    turquesa: '#00696E',
  },
  dark: {
    grafite: '#BCC7DC',
    oceano: '#9BCBFF',
    violeta: '#D0BCFF',
    magenta: '#FFB0C8',
    terra: '#FFB5A0',
    mostarda: '#E0C64B',
    musgo: '#A4D394',
    turquesa: '#4CD9E2',
  },
} as const;

/** O que o banco aceita em `notes.color` e `note_folders.color` (CHECK na migration). */
export type NoteColorName = keyof typeof NoteColors.light & keyof typeof NoteColors.dark;

/** A ordem em que as amostras aparecem no seletor. Fonte única — a tela não reordena. */
export const NOTE_COLOR_NAMES: readonly NoteColorName[] = [
  'grafite', 'oceano', 'turquesa', 'musgo', 'mostarda', 'terra', 'magenta', 'violeta',
] as const;
