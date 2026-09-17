import { useEffect, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Group, Path, Skia, rect, type SkPath } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { SkiaCanvas } from '@/components/ui/skia-canvas';
import type { ThemeColor } from '@/constants/theme';
import { fatiaNoPonto, type Fatia } from '@/design/donut-math';
import { Motion } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

export const TONS_DA_ROSCA: readonly ThemeColor[] = ['chart1', 'chart2', 'chart3', 'chart4', 'chart5', 'chart6'];

/**
 * A rosca tonal: parte-do-todo em escala de tinta (a cor semântica fica livre para dizer
 * estado). Nasce desenhada inteira — sem varredura de entrada, a lição da barra que ficou vazia
 * no Android. Tocar numa fatia seleciona (as outras recuam); tocar no furo limpa.
 */
export function DonutChart({
  fatias,
  size = 168,
  espessura = 22,
  selecionada,
  onSelect,
  children,
}: {
  fatias: readonly Fatia[];
  size?: number;
  espessura?: number;
  selecionada: number;
  onSelect: (i: number) => void;
  children?: ReactNode;
}) {
  const oval = useMemo(() => rect(espessura / 2 + 3, espessura / 2 + 3, size - espessura - 6, size - espessura - 6), [size, espessura]);
  const arcos = useMemo(
    () =>
      fatias.map((f) => {
        const b = Skia.PathBuilder.Make();
        b.addArc(oval, -90 + f.inicio * 360, Math.max(0.5, (f.fim - f.inicio) * 360));
        return b.detach();
      }),
    [fatias, oval]
  );

  const raio = (size - 6) / 2 - espessura / 2;
  const toque = useMemo(
    () =>
      Gesture.Tap().onEnd((e) => {
        const i = fatiaNoPonto(e.x, e.y, size / 2, raio - espessura / 2 - 6, raio + espessura / 2 + 6, fatias);
        runOnJS(onSelect)(i);
      }),
    [fatias, size, raio, espessura, onSelect]
  );

  return (
    <GestureDetector gesture={toque}>
      <View style={{ width: size, height: size }}>
        <SkiaCanvas style={StyleSheet.absoluteFill}>
          {arcos.map((arco, i) => (
            <ArcoDaFatia
              key={fatias[i].chave}
              arco={arco}
              tom={TONS_DA_ROSCA[fatias[i].tom]}
              espessura={espessura}
              estado={selecionada < 0 ? 'neutro' : selecionada === i ? 'ativo' : 'recuado'}
            />
          ))}
        </SkiaCanvas>
        <View pointerEvents="none" style={styles.centro}>
          {children}
        </View>
      </View>
    </GestureDetector>
  );
}

function ArcoDaFatia({
  arco,
  tom,
  espessura,
  estado,
}: {
  arco: SkPath;
  tom: ThemeColor;
  espessura: number;
  estado: 'neutro' | 'ativo' | 'recuado';
}) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const opacidade = useSharedValue(1);
  const largura = useSharedValue(espessura);

  useEffect(() => {
    const o = estado === 'recuado' ? 0.28 : 1;
    const l = estado === 'ativo' ? espessura + 6 : espessura;
    opacidade.set(reduzido ? o : withTiming(o, { duration: Motion.duration.base, easing: Motion.easing.out }));
    largura.set(reduzido ? l : withTiming(l, { duration: Motion.duration.base, easing: Motion.easing.out }));
  }, [estado, espessura, reduzido, opacidade, largura]);

  return (
    <Group opacity={opacidade}>
      <Path path={arco} color={theme[tom]} style="stroke" strokeWidth={largura} strokeCap="butt" />
    </Group>
  );
}

const styles = StyleSheet.create({
  centro: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 2 },
});
