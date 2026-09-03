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
    onHero: '#E5E1E4',
    onHeroMuted: 'rgba(229, 225, 228, 0.60)',
    heroSeparator: 'rgba(255, 255, 255, 0.10)',
    heroChip: 'rgba(255, 255, 255, 0.12)',
    onHeroSuccess: '#6DDC9E',
    onHeroDanger: '#FFB4AB',
    onHeroWarning: '#FFB95F',
    cardBorder: 'rgba(255, 255, 255, 0.07)',
    dangerSoft: 'rgba(255, 180, 171, 0.14)',
    successSoft: 'rgba(109, 220, 158, 0.14)',
    warningSoft: 'rgba(255, 185, 95, 0.14)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * As famílias do design Stitch: **Hanken Grotesk** no texto, **JetBrains Mono** no número.
 *
 * O par é o que dá voz a um sistema sem cor de marca — um tipo para ler, outro para carimbar
 * dado (hora, valor, percentual, telefone, badge). Era a régua da plataforma (`system-ui`), e
 * por isso o app lia como "iOS bem feito genérico" mesmo com o layout certo.
 *
 * **Nome por PESO, nunca `fontWeight`.** Fonte custom no Android ignora `fontWeight` e cai no
 * regular com bold sintético; no iOS a família também é resolvida pelo nome do arquivo. Quem
 * escolhe o peso é a variante de `Type`, apontando para a face exata.
 */
export const Fonts = {
  regular: 'HankenGrotesk_400Regular',
  /**
   * Itálico é FACE, não `fontStyle` — mesma regra do peso.
   *
   * Com `fontStyle: 'italic'` o iOS sintetiza uma oblíqua e o Android troca pela itálica do
   * SISTEMA: a citação do WhatsApp sairia numa fonte diferente do resto do card.
   */
  italic: 'HankenGrotesk_400Regular_Italic',
  medium: 'HankenGrotesk_500Medium',
  semibold: 'HankenGrotesk_600SemiBold',
  bold: 'HankenGrotesk_700Bold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
  monoSemibold: 'JetBrainsMono_600SemiBold',
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
