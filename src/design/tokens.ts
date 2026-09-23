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
 * Escala de raio do mundo Suave (16/09/2026): canto generoso, como nos vídeos de referência.
 *
 * O Concreto tinha raios de 2 a 12 e foi recusado no mesmo dia — *"estou sentindo muito quadrado
 * as coisas"*. Aqui ação é pílula, campo tem canto de 12, card de 18 e o bloco de destaque de 24.
 * `borderCurve: 'continuous'` continua em todo uso: é o que faz o canto ler como o do iOS.
 */
export const Radius = {
  /** badge, marcador */
  xs: 6,
  /** campo, célula, chip de ícone quadrado */
  sm: 12,
  /** card, grupo de linhas */
  md: 18,
  /** bloco de destaque, cartão */
  lg: 24,
  /** sheet */
  xl: 28,
  /** botão, chip, segmentado, avatar, trilho de progresso */
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
     * O polegar do `Segmented` (Android/web) é DUAS bordas: a da frente corre com esta…
     */
    segmentoFrente: { duration: 300, dampingRatio: 0.84 },
    /** …e a de trás vem com esta, mais lenta — é a diferença entre as duas que estica o polegar. */
    segmentoTras: { duration: 520, dampingRatio: 0.9 },
    /**
     * Assentar no grid — o azulejo encaixando. Chega firme e sem quique: o Concreto não balança,
     * ele trava no lugar. Usada no loader do botão, na carteira e em tudo que "encaixa".
     */
    encaixe: { duration: 420, dampingRatio: 0.86 },
    /** O cartão atravessando telas: longa o bastante para o olho seguir o giro, sem ultrapassar. */
    voo: { duration: 620, dampingRatio: 0.9 },
    /**
     * O carrossel da Carteira assentando depois do dedo. Parte da VELOCIDADE do deslize (quem
     * chama passa `velocity`), então não há emenda entre o dedo e a mola; quase sem quique, para
     * o cartão chegar e parar em vez de balançar.
     */
    carrossel: { duration: 560, dampingRatio: 0.94 },
  },
  /**
   * A cortina curva (`WaveCurtain`): cada movimento usa a mesma duração. O show das primeiras
   * aberturas mantém sua espera própria antes da onda.
   */
  curtain: { duration: 1150, full: 1800 },
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
 * ⚠️ **A altura de linha é no mínimo 1,26× o tamanho, e isso é MEDIDO.** Plus Jakarta Sans tem
 * ascendente de 1,038em e descendente de 0,222em. No iOS, uma caixa de linha menor que isso
 * desenha o glifo para FORA pelo topo — foi como o "R$" do herói invadiu o rótulo de cima com a
 * fonte anterior (16/09/2026).
 *
 * Os pesos são LEVES de propósito: título em 600, número grande em 500, corpo em 400. É o que dá
 * o ar limpo dos vídeos — peso 700 em título pesa a tela inteira.
 */
/** Número que conta, mede ou custa: largura fixa por dígito. */
const NUMEROS = ['tabular-nums'] as TextStyle['fontVariant'];

export const Type = {
  /** Exibição: uma por tela, só nas telas de conta, carteira e onboarding. */
  display: { fontFamily: Fonts.semibold, fontSize: 36, lineHeight: 46, letterSpacing: -1.2 },
  largeTitle: { fontFamily: Fonts.semibold, fontSize: 30, lineHeight: 38, letterSpacing: -0.9 },
  title: { fontFamily: Fonts.semibold, fontSize: 24, lineHeight: 31, letterSpacing: -0.6 },
  title2: { fontFamily: Fonts.semibold, fontSize: 19, lineHeight: 24, letterSpacing: -0.3 },
  headline: { fontFamily: Fonts.semibold, fontSize: 16, lineHeight: 21, letterSpacing: -0.2 },
  body: { fontFamily: Fonts.regular, fontSize: 16, lineHeight: 23, letterSpacing: -0.1 },
  callout: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 21, letterSpacing: -0.1 },
  subhead: { fontFamily: Fonts.regular, fontSize: 14, lineHeight: 19, letterSpacing: -0.1 },
  footnote: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  caption: { fontFamily: Fonts.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0 },
  /** dinheiro de card — Plus Jakarta tem numerais tabulares, então o valor não "dança" ao contar */
  money: { fontFamily: Fonts.semibold, fontSize: 28, lineHeight: 36, letterSpacing: -0.8, fontVariant: NUMEROS },
  /** o número do herói: o maior dado da tela, em 500 como nos vídeos */
  heroMoney: { fontFamily: Fonts.medium, fontSize: 40, lineHeight: 51, letterSpacing: -1.4, fontVariant: NUMEROS },
  /** rótulo pequeno de seção e de bloco: caixa normal, cinza, sem tracking aberto */
  meta: { fontFamily: Fonts.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0 },
  /** dado pequeno em linha: hora, data, contador, badge */
  code: { fontFamily: Fonts.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0, fontVariant: NUMEROS },
  /** valor de dinheiro dentro de card e linha */
  ticker: { fontFamily: Fonts.semibold, fontSize: 14, lineHeight: 19, letterSpacing: -0.2, fontVariant: NUMEROS },
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
