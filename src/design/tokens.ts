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
import { Easing } from 'react-native-reanimated';

/**
 * Escala de raio. `borderCurve: 'continuous'` (squircle) acompanha TODO uso — é o detalhe mais
 * barato que faz a superfície parecer iOS.
 */
export const Radius = {
  /** menor raio permitido — badge, barra de progresso */
  xs: 8,
  /** input, linha de lista */
  sm: 12,
  /** card */
  md: 16,
  /** card de destaque */
  lg: 20,
  /** sheet */
  xl: 28,
  /** botão, chip, FAB */
  pill: 999,
} as const;

/** Espaçamento em base 4. Substitui a escala ordinal de `theme.ts`, que não tinha 12 nem 48. */
export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
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
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400' },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  /** display de dinheiro — `Fonts.rounded` entra aqui e no `heroMoney` */
  money: { fontSize: 40, lineHeight: 46, fontWeight: '700' },
  /**
   * O valor dentro do painel de destaque.
   *
   * Maior que o `money` porque ali ele não disputa com nada: o painel é uma superfície própria,
   * e o contraste de escala contra o rótulo (12) passa de 3,3× para 4,7×. `letterSpacing`
   * negativo porque display grande em peso 700 abre demais — é o mesmo ajuste que sistemas
   * tipográficos sem cor de marca usam para dar voz ao display.
   */
  heroMoney: { fontSize: 56, lineHeight: 60, fontWeight: '700', letterSpacing: -1.2 },
  /**
   * Metadado e etiqueta: data, categoria, origem ("via WhatsApp"), unidade.
   *
   * O par com o `heroMoney`/`money` é o que dá personalidade a um sistema **sem cor de marca** —
   * um tipo para o valor, outro para carimbar o contexto. É a regra que torna Vercel e Linear
   * reconhecíveis sem que nenhum deles tenha uma cor própria em tela.
   */
  meta: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.8 },
} as const;

export type TypeVariant = keyof typeof Type;

/** Ligado em todo texto numérico. */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/** Alvo mínimo de toque (HIG e Material concordam em 44). */
export const HitTarget = 44;

/** Tamanhos de ícone, atrelados à escala de texto que acompanham. */
export const IconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;
