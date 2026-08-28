import { useMemo } from 'react';
import { View } from 'react-native';
import { Canvas, Line, Path, Skia, vec } from '@shopify/react-native-skia';

import { Radius } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface SparklineProps {
  /** Série na ordem cronológica. Em centavos, como todo dinheiro do app. */
  values: number[];
  width: number;
  height?: number;
  /** Desenha a linha do zero — essencial quando a projeção fica negativa. */
  showZero?: boolean;
}

/**
 * Linha de tendência.
 *
 * Primeiro uso real de `@shopify/react-native-skia`, que estava no `package.json` sem um único
 * import. Substitui as barras de `View` com `width` em `%` que mudavam de valor sem transição.
 *
 * A cor segue o sinal do último ponto: verde acima de zero, `danger` abaixo. É a leitura que a
 * pessoa faz em meio segundo — "vou ficar no vermelho?".
 */
export function Sparkline({ values, width, height = 56, showZero = false }: SparklineProps) {
  const theme = useTheme();

  const { path, zeroY, negative } = useMemo(() => {
    if (values.length < 2 || width <= 0) {
      return { path: null, zeroY: 0, negative: false };
    }

    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    // Série constante não pode virar divisão por zero — vira uma linha no meio.
    const span = max - min || 1;
    const y = (v: number) => height - ((v - min) / span) * height;
    const step = width / (values.length - 1);

    // `Skia.Path.Make()` + `moveTo/lineTo` está depreciado no Skia 2.6 e some numa versão futura.
    const builder = Skia.PathBuilder.Make();
    builder.moveTo(0, y(values[0]));
    for (let i = 1; i < values.length; i++) builder.lineTo(i * step, y(values[i]));

    return { path: builder.detach(), zeroY: y(0), negative: values[values.length - 1] < 0 };
  }, [values, width, height]);

  if (!path) return <View style={{ width, height }} />;

  return (
    <Canvas style={{ width, height }}>
      {showZero ? (
        <Line
          p1={vec(0, zeroY)}
          p2={vec(width, zeroY)}
          color={theme.separator}
          strokeWidth={1}
          style="stroke"
        />
      ) : null}
      <Path
        path={path}
        color={negative ? theme.danger : theme.success}
        style="stroke"
        strokeWidth={2}
        strokeCap="round"
        strokeJoin="round"
      />
    </Canvas>
  );
}

/** Barra de progresso — usa a mesma escala de raio do resto do app. */
export function ProgressBar({
  value,
  max,
  tone = 'tint',
}: {
  value: number;
  max: number;
  tone?: 'tint' | 'success' | 'warning' | 'danger';
}) {
  const theme = useTheme();
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{
        height: 6,
        borderRadius: Radius.xs,
        borderCurve: 'continuous',
        backgroundColor: theme.backgroundElement,
        overflow: 'hidden',
      }}>
      <View
        style={{
          width: `${pct * 100}%`,
          height: '100%',
          borderRadius: Radius.xs,
          backgroundColor: theme[tone],
        }}
      />
    </View>
  );
}
