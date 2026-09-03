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
     * No tema ESCURO ele é um degrau ACIMA do fundo: preto sobre preto não é hero, é buraco.
     *
     * O valor era `#141416` — **um degrau de 20/255 sobre o preto**, o que na prática é nenhum:
     * o painel encostava no fundo e a tela perdia o bloco que devia dominar. Subiu para
     * `#242428`, que fica acima do fundo (`#000000`) E acima do card (`#1C1C1E`), então ele é a
     * maior superfície clara da tela — que é como um UI escuro diz "isto é o principal".
     *
     * A alternativa considerada e recusada foi **inverter** (painel branco no escuro): num
     * sistema monocromático inverter já significa "ação primária / selecionado" (é o que `tint`
     * faz), o painel ocupa ~30% da tela e viraria uma lanterna, e o app passaria a ter duas
     * caras diferentes entre os temas.
     */
    heroSurface: '#0A0A0B',
    /** conteúdo sobre o hero */
    onHero: '#FFFFFF',
    /** rótulo e secundário do hero — o degrau de hierarquia lá dentro */
    onHeroMuted: 'rgba(255, 255, 255, 0.62)',
    /** hairline entre os tiles de ação dentro do hero */
    heroSeparator: 'rgba(255, 255, 255, 0.14)',
    /** contorno de 1px do card — a assinatura do Stitch, e o que separa card de fundo sem sombra */
    cardBorder: 'rgba(0, 0, 0, 0.08)',
    /**
     * Superfícies TINGIDAS de semântica — o `error-container`/`secondary-container` do desenho.
     *
     * Existem porque badge e ícone de estado ficavam sobre cinza neutro: a cor aparecia só no
     * glifo, de 12px, e o bloco inteiro lia morto ao lado do desenho. É a mesma alavanca de cor
     * de sempre (semântica, nunca decoração), agora também na superfície.
     */
    dangerSoft: 'rgba(255, 99, 105, 0.12)',
    successSoft: 'rgba(61, 214, 140, 0.12)',
    warningSoft: 'rgba(255, 197, 61, 0.12)',
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
    surfaceRaised: '#35353B',
    separator: 'rgba(84, 84, 88, 0.65)',
    overlay: 'rgba(0, 0, 0, 0.60)',
    accentSoft: '#1A1A1D',
    /** inverte: sobre tinta clara o rótulo é escuro */
    onTint: '#0A0A0B',

    heroSurface: '#2C2C34',
    onHero: '#F5F5F7',
    onHeroMuted: 'rgba(245, 245, 247, 0.58)',
    heroSeparator: 'rgba(255, 255, 255, 0.10)',
    cardBorder: 'rgba(255, 255, 255, 0.06)',
    dangerSoft: 'rgba(255, 99, 105, 0.16)',
    successSoft: 'rgba(61, 214, 140, 0.14)',
    warningSoft: 'rgba(255, 197, 61, 0.14)',
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
