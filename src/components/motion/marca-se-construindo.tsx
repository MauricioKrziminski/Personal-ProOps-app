import { Path } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { SkiaCanvas } from '@/components/ui/skia-canvas';
import { markPath } from '@/design/mark-path';
import { Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/** Lado da marca (dp): a mesma caixa que o PNG do splash tinha, para ela ficar no mesmo lugar. */
const LADO = 96;
/**
 * A marca se constrói (traço + preenchimento + nome) em 1,5 s, dentro de `MARCA_MINIMA_MS` (1700).
 * Era 800 ms; o dono do produto pediu "mais suave, devagar, fluido" (06/10/2026).
 */
export const CONSTRUCAO_MS = 1500;

/** Smootherstep: começa e termina com velocidade E aceleração zero — sem tranco nas emendas. */
const suave = (x: number) => {
  'worklet';
  const k = Math.min(1, Math.max(0, x));
  return k * k * k * (k * (k * 6 - 15) + 10);
};

/**
 * A marca SE CONSTRUINDO, no centro da tinta — na abertura (`session-curtain.tsx`) e depois da
 * senha (`lock-overlay.tsx`): o contorno da marca se desenha (trim do path, o
 * mesmo `markPath` do app), o preenchimento entra por baixo dele e o nome "ProOps" aparece
 * abaixo. É o que o splash nativo deixa de fazer — ele é só a tinta, então o primeiro quadro desta
 * camada (nada além da tinta) é idêntico ao dele e não há flash. Na saída a marca sobe e some com
 * a tinta.
 *
 * Um relógio só (`t`, 0 → 1 em `CONSTRUCAO_MS`, dentro do mínimo da marca): depois dele a marca
 * fica desenhada e PARADA, qualquer que seja a espera (rede, senha). Sem loop.
 *
 * Reduzir movimento: sem desenho progressivo, marca e nome entram por fade.
 */
export function MarcaSeConstruindo({
  saida,
  t,
  reduzido,
}: {
  /** 0 → 1 enquanto a tinta sobe: a marca sobe e some no primeiro terço. */
  saida: SharedValue<number>;
  t: SharedValue<number>;
  reduzido: boolean;
}) {
  const theme = useTheme();
  const caminho = useMemo(() => markPath(LADO), []);

  // Traço 0 → 60%; o preenchimento entra de 40% a 85% e leva o contorno embora (55% → 90%);
  // o nome fecha de 65% a 100%. As etapas se sobrepõem para a construção não ter degraus.
  const fim = useDerivedValue(() => suave(t.get() / 0.6));
  const contorno = useDerivedValue(() => (reduzido ? 0 : 1 - suave((t.get() - 0.55) / 0.35)));
  // Reduzido: o canvas fica estático (opacidade 1) e o fade é da View por fora — um valor que muda
  // antes do primeiro quadro do Skia não repinta, e a marca não aparecia.
  const miolo = useDerivedValue(() => (reduzido ? 1 : suave((t.get() - 0.4) / 0.45)));
  const marcaStyle = useAnimatedStyle(() => ({
    opacity: reduzido ? t.get() : 1,
  }));
  const nome = useDerivedValue(() => (reduzido ? t.get() : suave((t.get() - 0.65) / 0.35)));
  const nomeStyle = useAnimatedStyle(() => ({
    opacity: nome.get(),
    transform: [{ translateY: (1 - nome.get()) * 8 }],
  }));

  const sai = useAnimatedStyle(() => {
    const k = Math.min(1, saida.get() / 0.35);
    return {
      opacity: 1 - k,
      transform: [{ translateY: -k * 36 }, { scale: 1 - k * 0.06 }],
    };
  });

  return (
    <Animated.View style={[styles.palco, sai]} pointerEvents="none">
      <Animated.View style={[styles.marca, marcaStyle]}>
        <SkiaCanvas style={styles.marca}>
          <Path path={caminho} color={theme.onCurtain} opacity={miolo} />
          <Path
            path={caminho}
            style="stroke"
            strokeWidth={2}
            strokeJoin="round"
            color={theme.onCurtain}
            start={0}
            end={fim}
            opacity={contorno}
          />
        </SkiaCanvas>
      </Animated.View>
      <Animated.View style={[styles.nome, nomeStyle]}>
        <ThemedText type="title" themeColor="onCurtain">
          ProOps
        </ThemedText>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // A marca fica no centro; o nome pende ABAIXO dela sem deslocá-la.
  palco: { width: LADO, height: LADO },
  marca: { width: LADO, height: LADO },
  nome: {
    position: 'absolute',
    top: LADO + Space.md,
    left: -80,
    right: -80,
    alignItems: 'center',
  },
});
