import { useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions, type DimensionValue } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  makeMutable,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  tone?: 'surface' | 'hero';
}

/**
 * O relógio da varredura — UM para a tela inteira.
 *
 * Cada bloco lê a mesma fase e desconta a própria posição na janela, então a faixa atravessa a
 * tela como uma linha só, passando por todos os blocos na ordem — em vez de cada um piscar no seu
 * ritmo. O relógio liga com o primeiro esqueleto montado e desliga com o último.
 */
const relogio = makeMutable(0);
let montados = 0;
const VARREDURA_MS = 1500;

function ligar() {
  montados += 1;
  if (montados === 1) {
    relogio.value = 0;
    relogio.value = withRepeat(
      withTiming(1, { duration: VARREDURA_MS, easing: Easing.inOut(Easing.quad) }),
      -1,
      false
    );
  }
}

function desligar() {
  montados = Math.max(0, montados - 1);
  if (montados === 0) cancelAnimation(relogio);
}

/**
 * Bloco de carregamento.
 *
 * Skeleton só existe se tiver **a forma do conteúdo final** — spinner de tela cheia para
 * atualização parcial é reprovação na regra de design §7. Componha vários para desenhar a tela.
 *
 * ## A varredura
 *
 * O pisca de opacidade virou uma FAIXA chapada de borda dura, inclinada, que atravessa o bloco —
 * a leitura de um scanner, no vocabulário do Concreto (sem gradiente). Com Reduce Motion o bloco
 * fica parado.
 */
export function Skeleton({ width = '100%', height = 16, radius = Radius.xs, tone = 'surface' }: SkeletonProps) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const { width: tela } = useWindowDimensions();
  const caixa = useRef<View>(null);
  /** A posição do bloco na janela, medida uma vez: é ela que sincroniza a faixa entre blocos. */
  const origem = useSharedValue(0);
  const faixa = tela * 0.35;

  useEffect(() => {
    if (reduzido) return;
    ligar();
    return desligar;
  }, [reduzido]);

  const varredura = useAnimatedStyle(() => ({
    transform: [
      { translateX: -faixa + relogio.value * (tela + faixa * 2) - origem.value },
      { skewX: '-14deg' },
    ],
  }));

  return (
    <View
      ref={caixa}
      onLayout={() => caixa.current?.measureInWindow((x) => origem.set(x))}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width,
        height,
        borderRadius: radius,
        borderCurve: 'continuous',
        backgroundColor: tone === 'hero' ? theme.heroChip : theme.backgroundElement,
        overflow: 'hidden',
      }}>
      {reduzido ? null : (
        <Animated.View
          style={[
            styles.faixa,
            { width: faixa, backgroundColor: tone === 'hero' ? theme.heroSeparator : theme.backgroundSelected },
            varredura,
          ]}
        />
      )}
    </View>
  );
}

/** Forma pronta de linha de lista: título curto + subtítulo. */
export function SkeletonRow() {
  return (
    <Animated.View style={styles.row}>
      <Skeleton width="60%" height={17} />
      <Skeleton width="35%" height={13} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  faixa: { position: 'absolute', top: -4, bottom: -4, left: 0 },
  row: {
    gap: Space.sm,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
  },
  // `Space.gutter` e `Radius.md`: a mesma calha e o mesmo raio do `HeroPanel`, para o conteúdo
  // não pular de lugar quando ele substituir a forma.
  hero: {
    gap: Space.md,
    padding: Space.gutter,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  /** Título de seção + corpo — o `gap` de dentro de um bloco (`Space.sm`), como no `Screen`. */
  bloco: { gap: Space.sm },
  card: {
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  pilha: { paddingTop: Space.sm },
  atras: {
    height: 16,
    marginHorizontal: Space.sm,
    marginBottom: -Space.sm,
    borderTopLeftRadius: Radius.md,
    borderTopRightRadius: Radius.md,
  },
});

/**
 * As FORMAS DE TELA — o degrau acima de `Skeleton` e `SkeletonRow`.
 *
 * §7 do design pede *"skeleton com a forma do conteúdo final"*, e a forma do conteúdo final de
 * uma tela não é um bloco: é um herói, uma lista, um gráfico. Sem estas composições cada tela
 * inventava a própria (a Hoje e o Financeiro tinham duas versões diferentes do mesmo herói) e
 * nove blocos não tinham nenhuma — eles simplesmente apareciam, com salto de layout.
 *
 * ⚠️ **A régua é PESO, não fidelidade.** O skeleton existe para a tela não pular quando o dado
 * chega; copiar o conteúdo peça por peça só aumenta o custo do quadro que roda enquanto o
 * aparelho está ocupado buscando dados.
 */

/** Painel de destaque: rótulo, número grande, barra e a faixa do rodapé. */
export function SkeletonHero() {
  const theme = useTheme();
  return (
    <View style={[styles.hero, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      <Skeleton width="45%" height={13} />
      <Skeleton width="62%" height={38} />
      <Skeleton width="80%" height={13} />
      <Skeleton width="100%" height={6} radius={Radius.xs} />
    </View>
  );
}

/** Lista dentro de um card: título de seção + N linhas. */
export function SkeletonList({ linhas = 3 }: { linhas?: number }) {
  const theme = useTheme();
  return (
    <View style={styles.bloco}>
      <Skeleton width="34%" height={12} />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
        {Array.from({ length: linhas }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </View>
    </View>
  );
}

/** Gráfico: título, a área do desenho e a legenda. */
export function SkeletonChart({ altura = 140 }: { altura?: number }) {
  const theme = useTheme();
  return (
    <View style={styles.bloco}>
      <Skeleton width="40%" height={12} />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
        <Skeleton width="100%" height={altura} radius={Radius.sm} />
        <Skeleton width="55%" height={12} />
      </View>
    </View>
  );
}

/** A pilha da carteira: um cartão inteiro, com os de trás espiando por cima. */
export function SkeletonCards() {
  const theme = useTheme();
  return (
    <View style={styles.bloco}>
      <Skeleton width="28%" height={12} />
      <View style={styles.pilha}>
        {/* Os de trás aparecem ACIMA e mais estreitos — é como a carteira de verdade empilha. */}
        <View style={[styles.atras, { backgroundColor: theme.backgroundElement }]} />
        <Skeleton width="100%" height={132} radius={Radius.md} />
      </View>
    </View>
  );
}
