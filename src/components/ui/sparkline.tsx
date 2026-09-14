import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Circle, Line, LinearGradient, Path, Skia, vec } from '@shopify/react-native-skia';

import { SkiaCanvas } from '@/components/ui/skia-canvas';
import { type ThemeColor } from '@/constants/theme';
import { Motion, Radius, Space } from '@/design/tokens';
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

  const { line, past, splitX, area, zeroY, zeroVisible, negative, flat, pinY, endY } = useMemo(() => {
    const empty = {
      line: null,
      past: null,
      splitX: null as number | null,
      area: null,
      zeroY: 0,
      zeroVisible: false,
      negative: false,
      flat: true,
      pinY: 0,
      endY: 0,
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
      // A altura do alfinete tem que sair da MESMA escala da curva: recalcular `y` fora daqui
      // daria um ponto flutuando ao lado da linha assim que o domínio mudasse.
      pinY: y(values[inicioFuturo]),
      endY: y(values[values.length - 1]),
    };
  }, [values, width, height, pastCount]);

  if (!line) return <View style={{ width, height }} />;

  const color = negative ? theme.danger : theme.success;
  /**
   * O ponto de "hoje". Sem passado marcado, é a ponta da série — que é onde o olho já vai.
   *
   * O `x` é preso dentro do canvas pelo raio do disco: na ponta exata o Skia corta o alfinete ao
   * meio, e meia bolinha na borda lê como defeito de render, não como marcador.
   */
  const R = 4.5;
  const pinX = Math.min(Math.max(splitX ?? width, R), width - R);
  const pinY2 = splitX !== null ? pinY : endY;
  /** O degradê do traço começa no alfinete; sem passado marcado ele atravessa o gráfico todo. */
  const gradStart = splitX ?? 0;

  return (
    <SkiaCanvas style={{ width, height }}>
      {/*
        A área é um GRADIENTE, não um preenchimento chapado (`from secondary/0.35 to /0`).
        Chapada com 14% ela lia como uma sombra retangular embaixo da linha; com a queda para
        transparente ela lê como luz saindo da curva — que é o que faz o gráfico do export ter
        volume num card de 48px de altura.
      */}
      {flat ? null : (
        <Path path={area!} style="fill">
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, height)}
            colors={[`${color}59`, `${color}00`]}
          />
        </Path>
      )}
      {showZero && zeroVisible ? (
        <Line
          p1={vec(0, zeroY)}
          p2={vec(width, zeroY)}
          color={theme.separator}
          strokeWidth={1}
          style="stroke"
        />
      ) : null}
      {/* Histórico: mesma forma, sem cor. O futuro é o que a tela afirma; o passado é contexto. */}
      {past ? (
        <Path
          path={past}
          color={theme.textSecondary}
          style="stroke"
          strokeWidth={2.25}
          strokeCap="round"
          strokeJoin="round"
          opacity={0.45}
        />
      ) : null}
      {/*
        O traço do futuro sai do cinza do texto e CHEGA no accent — o `strokeGradient` do export.
        Uma cor só faz a linha inteira afirmar com a mesma confiança; o degradê diz onde a
        projeção está indo.
      */}
      <Path path={line} style="stroke" strokeWidth={2.25} strokeCap="round" strokeJoin="round">
        <LinearGradient start={vec(gradStart, 0)} end={vec(width, 0)} colors={[theme.text, color]} />
      </Path>
      {/* O alfinete do dia de hoje: disco na cor do texto com o miolo vazado na cor do fundo. */}
      <Circle cx={pinX} cy={pinY2} r={R} color={theme.text} />
      <Circle cx={pinX} cy={pinY2} r={1.75} color={theme.heroBottom} />
    </SkiaCanvas>
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
  track = 'backgroundElement',
}: {
  value: number;
  max: number;
  tone?: 'tint' | 'data' | 'success' | 'warning' | 'danger' | 'onHeroSuccess' | 'onHeroDanger' | 'onHeroWarning';
  /**
   * A cor da PISTA (o que fica atrás do preenchimento).
   *
   * ⚠️ Dentro do painel de destaque, que é escuro nos DOIS temas, o padrão
   * (`backgroundElement`) vira uma barra quase branca no tema claro — o mesmo defeito de §2 que
   * entregava "um botão branco sólido com ícone branco dentro". Lá a pista é `heroChip`.
   */
  track?: ThemeColor;
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
        backgroundColor: theme[track],
        overflow: 'hidden',
      }}>
      <Animated.View
        style={[
          {
            width: '100%',
            height: '100%',
            borderRadius: Radius.xs,
            backgroundColor: tone === 'data' ? theme.textSecondary : theme[tone as ThemeColor],
            transformOrigin: 'left',
          },
          animated,
        ]}
      />
    </View>
  );
}

/**
 * Barra vertical que cresce da base — o primitivo das três colunas animadas do app.
 *
 * ## O que ele substitui
 *
 * Três implementações idênticas: a tendência mensal do Financeiro, o histórico de faturas e a
 * linha do tempo de parcelas. As três faziam
 * `withDelay(index * stagger, withSpring(ratio, settle))`, e **as três animavam `height`**.
 *
 * ⚠️ **`height` é LAYOUT a cada quadro.** §5 pede `transform` e `opacity`: são 24 barras na raiz
 * do Financeiro e até 60 em Faturas, todas remedindo a árvore 60× por segundo. Aqui a pista tem
 * altura FIXA e o que anima é `scaleY` com `transformOrigin: 'bottom'` — o mesmo mecanismo que a
 * `ProgressBar` logo acima já usa no eixo X.
 *
 * ⚠️ **O piso vira FRAÇÃO.** Com `height` ele era `Space.xs` em pixels; com `scaleY` é
 * `Space.xs / altura`. E **zero continua desenhando NADA**: um traço mínimo em valor zero lê
 * como "entrou um pouquinho", que é o mesmo defeito de escrever "previsto R$ 0,00".
 *
 * ⚠️ **O filho escala junto, e é isso que mantém a tampa de "previsto" certa:** ela é `flex` da
 * barra, então a altura final continua sendo `previsto/teto × altura`. O que a escala também
 * afina é a BORDA de 1px da tampa — custo aceito, e o motivo de ela se separar do fundo por COR
 * antes de por contorno.
 */
export function BarTrack({
  ratio,
  index = 0,
  height,
  color,
  dim = false,
  children,
}: {
  /** 0..1. Zero desenha nada. */
  ratio: number;
  /** Posição na fileira — governa o atraso do escalonamento. */
  index?: number;
  height: number;
  color: string;
  /** Barra de contexto (mês passado, fatura não selecionada): mesma geometria, menos presença. */
  dim?: boolean;
  children?: React.ReactNode;
}) {
  const grow = useSharedValue(0);
  const fade = useSharedValue(1);
  const reduzido = useReducedMotion();
  const alvo = ratio <= 0 ? 0 : Math.max(Space.xs / height, Math.min(1, ratio));

  useEffect(() => {
    grow.set(
      reduzido
        ? alvo
        : // O `cap` faltava nas três cópias: sem ele, a 24ª barra esperava 720ms para começar.
          withDelay(
            Math.min(index * Motion.stagger.step, Motion.stagger.cap),
            withSpring(alvo, Motion.spring.settle)
          )
    );
  }, [grow, alvo, index, reduzido]);

  useEffect(() => {
    fade.set(withTiming(dim ? 0.45 : 1, { duration: Motion.duration.fast }));
  }, [fade, dim]);

  const animado = useAnimatedStyle(() => ({
    transform: [{ scaleY: grow.get() }],
    opacity: fade.get(),
  }));

  return (
    <Animated.View
      style={[
        {
          width: '100%',
          height,
          backgroundColor: color,
          transformOrigin: 'bottom',
          justifyContent: 'flex-start',
          overflow: 'hidden',
          borderTopLeftRadius: Radius.xs,
          borderTopRightRadius: Radius.xs,
          borderCurve: 'continuous',
        },
        animado,
      ]}>
      {children}
    </Animated.View>
  );
}
