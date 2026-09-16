/**
 * Tokens de forma, elevação, movimento e tipografia.
 *
 * Cores e famílias de fonte continuam em `src/constants/theme.ts` (acessadas por `useTheme()`).
 * Aqui mora tudo o que hoje está espalhado como literal nas telas: raio, sombra, duração,
 * curva e escala de texto.
 *
 * Regra: nenhum destes valores é redefinido em tela. Se falta um, ele nasce aqui.
 */

import type { TextStyle } from 'react-native';

import { Fonts } from '@/constants/theme';
import { Easing } from 'react-native-reanimated';

/**
 * Escala de raio do mundo Concreto: geometria dura, com o canto só aparado.
 *
 * O desenho anterior era feito de pílulas (o Stitch tinha 113 `rounded-full`). No Concreto a
 * pílula sobra para chip e avatar; botão é retângulo de `sm`, card é `md`. `borderCurve:
 * 'continuous'` continua em todo uso — mesmo num raio de 4 ele é o que separa o canto aparado
 * de um canto "arredondado de CSS".
 */
export const Radius = {
  /** barra de progresso, badge */
  xs: 2,
  /** botão, input, célula, chip de ícone */
  sm: 4,
  /** card */
  md: 6,
  /** bloco de destaque */
  lg: 8,
  /** sheet */
  xl: 12,
  /** chip e avatar — e só */
  pill: 999,
} as const;

/** Espaçamento em base 4. Substitui a escala ordinal de `theme.ts`, que não tinha 12 nem 48. */
export const Space = {
  half: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  /** calha do painel de destaque — o `gutter-lg` do Stitch, o único degrau que faltava */
  gutter: 20,
} as const;

/**
 * Elevação via `boxShadow` (RN 0.76+), nunca `shadowColor`/`shadowRadius`/`elevation` legado —
 * misturar os dois dá resultado diferente entre plataformas.
 *
 * Três níveis e só: superfície apoiada, superfície flutuante, superfície sobreposta.
 */
export const Elevation = {
  light: {
    none: 'none',
    raised: '0px 1px 2px rgba(0, 0, 0, 0.06)',
    floating: '0px 4px 12px rgba(0, 0, 0, 0.10)',
    overlay: '0px 12px 32px rgba(0, 0, 0, 0.16)',
  },
  dark: {
    none: 'none',
    raised: '0px 1px 2px rgba(0, 0, 0, 0.40)',
    floating: '0px 4px 12px rgba(0, 0, 0, 0.55)',
    overlay: '0px 12px 32px rgba(0, 0, 0, 0.70)',
  },
} as const;

export type ElevationLevel = keyof typeof Elevation.light;

/**
 * Um vocabulário de movimento para o app inteiro.
 *
 * Regra de decisão (ver `.claude/rules/design.md` §5): teve dedo envolvido → mola; não teve →
 * timing curto com ease-out forte. Nunca ease-in numa entrada, e saída sempre mais rápida que
 * entrada.
 */
export const Motion = {
  duration: {
    /** press feedback, troca de filtro */
    fast: 120,
    /** padrão: reposicionar, aparecer, sumir */
    base: 200,
    /** entrada de tela, gráfico redesenhando */
    slow: 280,
    /** saída — sempre menor que a entrada equivalente */
    exit: 140,
  },
  /** Curvas built-in do Reanimated são fracas demais para entrada; esta é a do sistema. */
  easing: {
    out: Easing.bezier(0.23, 1, 0.32, 1),
    inOut: Easing.bezier(0.65, 0, 0.35, 1),
  },
  /** Configs de `withSpring`. Sheet tem um quique de gesto; settle assenta sem oscilar. */
  spring: {
    sheet: { duration: 300, dampingRatio: 0.8 },
    settle: { duration: 400, dampingRatio: 1 },
    /**
     * Mola de CHROME — o berço da tab bar, o indicador de um segmented.
     *
     * `settle` é criticamente amortecida (ratio 1) e dura 400 ms: ela existe para um valor
     * ASSENTAR sem oscilar, e num controle tocado 100× por dia isso lê como travada — o
     * movimento chega ao fim tarde demais e sem nenhuma vida. Aqui a régua é a de trocar de aba:
     * rápida, com um overshoot mínimo que diz "chegou".
     */
    snap: { duration: 340, dampingRatio: 0.78 },
    /**
     * Mola da TAB BAR do Android — a única mola do app com quique de verdade.
     *
     * Com `snap` o berço atravessava as cinco abas em **~130 ms** (medido em quadros: quatro
     * quadros a 30 fps) e parava seco, sem passar do ponto. Lido no aparelho, isso não é
     * "rápido", é teleporte: o olho não acompanha o percurso, então a barra parece trocar de
     * estado em vez de se mover — foi a queixa "parece que foi de uma vez".
     *
     * `dampingRatio 0.62` dá ~10% de ultrapassagem, medido no emulador: o berço chega, passa um
     * fio e volta. É o "efeito de mola quando chega no ícone". A trajetória medida é ~180 ms de
     * percurso e ~500 ms até assentar. É deliberadamente mais lento que a régua do §5 de
     * design.md para um controle tocado 100× por dia — decisão do dono do produto, e o motivo é
     * que aqui o movimento É a resposta ao toque, não enfeite: ele carrega o ícone e o rótulo
     * fazendo crossfade ao longo do caminho.
     */
    tab: { duration: 1000, dampingRatio: 0.62 },
    /**
     * Assentar no grid — o azulejo encaixando. Chega firme e sem quique: o Concreto não balança,
     * ele trava no lugar. Usada no loader do botão, na carteira e em tudo que "encaixa".
     */
    encaixe: { duration: 420, dampingRatio: 0.86 },
    /** O cartão atravessando telas: longa o bastante para o olho seguir o giro, sem ultrapassar. */
    voo: { duration: 620, dampingRatio: 0.9 },
  },
  /**
   * A onda de azulejos (`TileField`): duração da onda, quanto as janelas dos azulejos se
   * sobrepõem, e as duas versões da abertura (a curta do dia a dia e o show das primeiras vezes).
   */
  curtain: { duration: 900, overlap: 0.6, short: 600, full: 1800 },
  /**
   * Escalonamento de entrada em lista: `delay = min(index * step, cap)`.
   *
   * O passo era **60 ms** e desceu para 30. Acima de ~30 ms por item — ou aplicado a mais de
   * meia dúzia deles — abrir uma tela deixa de ser "o conteúdo chegou" e vira "assista a esta
   * animação": com 60 ms o sexto bloco só aparecia 360 ms depois do primeiro, e o usuário que
   * abre o app para ver um número esperava a coreografia terminar.
   */
  stagger: { step: 30, cap: 400 },
  /** Escala do press-in. Linha de lista NÃO usa scale — usa highlight de fundo. */
  pressScale: 0.96,
} as const;

/**
 * Escala tipográfica na régua da plataforma.
 *
 * `tabular` liga `fontVariant: ['tabular-nums']` e é OBRIGATÓRIO em todo número que conta, mede
 * ou custa — sem ele o valor muda de largura enquanto anima.
 */
/**
 * ⚠️ **A altura de linha dos tamanhos grandes é ~1,17× o corpo, e isso é MEDIDO, não gosto.**
 * Jost tem ascendente de 1,07em e descendente de 0,375em. No iOS, uma caixa de linha menor que
 * `descendente + altura do glifo` desenha o glifo para FORA pelo topo — o "R$" do herói invadiu o
 * rótulo de cima na primeira captura (16/09/2026). Apertar o display abaixo disso é refazer o bug.
 */
export const Type = {
  /**
   * Exibição do Concreto: título em minúsculas, grande e apertado — a palavra como bloco.
   * Uma por tela, e só nas telas de exibição (conta, carteira, onboarding, saudação).
   */
  display: { fontFamily: Fonts.semibold, fontSize: 52, lineHeight: 60, letterSpacing: -2 },
  largeTitle: { fontFamily: Fonts.semibold, fontSize: 34, lineHeight: 40, letterSpacing: -1 },
  title: { fontFamily: Fonts.semibold, fontSize: 26, lineHeight: 30, letterSpacing: -0.6 },
  title2: { fontFamily: Fonts.semibold, fontSize: 20, lineHeight: 24, letterSpacing: -0.3 },
  headline: { fontFamily: Fonts.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.1 },
  body: { fontFamily: Fonts.regular, fontSize: 17, lineHeight: 24, letterSpacing: 0 },
  callout: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 20, letterSpacing: 0 },
  subhead: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 20, letterSpacing: 0 },
  footnote: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  /**
   * ⚠️ **Semibold, nunca a face 500, e isto foi MEDIDO no Android** (16/09/2026). Jost 500 a
   * 12px é medido mais ESTREITO do que é desenhado: numa caixa que abraça o texto,
   * "Trocar o valor" saía "Trocar o" e o resto sumia — sem erro, sem aviso. A mesma face a 15px
   * e as faces 400 e 600 a 12px medem certo. O botão pequeno, os badges e os rótulos de célula
   * usam este tipo, então a troca vale para o app inteiro.
   */
  caption: { fontFamily: Fonts.semibold, fontSize: 12, lineHeight: 15, letterSpacing: 0.2 },
  /** dinheiro de card — Jost tem numerais tabulares, então o valor não "dança" ao contar */
  money: { fontFamily: Fonts.semibold, fontSize: 32, lineHeight: 38, letterSpacing: -0.8 },
  /** o número do herói: o maior dado da tela */
  heroMoney: { fontFamily: Fonts.semibold, fontSize: 48, lineHeight: 56, letterSpacing: -1.6 },
  /** rótulo de seção em caixa alta, aberto */
  meta: { fontFamily: Fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 1.6 },
  /**
   * Mono, o segundo tipo do sistema. Hora, data, contador, unidade, badge de status.
   *
   * É o que carimba "isto é dado" sem gastar cor, e é metade da personalidade do design —
   * sem ele o app volta a ser uma escala de cinza só com Jost. Martian Mono é larga, por isso o
   * tracking negativo.
   */
  code: { fontFamily: Fonts.monoMedium, fontSize: 12, lineHeight: 16, letterSpacing: -0.2 },
  /** mono um degrau acima: valor de dinheiro dentro de card e linha */
  ticker: { fontFamily: Fonts.monoMedium, fontSize: 13, lineHeight: 18, letterSpacing: -0.3 },
} as const;

export type TypeVariant = keyof typeof Type;

/** Ligado em todo texto numérico. */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/** Alvo mínimo de toque (HIG e Material concordam em 44). */
export const HitTarget = 44;

/** Tamanhos de ícone, atrelados à escala de texto que acompanham. */
export const IconSize = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;
