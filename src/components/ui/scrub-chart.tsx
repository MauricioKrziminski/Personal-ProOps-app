import * as Haptics from 'expo-haptics';
import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { ThemedText } from '@/components/themed-text';
import { Sparkline } from '@/components/ui/sparkline';
import { escalaDaSerie, indiceNoX } from '@/design/sparkline-geometry';
import { usarDica } from '@/hooks/use-dicas';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

const PONTO = 10;

/**
 * A curva do herói que se lê com o dedo: arrastar mostra o dia e o saldo daquele dia, com um
 * toque háptico a cada dia; soltar volta à legenda. Desenhada DENTRO do herói (`onHero*`).
 *
 * O desenho continua sendo o `Sparkline`; aqui mora só o cursor, na MESMA escala
 * (`escalaDaSerie`).
 */
/** Um texto da legenda do `ScrubChart`: não encolhe, a linha é que quebra. */
export function LegendaItem({ children }: { children: ReactNode }) {
  return <View style={styles.legendaItem}>{children}</View>;
}

export function ScrubChart({
  values,
  labels,
  width,
  height = 64,
  legenda,
  formatValue,
}: {
  values: number[];
  labels: string[];
  width: number;
  height?: number;
  legenda: ReactNode;
  formatValue: (v: number) => string;
}) {
  const theme = useTheme();
  const pontos = useMemo(() => {
    const escala = escalaDaSerie(values, width, height);
    return escala ? values.map((v, i) => ({ x: escala.x(i), y: escala.y(v) })) : [];
  }, [values, width, height]);
  const [ativo, setAtivo] = useState(-1);
  const indice = useSharedValue(-1);

  const estiloLinha = useAnimatedStyle(() => {
    const p = indice.get() >= 0 ? pontos[indice.get()] : undefined;
    return { opacity: p ? 1 : 0, transform: [{ translateX: p ? p.x - 1 : 0 }] };
  });
  const estiloPonto = useAnimatedStyle(() => {
    const p = indice.get() >= 0 ? pontos[indice.get()] : undefined;
    return {
      opacity: p ? 1 : 0,
      transform: [{ translateX: p ? p.x - PONTO / 2 : 0 }, { translateY: p ? p.y - PONTO / 2 : 0 }],
    };
  });

  const gesto = useMemo(
    () =>
      Gesture.Pan()
        .enabled(pontos.length > 1)
        .activeOffsetX([-6, 6])
        .failOffsetY([-10, 10])
        // Arrastar na curva é o que a dica do gráfico ensina (`fin-grafico`).
        .onStart(() => {
          scheduleOnRN(usarDica, 'fin-grafico');
        })
        .onUpdate((e) => {
          const i = indiceNoX(e.x, pontos.length, width);
          if (i !== indice.get()) {
            indice.set(i);
            scheduleOnRN(setAtivo, i);
            scheduleOnRN(Haptics.selectionAsync);
          }
        })
        .onFinalize(() => {
          indice.set(-1);
          scheduleOnRN(setAtivo, -1);
        }),
    [pontos, width, indice]
  );

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Saldo projetado por dia"
      accessibilityValue={{ text: ativo >= 0 ? `${labels[ativo]}, ${formatValue(values[ativo])}` : undefined }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) =>
        setAtivo((i) =>
          e.nativeEvent.actionName === 'increment'
            ? Math.min(values.length - 1, i + 1)
            : Math.max(0, (i < 0 ? values.length : i) - 1)
        )
      }
      style={styles.coluna}>
      <View style={styles.legenda}>
        {ativo >= 0 ? (
          <ThemedText type="code" themeColor={values[ativo] < 0 ? 'onHeroDanger' : 'onHero'}>
            {`${labels[ativo]} · ${formatValue(values[ativo])}`}
          </ThemedText>
        ) : (
          legenda
        )}
      </View>
      <GestureDetector gesture={gesto}>
        <View style={{ width, height }}>
          <Sparkline values={values} width={width} height={height} onHero showZero />
          <Animated.View
            pointerEvents="none"
            style={[styles.linha, { height, backgroundColor: theme.heroSeparator }, estiloLinha]}
          />
          <Animated.View
            pointerEvents="none"
            style={[styles.ponto, { backgroundColor: theme.onHero, borderColor: theme.heroSurface }, estiloPonto]}
          />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  coluna: { gap: Space.xs },
  legenda: {
    minHeight: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: Space.sm,
    rowGap: Space.half,
  },
  // Um item da legenda NÃO encolhe: com fonte grande, encolher partia a palavra ("Hoj/e",
  // "10/1/0"). Quem cede é a linha (design.md §3).
  legendaItem: { flexShrink: 0, maxWidth: '100%' },
  linha: { position: 'absolute', left: 0, top: 0, width: 2, borderRadius: Radius.pill },
  ponto: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PONTO,
    height: PONTO,
    borderRadius: Radius.pill,
    borderWidth: 2,
  },
});
