/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * A paleta do mundo **Concreto** (16/09/2026) — Poesia Concreta e os azulejos do Athos Bulcão.
 *
 * Substituiu a paleta do Stitch (OLED + verde). O histórico do que foi testado antes (o roxo
 * devolvido, a tinta monocromática, o verde) mora em `.claude/rules/design.md`; aqui fica a
 * régua que vale agora.
 *
 * ## Quatro decisões
 *
 * 1. **Papel e tinta.** `#F2F3F1` e `#0D0D0C`, e uma família de cinza só entre eles. A
 *    hierarquia sai de bloco, fio de 1px e escala de tipo — não de sombra nem de vidro.
 * 2. **Um azul só, em dois tokens.** O azul Bulcão marca o que está ATIVO agora: ação primária,
 *    célula escolhida, o ciclo corrente. `tint` é o azul de texto e ícone; `tintFill` é o azul de
 *    CAMPO, com o rótulo em `onTint`. No claro os dois são o mesmo `#2A45F0`; no escuro não
 *    podem ser — o azul que lê bem como texto sobre tinta (`#7A8BFF`, 6:1) é claro demais para
 *    carregar rótulo branco (3:1), e o que carrega o rótulo (`#4B63FF`, 4,6:1) some como texto.
 *    `anti-slop.test.ts` quebra o build se `theme.tint` voltar a ser fundo.
 * 3. **O destaque é o NEGATIVO da página.** Bloco de tinta com texto papel no tema claro, bloco
 *    de papel com texto tinta no escuro. É a jogada concreta — e o motivo de os tokens `onHero*`
 *    trocarem de valor com o tema: a superfície do herói troca.
 * 4. **Semântica é só semântica.** `danger`, `success` e `warning` nunca decoram; nenhuma delas
 *    é azul, e o azul nunca significa estado.
 *
 * Contraste de cada par (texto, secundário, azul, semânticas, herói) é conferido por
 * `src/design/contrast.test.ts`, que lê ESTE arquivo — mudar um valor aqui sem passar lá quebra
 * o build.
 *
 * ## Tokens que só existem até a fase que os remove
 *
 * `heroTop`/`heroBottom` são aliases de `heroSurface` enquanto o cartão de crédito e o
 * onboarding ainda os leem, e `aurora*` vivem até a trava trocar de desenho.
 */
export const Colors = {
  light: {
    text: '#0D0D0C',
    background: '#F2F3F1',
    backgroundElement: '#E6E7E3',
    backgroundSelected: '#DADBD6',
    textSecondary: '#5E5E58',
    tint: '#2A45F0',
    tintFill: '#2A45F0',
    danger: '#B3261E',
    success: '#1A7F4B',
    warning: '#8A5300',

    groupedBackground: '#F2F3F1',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    separator: 'rgba(13, 13, 12, 0.16)',
    overlay: 'rgba(13, 13, 12, 0.44)',
    accentSoft: '#E3E7FD',
    onTint: '#FFFFFF',

    heroSurface: '#0D0D0C',
    heroTop: '#0D0D0C',
    heroBottom: '#0D0D0C',
    /** A faixa do rodapé do herói, que sangra até as bordas: um degrau dentro do bloco. */
    heroFooter: 'rgba(242, 243, 241, 0.06)',
    /** O press da faixa quando ela é tocável — sempre um degrau além de `heroFooter`. */
    heroFooterPress: 'rgba(242, 243, 241, 0.12)',
    onHero: '#F2F3F1',
    onHeroMuted: 'rgba(242, 243, 241, 0.64)',
    heroSeparator: 'rgba(242, 243, 241, 0.16)',
    /**
     * Cores DE DENTRO do herói.
     *
     * ⚠️ A superfície do herói é a oposta da página, então os controles dele não podem usar os
     * tokens normais: no claro isso já entregou um botão branco com ícone branco dentro. Dentro
     * do herói, só `onHero*` e `heroChip`.
     */
    heroChip: 'rgba(242, 243, 241, 0.14)',
    onHeroSuccess: '#5FD08F',
    onHeroDanger: '#FF8A7F',
    onHeroWarning: '#F2B356',
    auroraDeep: 'rgba(13, 13, 12, 0.06)',
    auroraGlow: 'rgba(42, 69, 240, 0.18)',
    auroraLift: 'rgba(242, 243, 241, 0.90)',
    cardBorder: 'rgba(13, 13, 12, 0.12)',
    dangerSoft: 'rgba(179, 38, 30, 0.10)',
    successSoft: 'rgba(26, 127, 75, 0.10)',
    warningSoft: 'rgba(138, 83, 0, 0.10)',

    /** Face do cartão de crédito: escura nos dois temas (chip e contactless precisam). */
    cardFace: '#141413',
    /** O campo de azulejos: tinta, o motivo azul e o motivo papel. Iguais ao splash nativo. */
    tileInk: '#0D0D0C',
    tileMotif: '#2A45F0',
    tilePaper: '#F2F3F1',
  },
  dark: {
    text: '#F2F3F1',
    background: '#0D0D0C',
    backgroundElement: '#1F1F1D',
    backgroundSelected: '#2A2A27',
    textSecondary: '#9A9A94',
    tint: '#7A8BFF',
    tintFill: '#4B63FF',
    danger: '#FF8A7F',
    success: '#5FD08F',
    warning: '#F2B356',

    groupedBackground: '#0D0D0C',
    surface: '#171716',
    surfaceRaised: '#2F2F2C',
    separator: 'rgba(242, 243, 241, 0.16)',
    overlay: 'rgba(0, 0, 0, 0.62)',
    accentSoft: '#1A1F3D',
    onTint: '#FFFFFF',

    heroSurface: '#F2F3F1',
    heroTop: '#F2F3F1',
    heroBottom: '#F2F3F1',
    heroFooter: 'rgba(13, 13, 12, 0.05)',
    heroFooterPress: 'rgba(13, 13, 12, 0.10)',
    onHero: '#0D0D0C',
    onHeroMuted: 'rgba(13, 13, 12, 0.62)',
    heroSeparator: 'rgba(13, 13, 12, 0.14)',
    heroChip: 'rgba(13, 13, 12, 0.08)',
    onHeroSuccess: '#1A7F4B',
    onHeroDanger: '#B3261E',
    onHeroWarning: '#8A5300',
    auroraDeep: 'rgba(242, 243, 241, 0.05)',
    auroraGlow: 'rgba(75, 99, 255, 0.18)',
    auroraLift: 'rgba(242, 243, 241, 0.04)',
    cardBorder: 'rgba(242, 243, 241, 0.10)',
    dangerSoft: 'rgba(255, 138, 127, 0.14)',
    successSoft: 'rgba(95, 208, 143, 0.14)',
    warningSoft: 'rgba(242, 179, 86, 0.14)',

    cardFace: '#141413',
    tileInk: '#0D0D0C',
    tileMotif: '#4B63FF',
    tilePaper: '#F2F3F1',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * As famílias do mundo Concreto (16/09/2026): **Jost** no texto e nos números grandes,
 * **Martian Mono** no dado em linha.
 *
 * Jost é a herdeira livre da Futura — o tipo da Poesia Concreta, que é a origem do desenho — e
 * tem numerais tabulares (`tnum`), então carrega também o dinheiro do herói. Martian Mono tem a
 * mesma geometria de círculo e quadrado e carimba hora, data, valor de linha e badge. Um tipo
 * para ler, outro para dado: sem o mono o app vira uma escala de cinza com uma fonte só.
 *
 * Substituiu Hanken Grotesk + JetBrains Mono, que eram a voz do desenho do Stitch.
 *
 * **Nome por PESO, nunca `fontWeight`.** Fonte custom no Android ignora `fontWeight` e cai no
 * regular com bold sintético; no iOS a família também é resolvida pelo nome do arquivo. Quem
 * escolhe o peso é a variante de `Type`, apontando para a face exata.
 */
export const Fonts = {
  regular: 'Jost_400Regular',
  /**
   * Itálico é FACE, não `fontStyle` — mesma regra do peso.
   *
   * Com `fontStyle: 'italic'` o iOS sintetiza uma oblíqua e o Android troca pela itálica do
   * SISTEMA: a citação do WhatsApp sairia numa fonte diferente do resto do card.
   */
  italic: 'Jost_400Regular_Italic',
  medium: 'Jost_500Medium',
  semibold: 'Jost_600SemiBold',
  bold: 'Jost_700Bold',
  /**
   * As duas faces que a marcação INLINE da nota precisa.
   *
   * `*negrito*` dentro de um `# título` (que já é semibold) e `_itálico_` dentro dele não têm
   * face sintética que preste: pela mesma regra do peso, o Android cairia no regular com bold
   * falso e o iOS inclinaria a letra por transformação. `faceKey` (`src/design/note-face.ts`)
   * resolve peso × itálico para uma destas faces exatas.
   */
  semiboldItalic: 'Jost_600SemiBold_Italic',
  boldItalic: 'Jost_700Bold_Italic',
  mono: 'MartianMono_400Regular',
  monoMedium: 'MartianMono_500Medium',
  monoSemibold: 'MartianMono_600SemiBold',
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
