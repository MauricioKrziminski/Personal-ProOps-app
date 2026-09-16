import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { DashPathEffect, Group, Line, Path, Rect, Skia, vec } from '@shopify/react-native-skia';

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
  /**
   * O gráfico mora DENTRO do herói, que é o negativo da página: as cores saem de `onHero*`.
   * Com as cores normais, no escuro a linha verde clara ficava sobre o herói de papel e sumia.
   */
  onHero?: boolean;
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

/** Quanto a linha leva para se desenhar. */
const DESENHO_MS = 900;
/** Espaço entre as linhas da hachura. */
const HACHURA = 5;
/** Meio lado do losango de "hoje". */
const R = 4.5;

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
 *
 * ## O movimento
 *
 * A linha se DESENHA (o `end` do caminho vai de 0 a 1): o passado primeiro, o futuro depois, a
 * hachura entra quando já há forma, e o marcador de hoje aparece no fim com um pulso único. Só
 * redesenha quando a série muda de verdade.
 */
export function Sparkline({
  values,
  width,
  height = 56,
  showZero = false,
  pastCount = 0,
  onHero = false,
}: SparklineProps) {
  const theme = useTheme();
  const reduzido = useReducedMotion();

  const geo = useMemo(() => {
    if (values.length < 2 || width <= 0) return null;

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

    const futuro = Skia.PathBuilder.Make();
    futuro.moveTo(inicioFuturo * step, y(values[inicioFuturo]));
    for (let i = inicioFuturo + 1; i < values.length; i++) futuro.lineTo(i * step, y(values[i]));

    let passado = null;
    if (temPassado) {
      const p = Skia.PathBuilder.Make();
      p.moveTo(0, y(values[0]));
      for (let i = 1; i < corte; i++) p.lineTo(i * step, y(values[i]));
      passado = p.detach();
    }

    // A área embaixo da curva: é ela que dá corpo ao gráfico. Uma linha de 2px sozinha, na
    // largura de um card, lê como régua.
    const area = Skia.PathBuilder.Make();
    area.moveTo(0, height);
    area.lineTo(0, y(values[0]));
    for (let i = 1; i < values.length; i++) area.lineTo(i * step, y(values[i]));
    area.lineTo(width, height);
    area.close();

    // A hachura: diagonais a 45° cobrindo o canvas, recortadas pela área.
    const hachura = Skia.PathBuilder.Make();
    for (let k = -height; k < width; k += HACHURA) {
      hachura.moveTo(k, height);
      hachura.lineTo(k + height, 0);
    }

    const pinoX = temPassado ? (corte - 1) * step : width;
    return {
      // Sem variação nenhuma, a área vira um retângulo cheio que finge ter forma. A linha
      // sozinha diz a verdade: "não mudou".
      plano: dataMax === dataMin,
      temPassado,
      futuro: futuro.detach(),
      passado,
      area: area.detach(),
      hachura: hachura.detach(),
      zeroY: y(0),
      zeroVisivel: lo <= 0 && hi >= 0,
      negativo: values[values.length - 1] < 0,
      // O `x` é preso dentro do canvas: na ponta exata o Skia cortaria o losango ao meio.
      pinoX: Math.min(Math.max(pinoX, R + 1), width - R - 1),
      // A altura do marcador sai da MESMA escala da curva.
      pinoY: temPassado ? y(values[inicioFuturo]) : y(values[values.length - 1]),
    };
  }, [values, width, height, pastCount]);

  /**
   * O traço se desenha de novo quando a SÉRIE muda — não a cada render. A assinatura é o que
   * decide: um array novo com os mesmos números não é mudança nenhuma.
   */
  const assinatura = values.join(',');
  const desenho = useSharedValue(reduzido ? 1 : 0);
  const anel = useSharedValue(0);
  useEffect(() => {
    if (reduzido) {
      desenho.set(1);
      return;
    }
    desenho.set(0);
    anel.set(0);
    desenho.set(
      withTiming(1, { duration: DESENHO_MS, easing: Easing.out(Easing.cubic) }, (fim) => {
        // O pulso único do marcador: "é aqui", uma vez, e para.
        if (fim) anel.set(withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) }));
      })
    );
  }, [assinatura, width, height, reduzido, desenho, anel]);

  const temPassado = geo?.temPassado ?? false;
  const fimPassado = useDerivedValue(() => (temPassado ? Math.min(1, desenho.value * 2) : 1));
  const fimFuturo = useDerivedValue(() =>
    temPassado ? Math.max(0, desenho.value * 2 - 1) : desenho.value
  );
  const opacidadeArea = useDerivedValue(() => Math.max(0, (desenho.value - 0.35) / 0.65));
  const opacidadePino = useDerivedValue(() => Math.max(0, (desenho.value - 0.8) / 0.2));
  const px = geo?.pinoX ?? 0;
  const py = geo?.pinoY ?? 0;
  const anelTransform = useDerivedValue(() => [{ rotate: Math.PI / 4 }, { scale: 1 + anel.value * 1.6 }]);
  const anelOpacidade = useDerivedValue(() => (anel.value > 0 && anel.value < 1 ? (1 - anel.value) * 0.7 : 0));

  if (!geo) return <View style={{ width, height }} />;

  const cor = geo.negativo
    ? theme[onHero ? 'onHeroDanger' : 'danger']
    : theme[onHero ? 'onHeroSuccess' : 'success'];
  const corPassado = theme[onHero ? 'onHeroMuted' : 'textSecondary'];
  const corPino = theme[onHero ? 'onHero' : 'text'];
  const corFuro = theme[onHero ? 'heroSurface' : 'surface'];
  const corZero = theme[onHero ? 'heroSeparator' : 'separator'];
  const losango = { x: px - R, y: py - R, width: R * 2, height: R * 2 };
  const origem = vec(px, py);

  return (
    <SkiaCanvas style={{ width, height }}>
      {/*
        A área é HACHURA, não mancha. O gradiente do desenho anterior lia como luz; no Concreto a
        mesma informação ("isto é volume") vem de linhas finas, como gravura — e continua
        chapada. Entra depois da linha, quando já há forma para preencher.
      */}
      {geo.plano ? null : (
        <Group clip={geo.area} opacity={opacidadeArea}>
          <Path path={geo.hachura} color={cor} style="stroke" strokeWidth={1} opacity={0.4} />
        </Group>
      )}
      {showZero && geo.zeroVisivel ? (
        <Line p1={vec(0, geo.zeroY)} p2={vec(width, geo.zeroY)} color={corZero} strokeWidth={1} style="stroke">
          <DashPathEffect intervals={[2, 3]} />
        </Line>
      ) : null}
      {/* Histórico: mesma forma, sem cor. O futuro é o que a tela afirma; o passado é contexto. */}
      {geo.passado ? (
        <Path
          path={geo.passado}
          color={corPassado}
          style="stroke"
          strokeWidth={2}
          strokeCap="square"
          strokeJoin="miter"
          end={fimPassado}
        />
      ) : null}
      {/*
        O futuro, na cor do sinal. Com passado marcado ele é TRACEJADO: é projeção, e o traço
        cheio fica para o que já aconteceu — a diferença que o dono do produto pediu que o gráfico
        explicasse.
      */}
      <Path
        path={geo.futuro}
        color={cor}
        style="stroke"
        strokeWidth={2.25}
        strokeCap="square"
        strokeJoin="miter"
        end={fimFuturo}>
        {geo.temPassado ? <DashPathEffect intervals={[6, 4]} /> : null}
      </Path>
      {/* "Hoje": um losango — o azulejo girado —, com o miolo vazado e um pulso único. */}
      <Group transform={anelTransform} origin={origem} opacity={anelOpacidade}>
        <Rect {...losango} color={cor} style="stroke" strokeWidth={1.5} />
      </Group>
      <Group transform={[{ rotate: Math.PI / 4 }]} origin={origem} opacity={opacidadePino}>
        <Rect {...losango} color={corPino} />
        <Rect x={px - 1.6} y={py - 1.6} width={3.2} height={3.2} color={corFuro} />
      </Group>
    </SkiaCanvas>
  );
}

/**
 * Barra de progresso, em AZULEJOS.
 *
 * Dez peças com uma junta entre elas, que enchem em sequência: a proporção continua lida de uma
 * vez (a junta é fina), e o enchimento ganha o ritmo do grid do Concreto em vez de um traço
 * deslizando. Um valor compartilhado só governa as dez peças — cada uma lê a sua fatia dele.
 *
 * Anima com `scaleX` (não com `width`) para o movimento ficar no worklet e não disparar layout —
 * e anima: valor que salta é bug visual.
 *
 * `tone` separa duas coisas que ANTES eram a mesma cor e não são a mesma informação:
 *
 * - **`tint`** é *estado* — quanto do orçamento já foi, quanto falta para a meta. Merece o
 *   accent, e `warning`/`danger` sobrescrevem quando o número passa do limite.
 * - **`data`** é *comparação* — "casa foi 44% do mês". Não há nada a fazer a respeito, é só a
 *   forma de ler a proporção. Dado não grita; estado pode.
 */
const PECAS = 10;

export function ProgressBar({
  value,
  max,
  tone = 'tint',
  track = 'backgroundElement',
}: {
  value: number;
  max: number;
  /**
   * `data` é comparação (cinza), `tint` é estado que o usuário resolve (orçamento, meta).
   *
   * ⚠️ **`strong` é comparação que precisa de DOIS pesos.** Em "entrou × saiu" as duas barras
   * comparam, então nenhuma delas é `tint` — quem separa as duas é a CLARIDADE.
   */
  tone?:
    | 'tint'
    | 'data'
    | 'strong'
    | 'success'
    | 'warning'
    | 'danger'
    | 'onHeroSuccess'
    | 'onHeroDanger'
    | 'onHeroWarning';
  /**
   * A cor da PISTA (o que fica atrás do preenchimento). Dentro do herói, que é o negativo da
   * página, a pista é `heroChip` — com a cor normal ela sumiria no bloco.
   */
  track?: ThemeColor;
}) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const progresso = useSharedValue(reduzido ? pct : 0);

  useEffect(() => {
    progresso.set(reduzido ? pct : withSpring(pct, Motion.spring.encaixe));
  }, [pct, progresso, reduzido]);

  const cor =
    tone === 'data' ? theme.textSecondary : tone === 'strong' ? theme.text : theme[tone as ThemeColor];
  const pista = theme[track];

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{ height: 6, flexDirection: 'row', gap: 2 }}>
      {Array.from({ length: PECAS }, (_, i) => (
        <Peca key={i} indice={i} progresso={progresso} cor={cor} pista={pista} />
      ))}
    </View>
  );
}

function Peca({
  indice,
  progresso,
  cor,
  pista,
}: {
  indice: number;
  progresso: SharedValue<number>;
  cor: string;
  pista: string;
}) {
  const cheio = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.min(1, Math.max(0, progresso.get() * PECAS - indice)) }],
  }));
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: pista,
        borderRadius: Radius.xs / 2,
        overflow: 'hidden',
      }}>
      <Animated.View
        style={[{ width: '100%', height: '100%', backgroundColor: cor, transformOrigin: 'left' }, cheio]}
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
