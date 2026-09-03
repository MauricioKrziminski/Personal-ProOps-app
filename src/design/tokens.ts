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
 * Escala de raio. `borderCurve: 'continuous'` (squircle) acompanha TODO uso — é o detalhe mais
 * barato que faz a superfície parecer iOS.
 */
export const Radius = {
  /** menor raio permitido — badge, barra de progresso (`rounded` do Stitch) */
  xs: 4,
  /** input, linha de lista (`rounded-lg`) */
  sm: 8,
  /** card — o raio mais usado do design (`rounded-xl`, 46 ocorrências) */
  md: 12,
  /** card de destaque (`rounded-2xl`) */
  lg: 16,
  /** sheet */
  xl: 20,
  /** botão, chip, FAB, avatar (`rounded-full`, 113 ocorrências: o Stitch é feito de pílulas) */
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
    snap: { duration: 260, dampingRatio: 0.82 },
  },
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
  pressScale: 0.97,
} as const;

/**
 * Escala tipográfica na régua da plataforma.
 *
 * `tabular` liga `fontVariant: ['tabular-nums']` e é OBRIGATÓRIO em todo número que conta, mede
 * ou custa — sem ele o valor muda de largura enquanto anima.
 */
export const Type = {
  largeTitle: { fontFamily: Fonts.bold, fontSize: 32, lineHeight: 38, letterSpacing: -0.8 },
  title: { fontFamily: Fonts.semibold, fontSize: 26, lineHeight: 32, letterSpacing: -0.52 },
  title2: { fontFamily: Fonts.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  headline: { fontFamily: Fonts.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.17 },
  body: { fontFamily: Fonts.regular, fontSize: 17, lineHeight: 24, letterSpacing: -0.09 },
  callout: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 21, letterSpacing: -0.05 },
  subhead: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 21, letterSpacing: -0.05 },
  footnote: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  caption: { fontFamily: Fonts.medium, fontSize: 11, lineHeight: 14, letterSpacing: 0.44 },
  /** dinheiro em linha e no painel — o Stitch usa UM tamanho de display (`display-hero-mobile`) */
  money: { fontFamily: Fonts.bold, fontSize: 32, lineHeight: 38, letterSpacing: -0.8 },
  heroMoney: { fontFamily: Fonts.bold, fontSize: 32, lineHeight: 38, letterSpacing: -0.8 },
  /** rótulo de seção em caixa alta — `caption-xs` + `tracking-widest` */
  meta: { fontFamily: Fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 1.1 },
  /**
   * Mono, o segundo tipo do sistema. Hora, data, contador, unidade, badge de status.
   *
   * É o que carimba "isto é dado" sem gastar cor, e é metade da personalidade do design —
   * sem ele o app volta a ser uma escala de cinza só com Hanken Grotesk.
   */
  code: { fontFamily: Fonts.monoMedium, fontSize: 12, lineHeight: 16, letterSpacing: 0.24 },
  /** mono um degrau acima: valor de dinheiro dentro de card e linha */
  ticker: { fontFamily: Fonts.monoSemibold, fontSize: 14, lineHeight: 18, letterSpacing: -0.14 },
  /** a palavra "ProOps" na barra de topo — só o `AppHeader` usa */
  wordmark: { fontFamily: Fonts.bold, fontSize: 16, lineHeight: 20, letterSpacing: -0.4 },
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
