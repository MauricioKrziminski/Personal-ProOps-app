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
/**
 * ## O roxo foi testado e devolvido (30/08/2026)
 *
 * A marca do ProOps é monocromática de verdade — todos os assets são preto ou branco puro. Ainda
 * assim o app lia como "iOS bem feito genérico", e a queixa era legítima.
 *
 * Foram prototipados roxo como `tint` inteiro e roxo só no `HeroPanel`. Os dois ficaram bonitos.
 * Os dois foram descartados, por dois motivos independentes:
 *
 * 1. **Medição.** Contando matiz por pixel no conteúdo da tela Hoje (abaixo do painel, acima da
 *    tab bar), o accent roxo derrubava o vermelho do "estourou o orçamento" de 53% para 44% da
 *    cor da tela — e ia parar em ícone de linha e tag de categoria, que não são ação nem estado.
 * 2. **Mercado.** Roxo, em finanças no Brasil, é o Nubank: o apelido da empresa é "roxinho", o
 *    ticker é ROXO34 e eles atendem 61% da população adulta. Um bloco roxo com o saldo do mês
 *    tinha chance real de ler como Nubank antes de ler como ProOps.
 *
 * A chatice era real, mas a causa não era matiz — era **amplitude**. No tema escuro havia três
 * superfícies dentro de 36/255 (fundo `#000000`, card `#1C1C1E`, painel `#141416`): tudo
 * acontecia num intervalo estreito demais para haver hierarquia.
 *
 * ## A escada do tema escuro, agora explícita
 *
 * | superfície | valor | degrau sobre o fundo |
 * |---|---|---|
 * | `background` / `groupedBackground` | `#000000` | — |
 * | `surface` (card) | `#1C1C1E` | 28 |
 * | `backgroundElement` (input, chip) | `#212225` | 33 |
 * | `heroSurface` (painel) | `#2C2C34` | 44 |
 * | `surfaceRaised` (sheet, popover) | `#35353B` | 53 |
 *
 * O elo quebrado era card → painel, que valia **8** e agora vale 16: o painel encostava no card e
 * a tela perdia o bloco que deveria dominar. `surfaceRaised` subiu junto porque estava em
 * `#2C2C2E` e passaria a empatar com o painel — sheet precisa continuar lendo acima de tudo.
 *
 * Em UI escura, mais claro = mais importante; é assim que se diz "isto é o principal" sem cor.
 */
export const Colors = {
  /**
   * ## Claro — derivado do escuro, não copiado dele
   *
   * O Stitch só exportou o tema OLED. O claro foi construído mantendo os PAPÉIS e refazendo os
   * valores para contraste: o verde do escuro (`#6ddc9e`) sobre branco dá 1,7:1 e some, então o
   * accent aqui é o mesmo verde escurecido até passar em texto (`#0d8f5b`, ~4,6:1). Mesma coisa
   * para vermelho e âmbar — âmbar claro é o pior caso e por isso ele é marrom-dourado, não
   * amarelo.
   *
   * O painel de destaque continua ESCURO no tema claro: é o bloco que domina a tela e, chapado de
   * branco sobre fundo branco, ele deixaria de ser destaque.
   */
  light: {
    text: '#131315',
    background: '#F7F8F8',
    backgroundElement: '#EDEFEF',
    backgroundSelected: '#E1E5E4',
    textSecondary: '#5B6060',
    tint: '#0D8F5B',
    danger: '#BA1A1A',
    success: '#0D8F5B',
    warning: '#8A5300',

    groupedBackground: '#F2F3F4',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    separator: 'rgba(19, 19, 21, 0.14)',
    overlay: 'rgba(0, 0, 0, 0.40)',
    accentSoft: '#E4F4EC',
    onTint: '#FFFFFF',

    heroSurface: '#17181A',
    /**
     * O gradiente do painel de destaque, medido do export
     * (`from-surface-container-high via-surface-container to-surface-container-low`).
     *
     * Ele é sutil de propósito — 15/255 entre topo e base. O que o olho lê não é "gradiente", é
     * uma superfície que tem CIMA e BAIXO; chapada, ela lê como um retângulo colado na tela.
     */
    heroTop: '#26272A',
    heroBottom: '#141517',
    /** A faixa do rodapé do card, que sangra até as bordas. `surface-container-lowest/50`. */
    heroFooter: 'rgba(0, 0, 0, 0.22)',
    /**
     * O press da faixa, quando ela é TOCÁVEL (o rodapé do card de Lançamentos leva ao ciclo).
     *
     * ⚠️ Precisa ser mais escuro que `heroFooter`, não `backgroundSelected`: aquele é uma cor
     * SÓLIDA e mais clara que esta faixa no tema claro, então o toque clarearia num tema e
     * escureceria no outro. Como `heroFooter`, esta escurece o que estiver embaixo nos dois.
     */
    heroFooterPress: 'rgba(0, 0, 0, 0.32)',
    onHero: '#FFFFFF',
    onHeroMuted: 'rgba(255, 255, 255, 0.64)',
    heroSeparator: 'rgba(255, 255, 255, 0.16)',
    /**
     * Cores DE DENTRO do painel — iguais nos dois temas, de propósito.
     *
     * O painel é escuro no claro e no escuro. Pintando os controles dele com os tokens do tema
     * ativo, o modo claro entregava um botão BRANCO SÓLIDO (`surfaceRaised` = `#FFFFFF`) com um
     * ícone branco dentro — invisível — e o vermelho escuro do `danger` claro numa pílula
     * translúcida sobre preto. Superfície escura pede cor clara, e isso não depende do tema.
     */
    heroChip: 'rgba(255, 255, 255, 0.14)',
    onHeroSuccess: '#6DDC9E',
    onHeroDanger: '#FFB4AB',
    onHeroWarning: '#FFB95F',
    /**
     * As três massas de luz da cortina de bloqueio (`components/lock/aurora.tsx`).
     *
     * ⚠️ **O alfa mora AQUI, não na tela.** As três precisam de intensidades diferentes em cada
     * tema — sobre o quase-branco uma massa forte vira borrão sujo, e sobre o quase-preto uma
     * massa fraca não existe —, e um `opacity` escrito no componente seria a decisão de cor
     * acontecendo fora do arquivo de cor. Com o alfa no token, o componente pinta e pronto.
     *
     * ⚠️ **A cortina segue o TEMA, não é escura nos dois.** Tentador copiar o `hero*` (que é
     * escuro sempre), e errado: o splash é branco no claro e preto no escuro, e a cortina aparece
     * logo depois dele — escura no tema claro, ela é exatamente o "flash de cor errada na
     * transição" que §9 do design proíbe. Medido: `heroTop` a 55% sobre `#F7F8F8` dá um borrão
     * cinza no meio da tela.
     */
    auroraDeep: 'rgba(19, 19, 21, 0.09)',
    auroraGlow: 'rgba(13, 143, 91, 0.24)',
    auroraLift: 'rgba(255, 255, 255, 0.95)',
    cardBorder: 'rgba(19, 19, 21, 0.09)',
    dangerSoft: 'rgba(186, 26, 26, 0.10)',
    successSoft: 'rgba(13, 143, 91, 0.10)',
    warningSoft: 'rgba(138, 83, 0, 0.10)',
  },
  /**
   * ## Escuro — a paleta do Stitch, lida do `tailwind.config` exportado
   *
   * | papel | Stitch | aqui |
   * |---|---|---|
   * | fundo | `background` `#131315` | `background` |
   * | card | `surface-container-low` `#1b1b1d` | `surface` |
   * | input, chip | `surface-container` `#201f21` | `backgroundElement` |
   * | selecionado | `surface-container-high` `#2a2a2c` | `backgroundSelected` |
   * | sheet, popover | `surface-bright` `#39393b` | `surfaceRaised` |
   * | texto | `on-surface` `#e5e1e4` | `text` |
   * | secundário | `on-surface-variant` `#c4c7c8` | `textSecondary` |
   * | **accent** | `secondary` `#6ddc9e` | `tint` **e** `success` |
   * | sobre o accent | `on-secondary` `#003920` | `onTint` |
   * | erro | `error` `#ffb4ab` | `danger` |
   * | contorno | `outline-variant` `#444748` | `separator` |
   *
   * **O accent voltou a ter matiz** (03/09/2026, decisão do dono do produto): era tinta
   * monocromática e agora é o verde do desenho. Isso muda como ação se comunica — antes era só
   * superfície (pílula preenchida de tinta), agora é superfície **e** matiz. `danger` e `warning`
   * continuam semânticos e continuam sendo os únicos outros matizes da tela.
   */
  dark: {
    text: '#E5E1E4',
    background: '#131315',
    backgroundElement: '#201F21',
    backgroundSelected: '#2A2A2C',
    textSecondary: '#A9AEAF',
    tint: '#6DDC9E',
    danger: '#FFB4AB',
    success: '#6DDC9E',
    warning: '#FFB95F',

    groupedBackground: '#131315',
    surface: '#1B1B1D',
    surfaceRaised: '#39393B',
    separator: '#444748',
    overlay: 'rgba(0, 0, 0, 0.60)',
    accentSoft: '#173226',
    onTint: '#003920',

    heroSurface: '#201F21',
    heroTop: '#2A2A2C',
    heroBottom: '#1B1B1D',
    heroFooter: 'rgba(0, 0, 0, 0.30)',
    heroFooterPress: 'rgba(0, 0, 0, 0.42)',
    onHero: '#E5E1E4',
    onHeroMuted: 'rgba(229, 225, 228, 0.60)',
    heroSeparator: 'rgba(255, 255, 255, 0.10)',
    heroChip: 'rgba(255, 255, 255, 0.12)',
    onHeroSuccess: '#6DDC9E',
    onHeroDanger: '#FFB4AB',
    onHeroWarning: '#FFB95F',
    auroraDeep: 'rgba(96, 116, 128, 0.24)',
    auroraGlow: 'rgba(109, 220, 158, 0.22)',
    auroraLift: 'rgba(255, 255, 255, 0.07)',
    cardBorder: 'rgba(255, 255, 255, 0.07)',
    dangerSoft: 'rgba(255, 180, 171, 0.14)',
    successSoft: 'rgba(109, 220, 158, 0.14)',
    warningSoft: 'rgba(255, 185, 95, 0.14)',
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
