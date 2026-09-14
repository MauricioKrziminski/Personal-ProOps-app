import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import Animated, {
  useAnimatedStyle,
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
}

/**
 * Bloco de carregamento.
 *
 * Skeleton só existe se tiver **a forma do conteúdo final** — spinner de tela cheia para
 * atualização parcial é reprovação na regra de design §7. Componha vários para desenhar a tela.
 */
export function Skeleton({ width = '100%', height = 16, radius = Radius.xs }: SkeletonProps) {
  const theme = useTheme();
  const pulse = useSharedValue(0.4);

  useEffect(() => {
    pulse.set(withRepeat(withTiming(0.9, { duration: 700 }), -1, true));
  }, [pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        animated,
        {
          width,
          height,
          borderRadius: radius,
          borderCurve: 'continuous',
          backgroundColor: theme.backgroundElement,
        },
      ]}
    />
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
    borderWidth: StyleSheet.hairlineWidth,
  },
  /** Título de seção + corpo — o `gap` de dentro de um bloco (`Space.sm`), como no `Screen`. */
  bloco: { gap: Space.sm },
  card: {
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
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
