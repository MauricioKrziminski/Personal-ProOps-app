import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Canvas, Line, Path, Skia, vec } from '@shopify/react-native-skia';

import { Motion, Radius } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface SparklineProps {
  /** Série na ordem cronológica. Em centavos, como todo dinheiro do app. */
  values: number[];
  width: number;
  height?: number;
  /** Desenha a linha do zero — essencial quando a projeção fica negativa. */
  showZero?: boolean;
  /**
   * Quantos valores do INÍCIO da série já aconteceram.
   *
   * O trecho passado sai mais fraco e o futuro fica cheio — uma cor, duas intensidades, a mesma
   * convenção das barras. Sem essa separação a projeção e o histórico virariam a mesma linha, e
   * o gráfico passaria a afirmar sobre o futuro com a confiança de um extrato.
   *
   * `0` (padrão) desenha exatamente o que desenhava antes.
   */
  pastCount?: number;
}

/** Metade do traço + folga, para a linha não ser cortada no topo e no fundo do canvas. */
const PAD = 3;
/**
 * Span mínimo, como fração da magnitude da série.
 *
 * Sem ele, uma série que oscila R$ 2 vira uma onda dramática de 56px — o gráfico passa a
 * desenhar ruído de arredondamento como se fosse notícia.
 */
const MIN_SPAN_RATIO = 0.05;

/**
 * Linha de tendência.
 *
 * O domínio vertical sai dos DADOS, não de zero. Forçar zero dentro do domínio (como antes)
 * esmagava uma série de R$ 2.500–2.800 em 6px de 56: a linha lia como divisor, não como gráfico.
 * Zero volta ao domínio sozinho quando a série realmente fica negativa — que é exatamente quando
 * ele informa alguma coisa.
 *
 * A cor segue o sinal do último ponto: verde acima de zero, `danger` abaixo. É a leitura que a
 * pessoa faz em meio segundo — "vou ficar no vermelho?".
 */
export function Sparkline({
  values,
  width,
  height = 56,
  showZero = false,
  pastCount = 0,
}: SparklineProps) {
  const theme = useTheme();

  const { line, past, splitX, area, zeroY, zeroVisible, negative, flat } = useMemo(() => {
    const empty = {
      line: null,
      past: null,
      splitX: null as number | null,
      area: null,
      zeroY: 0,
      zeroVisible: false,
      negative: false,
      flat: true,
    };
    if (values.length < 2 || width <= 0) return empty;

    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    // Série constante não pode virar divisão por zero, nem ruído virar onda.
    const span = Math.max(dataMax - dataMin, Math.abs(dataMax) * MIN_SPAN_RATIO, 1);
    const mid = (dataMin + dataMax) / 2;
    const lo = mid - span / 2;
    const hi = mid + span / 2;

    const plot = height - PAD * 2;
    const y = (v: number) => PAD + ((hi - v) / (hi - lo)) * plot;
    const step = width / (values.length - 1);

    // Índice do "hoje": último ponto do passado e PRIMEIRO do futuro ao mesmo tempo. Os dois
    // traços compartilham esse ponto, senão a emenda ficaria com um buraco de um passo.
    const corte = Math.min(Math.max(pastCount, 0), values.length);
    const temPassado = corte >= 2 && corte < values.length;
    const inicioFuturo = temPassado ? corte - 1 : 0;

    // `Skia.Path.Make()` + `moveTo/lineTo` está depreciado no Skia 2.6 e some numa versão futura.
    // O traço cheio começa no HOJE: desenhar a série inteira e repintar o passado por cima só
    // deixaria o passado mais escuro, nunca mais fraco.
    const stroke = Skia.PathBuilder.Make();
    stroke.moveTo(inicioFuturo * step, y(values[inicioFuturo]));
    for (let i = inicioFuturo + 1; i < values.length; i++) stroke.lineTo(i * step, y(values[i]));

    let passado = null;
    if (temPassado) {
      const p = Skia.PathBuilder.Make();
      p.moveTo(0, y(values[0]));
      for (let i = 1; i < corte; i++) p.lineTo(i * step, y(values[i]));
      passado = p.detach();
    }

    // Área preenchida: é ela que dá corpo ao gráfico. Uma linha de 2px sozinha, na largura de um
    // card, lê como régua.
    const fill = Skia.PathBuilder.Make();
    fill.moveTo(0, height);
    fill.lineTo(0, y(values[0]));
    for (let i = 1; i < values.length; i++) fill.lineTo(i * step, y(values[i]));
    fill.lineTo(width, height);
    fill.close();

    return {
      // Sem variação nenhuma, a área vira um retângulo cheio que finge ter forma. A linha sozinha
      // diz a verdade: "não mudou".
      flat: dataMax === dataMin,
      line: stroke.detach(),
      past: passado,
      splitX: temPassado ? (corte - 1) * step : null,
      area: fill.detach(),
      zeroY: y(0),
      zeroVisible: lo <= 0 && hi >= 0,
      negative: values[values.length - 1] < 0,
    };
  }, [values, width, height, pastCount]);

  if (!line) return <View style={{ width, height }} />;

  const color = negative ? theme.danger : theme.success;

  return (
    <Canvas style={{ width, height }}>
      {flat ? null : <Path path={area!} color={color} style="fill" opacity={0.14} />}
      {showZero && zeroVisible ? (
        <Line
          p1={vec(0, zeroY)}
          p2={vec(width, zeroY)}
          color={theme.separator}
          strokeWidth={1}
          style="stroke"
        />
      ) : null}
      <Path
        path={line}
        color={color}
        style="stroke"
        strokeWidth={2}
        strokeCap="round"
        strokeJoin="round"
      />
      {/* Histórico: mesma cor, mais fraco. O futuro é o que a tela afirma; o passado é contexto. */}
      {past ? (
        <Path
          path={past}
          color={color}
          style="stroke"
          strokeWidth={2}
          strokeCap="round"
          strokeJoin="round"
          opacity={0.35}
        />
      ) : null}
      {splitX !== null ? (
        <Line
          p1={vec(splitX, 0)}
          p2={vec(splitX, height)}
          color={theme.separator}
          strokeWidth={1}
          style="stroke"
        />
      ) : null}
    </Canvas>
  );
}

/**
 * Barra de progresso.
 *
 * Anima com `scaleX` (não com `width`) para o movimento ficar no worklet e não disparar layout —
 * regra de movimento §5, que também é a que exige a animação: valor que salta é bug visual.
 */
/**
 * Barra de progresso.
 *
 * `tone` separa duas coisas que ANTES eram a mesma cor e não são a mesma informação:
 *
 * - **`tint`** é *estado* — quanto do orçamento já foi, quanto falta para a meta. Merece o
 *   accent, e `warning`/`danger` sobrescrevem quando o número passa do limite.
 * - **`data`** é *comparação* — "casa foi 44% do mês". Não há nada a fazer a respeito, é só a
 *   forma de ler a proporção.
 *
 * A distinção não existia enquanto o accent era azul: barra de dado em azul claro era discreta.
 * Com o accent monocromático ela virou **preto sólido de ponta a ponta**, e a lista de categorias
 * passou a ler como uma pilha de traços pesados que competia com os próprios valores. Dado não
 * grita; estado pode.
 */
export function ProgressBar({
  value,
  max,
  tone = 'tint',
}: {
  value: number;
  max: number;
  tone?: 'tint' | 'data' | 'success' | 'warning' | 'danger';
}) {
  const theme = useTheme();
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const progress = useSharedValue(pct);

  useEffect(() => {
    progress.set(withTiming(pct, { duration: Motion.duration.slow, easing: Motion.easing.out }));
  }, [pct, progress]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.get() }] }));

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
      <Animated.View
        style={[
          {
            width: '100%',
            height: '100%',
            borderRadius: Radius.xs,
            backgroundColor: tone === 'data' ? theme.textSecondary : theme[tone],
            transformOrigin: 'left',
          },
          animated,
        ]}
      />
    </View>
  );
}
