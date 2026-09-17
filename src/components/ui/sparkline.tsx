import { useEffect, useMemo, useRef } from 'react';
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
} from 'react-native-reanimated';
import {
  Circle,
  DashPathEffect,
  Group,
  Line,
  LinearGradient,
  Path,
  Skia,
  vec,
  type SkPathBuilder,
} from '@shopify/react-native-skia';

import { SkiaCanvas } from '@/components/ui/skia-canvas';
import { type ThemeColor } from '@/constants/theme';
import { alpha } from '@/design/card-brands';
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
   * O trecho passado sai mais fraco e o futuro fica cheio — uma cor, duas intensidades. Sem essa
   * separação a projeção e o histórico virariam a mesma linha, e o gráfico passaria a afirmar
   * sobre o futuro com a confiança de um extrato. `0` (padrão) desenha a série inteira cheia.
   */
  pastCount?: number;
  /** O gráfico mora DENTRO do herói, que é escuro nos dois temas: as cores saem de `onHero*`. */
  onHero?: boolean;
}

/** Metade do traço + folga, para a linha e o marcador não serem cortados. */
const PAD = 6;
/**
 * Span mínimo, como fração da magnitude da série. Sem ele, uma série que oscila R$ 2 vira uma
 * onda dramática — o gráfico desenharia ruído de arredondamento como se fosse notícia.
 */
const MIN_SPAN_RATIO = 0.05;
/** Quanto a linha leva para se desenhar. */
const DESENHO_MS = 900;
/** Raio do marcador de "hoje". */
const R = 4;

type Ponto = { x: number; y: number };

/**
 * Curva suave pelos pontos (Catmull-Rom convertida em Bézier), com os pontos de controle presos
 * entre os dois vizinhos: a curva nunca passa do valor real — um gráfico de dinheiro não pode
 * inventar um pico que não existe.
 */
function curva(b: SkPathBuilder, pts: Ponto[], inicio: boolean) {
  if (inicio) b.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const lo = Math.min(p1.y, p2.y);
    const hi = Math.max(p1.y, p2.y);
    const c1y = Math.min(hi, Math.max(lo, p1.y + (p2.y - p0.y) / 6));
    const c2y = Math.min(hi, Math.max(lo, p2.y - (p3.y - p1.y) / 6));
    b.cubicTo(p1.x + (p2.x - p0.x) / 6, c1y, p2.x - (p3.x - p1.x) / 6, c2y, p2.x, p2.y);
  }
}

/**
 * Linha de tendência: curva suave, área em degradê leve e um ponto em "hoje".
 *
 * O domínio vertical sai dos DADOS, não de zero. Forçar zero no domínio esmagava uma série de
 * R$ 2.500–2.800 em 6px: a linha lia como divisor, não como gráfico. Zero volta ao domínio sozinho
 * quando a série fica negativa — que é quando ele informa alguma coisa.
 *
 * A cor segue o sinal do último ponto: verde acima de zero, vermelho abaixo — a leitura de meio
 * segundo ("vou ficar no vermelho?").
 *
 * ## O movimento
 *
 * A linha se DESENHA (o `end` do caminho vai de 0 a 1): o passado primeiro, o futuro depois; a
 * área acende quando já há forma, e o ponto de hoje aparece no fim com um pulso único. Só
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
    const span = Math.max(dataMax - dataMin, Math.abs(dataMax) * MIN_SPAN_RATIO, 1);
    const mid = (dataMin + dataMax) / 2;
    const lo = mid - span / 2;
    const hi = mid + span / 2;

    const plot = height - PAD * 2;
    const y = (v: number) => PAD + ((hi - v) / (hi - lo)) * plot;
    const larguraUtil = width - PAD * 2;
    const step = larguraUtil / (values.length - 1);
    const pts = values.map((v, i) => ({ x: PAD + i * step, y: y(v) }));

    // Índice do "hoje": último ponto do passado e PRIMEIRO do futuro ao mesmo tempo, senão a
    // emenda ficaria com um buraco de um passo.
    const corte = Math.min(Math.max(pastCount, 0), values.length);
    const temPassado = corte >= 2 && corte < values.length;
    const inicioFuturo = temPassado ? corte - 1 : 0;

    const futuro = Skia.PathBuilder.Make();
    curva(futuro, pts.slice(inicioFuturo), true);

    let passado = null;
    if (temPassado) {
      const b = Skia.PathBuilder.Make();
      curva(b, pts.slice(0, corte), true);
      passado = b.detach();
    }

    // A área embaixo da curva inteira: é ela que dá corpo ao gráfico.
    const area = Skia.PathBuilder.Make();
    area.moveTo(pts[0].x, height);
    area.lineTo(pts[0].x, pts[0].y);
    curva(area, pts, false);
    area.lineTo(pts[pts.length - 1].x, height);
    area.close();

    const pino = temPassado ? pts[inicioFuturo] : pts[pts.length - 1];
    return {
      // Sem variação nenhuma, a área vira um retângulo cheio que finge ter forma.
      plano: dataMax === dataMin,
      temPassado,
      futuro: futuro.detach(),
      passado,
      area: area.detach(),
      zeroY: y(0),
      zeroVisivel: lo <= 0 && hi >= 0,
      negativo: values[values.length - 1] < 0,
      pino,
    };
  }, [values, width, height, pastCount]);

  /** A série redesenha quando MUDA — um array novo com os mesmos números não é mudança. */
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
        if (fim) anel.set(withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }));
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
  const raioAnel = useDerivedValue(() => R + anel.value * 10);
  const opacidadeAnel = useDerivedValue(() =>
    anel.value > 0 && anel.value < 1 ? (1 - anel.value) * 0.5 : 0
  );

  if (!geo) return <View style={{ width, height }} />;

  const cor = geo.negativo
    ? theme[onHero ? 'onHeroDanger' : 'danger']
    : theme[onHero ? 'onHeroSuccess' : 'success'];
  const corPassado = theme[onHero ? 'onHeroMuted' : 'textSecondary'];
  const corMiolo = theme[onHero ? 'heroSurface' : 'surface'];
  const corZero = theme[onHero ? 'heroSeparator' : 'separator'];
  const { x: px, y: py } = geo.pino;

  return (
    <SkiaCanvas style={{ width, height }}>
      {geo.plano ? null : (
        <Group opacity={opacidadeArea}>
          <Path path={geo.area}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(0, height)}
              colors={[alpha(cor, 0.22), alpha(cor, 0)]}
            />
          </Path>
        </Group>
      )}
      {showZero && geo.zeroVisivel ? (
        <Line p1={vec(0, geo.zeroY)} p2={vec(width, geo.zeroY)} color={corZero} strokeWidth={1} style="stroke">
          <DashPathEffect intervals={[2, 4]} />
        </Line>
      ) : null}
      {/* Histórico: mesma forma, sem cor. O futuro é o que a tela afirma; o passado é contexto. */}
      {geo.passado ? (
        <Path
          path={geo.passado}
          color={corPassado}
          style="stroke"
          strokeWidth={2}
          strokeCap="round"
          strokeJoin="round"
          end={fimPassado}
        />
      ) : null}
      {/* O futuro, na cor do sinal; com passado marcado, tracejado — é projeção. */}
      <Path
        path={geo.futuro}
        color={cor}
        style="stroke"
        strokeWidth={2.5}
        strokeCap="round"
        strokeJoin="round"
        end={fimFuturo}>
        {geo.temPassado ? <DashPathEffect intervals={[5, 5]} /> : null}
      </Path>
      {/* "Hoje": um ponto com miolo, e um anel que pulsa uma vez. */}
      <Circle cx={px} cy={py} r={raioAnel} color={cor} style="stroke" strokeWidth={1.5} opacity={opacidadeAnel} />
      <Group opacity={opacidadePino}>
        <Circle cx={px} cy={py} r={R} color={cor} />
        <Circle cx={px} cy={py} r={R - 2} color={corMiolo} />
      </Group>
    </SkiaCanvas>
  );
}

/**
 * Barra de progresso: um trilho em pílula que enche da esquerda.
 *
 * Anima com `scaleX` (não com `width`) para o movimento ficar no worklet e não disparar layout —
 * e anima: valor que salta é bug visual. O trilho recorta o preenchimento, então a ponta
 * arredondada acompanha sem distorcer quando a barra está cheia; no meio do caminho a ponta é o
 * corte reto do recorte, que é como os apps de referência desenham.
 *
 * `tone` separa duas coisas que não são a mesma informação:
 *
 * - **`tint`** é *estado* — quanto do orçamento já foi, quanto falta para a meta. `warning` e
 *   `danger` sobrescrevem quando o número passa do limite.
 * - **`data`** é *comparação* — "casa foi 44% do mês". Dado não grita; estado pode.
 */
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
  tone?: 'data' | 'strong' | ThemeColor;
  /** A cor da PISTA. Dentro do herói ela é `heroChip` — com a cor normal ela sumiria no bloco. */
  track?: ThemeColor;
}) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  /*
    ⚠️ **Nasce no valor verdadeiro; anima só quando ele MUDA** (a regra do `CountUpMoney`).
    Crescer de zero na montagem dependia de a mola rodar: no Android, abrindo uma tela logo
    depois de o app voltar ao primeiro plano, a mola ficou parada em zero e a barra do cartão
    ficou VAZIA por dezenas de segundos (medido em 17/09/2026) — um limite usado de 0% que não
    existe. A entrada da tela já é da cascata; a barra não precisa contar a própria chegada.
  */
  const progresso = useSharedValue(pct);
  const anterior = useRef(pct);

  useEffect(() => {
    if (anterior.current === pct) return;
    anterior.current = pct;
    progresso.set(reduzido ? pct : withSpring(pct, Motion.spring.encaixe));
  }, [pct, progresso, reduzido]);

  const cor =
    tone === 'data' ? theme.textSecondary : tone === 'strong' ? theme.text : theme[tone as ThemeColor];

  const cheio = useAnimatedStyle(() => ({ transform: [{ scaleX: progresso.get() }] }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{
        height: 6,
        borderRadius: Radius.pill,
        overflow: 'hidden',
        backgroundColor: theme[track],
      }}>
      <Animated.View
        style={[
          {
            width: '100%',
            height: '100%',
            borderRadius: Radius.pill,
            backgroundColor: cor,
            transformOrigin: 'left',
          },
          cheio,
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
