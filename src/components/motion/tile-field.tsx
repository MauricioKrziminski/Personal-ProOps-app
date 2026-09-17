import { useMemo, useState } from 'react';
import {
  PixelRatio,
  StyleSheet,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  Atlas,
  Circle,
  Group,
  Path,
  Rect,
  Skia,
  rect,
  useRSXformBuffer,
  useTexture,
} from '@shopify/react-native-skia';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { SkiaCanvas } from '@/components/ui/skia-canvas';
import { Motion } from '@/design/tokens';
import {
  cornerKeep,
  inkPose,
  motifPose,
  patterned,
  tileGrid,
  tilePhase,
  tilePiece,
  tileTurns,
  waveOrder,
  type WaveMode,
} from '@/design/tile-math';
import { useTheme } from '@/hooks/use-theme';

/** A semente do app inteiro. 1952 é o ano do grupo Noigandres — a Poesia Concreta. */
export const TILE_SEED = 1952;

const PR = PixelRatio.get();
/**
 * Quanto a tinta passa da borda do próprio azulejo, em dp.
 *
 * Azulejos vizinhos se encontram numa aresta de coordenada fracionária, e o antisserrilhado das
 * duas bordas deixa uma fresta de meio pixel onde o fundo aparece — uma grade de linhas finas
 * sobre a tinta. Sobrepor um fio resolve sem mudar o desenho.
 */
const SANGRIA = 0.75;

export interface TileFieldProps {
  /** 0 = tudo coberto, 1 = revelado (o que sobra é o canto). Quem anima é quem chama. */
  progress: SharedValue<number>;
  mode?: WaveMode;
  /** Origem da onda em fração da área (0..1). */
  origin?: { x: number; y: number };
  /**
   * Ordem da onda ao contrário (`waveOrder(..., invert)`). Quem COBRE a partir de um ponto passa
   * `true`; quem revela, `false`. Trocar com o progresso em 0 ou 1 não aparece na tela.
   */
  invert?: boolean;
  /**
   * Degraus do bloco de azulejos que fica no canto superior direito depois de revelar (3 = seis
   * azulejos em escada). 0 limpa tudo.
   */
  corner?: number;
  seed?: number;
  /**
   * Pinta a área inteira de tinta enquanto `progress` é 0 — é o que deixa a abertura sólida
   * desde o primeiro quadro, antes de a textura existir.
   */
  cover?: boolean;
  /** Chamado uma vez, quando a textura está pronta e a onda pode começar. */
  onReady?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Lado do bloco do canto para uma largura de campo: `k` azulejos. */
export function cornerSize(width: number, k: number): number {
  return tileGrid(width, 1).size * k;
}

/** As quatro peças lado a lado, em branco: a cor entra por `colors` com `modulate`. */
function Pecas({ s }: { s: number }) {
  const triangulo = useMemo(() => {
    const p = Skia.PathBuilder.Make();
    p.moveTo(3 * s, 0);
    p.lineTo(4 * s, 0);
    p.lineTo(3 * s, s);
    p.close();
    return p.detach();
  }, [s]);
  return (
    <Group>
      <Rect x={0} y={0} width={s} height={s} color="white" />
      <Group clip={rect(s, 0, s, s)}>
        <Circle cx={s} cy={0} r={s} color="white" />
      </Group>
      <Group clip={rect(2 * s, 0, s, s)}>
        <Circle cx={2.5 * s} cy={0} r={s / 2} color="white" />
      </Group>
      <Path path={triangulo} color="white" />
    </Group>
  );
}

/**
 * O campo de azulejos — a assinatura do mundo Concreto.
 *
 * ## Como ele é barato
 *
 * Duas chamadas `Atlas` (tinta e motivo), cada uma desenhando TODOS os azulejos numa passada só,
 * a partir de uma textura branca de quatro peças criada uma vez na thread de UI. O que anda a
 * cada quadro é só o buffer de transformações (`useRSXformBuffer`), calculado de UM
 * `SharedValue` pela geometria pura de `tile-math`. Não há um nó por azulejo, nem um
 * `useAnimatedStyle` por azulejo, nem máscara refeita: o custo não cresce com a tela.
 *
 * ## O desenho
 *
 * Em cada janela da onda a tinta encolhe e gira 45° enquanto o motivo (quarto de círculo, meio
 * círculo, triângulo, quadrado — em azul ou papel) floresce por baixo e some girando mais 45°:
 * lido de longe, é o azulejo virando e mostrando o desenho. Os azulejos do CANTO não entram na
 * onda: ficam parados, e dois terços deles ganham o motivo no fim.
 *
 * Quem anima `progress` é quem usa (cortina, trava, login). O campo não conhece Reduce Motion
 * porque não decide movimento — quem chama troca a onda por cross-fade.
 */
export function TileField({
  progress,
  mode = 'diagonal',
  origin,
  invert = false,
  corner = 0,
  seed = TILE_SEED,
  cover = false,
  onReady,
  style,
}: TileFieldProps) {
  const theme = useTheme();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    // Só remonta quando muda de verdade: `onLayout` dispara em toda re-medição do pai.
    setBox((b) => (b.w === width && b.h === height ? b : { w: width, h: height }));
  };

  const g = useMemo(() => tileGrid(box.w, box.h), [box.w, box.h]);
  /** Lado do sprite na textura, em pixels — desenhar em dp deixaria o azulejo borrado em 3×. */
  const S = Math.max(1, Math.ceil(g.size * PR));
  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 0;

  /*
    ⚠️ O tamanho é MEMOIZADO. `usePictureAsTexture` refaz a textura quando o objeto muda, e um
    literal inline mudaria a cada render — a textura seria redesenhada na thread de UI sem
    motivo nenhum a cada mudança de estado de quem usa o campo.
  */
  const tamanho = useMemo(() => ({ width: S * 4, height: S }), [S]);
  const textura = useTexture(<Pecas s={S} />, tamanho, [S]);

  const dados = useMemo(() => {
    const ordens: number[] = [];
    const giros: number[] = [];
    const comMotivo: boolean[] = [];
    const spritesTinta = [];
    const spritesMotivo = [];
    for (let i = 0; i < g.count; i++) {
      const c = i % g.cols;
      const r = Math.floor(i / g.cols);
      const fica = cornerKeep(c, r, g.cols, corner);
      // -1 marca o azulejo do canto: ele nunca entra na onda.
      ordens.push(fica ? -1 : waveOrder(c, r, g.cols, g.rows, mode, ox, oy, seed, invert));
      giros.push(tileTurns(i, seed));
      comMotivo.push(patterned(i, seed, 0.66));
      spritesTinta.push(rect(0, 0, S, S));
      spritesMotivo.push(rect(tilePiece(i, seed) * S, 0, S, S));
    }
    return { ordens, giros, comMotivo, spritesTinta, spritesMotivo };
  }, [g, corner, seed, mode, ox, oy, invert, S]);

  const cores = useMemo(() => {
    const tinta = Skia.Color(theme.tileInk);
    const azul = Skia.Color(theme.tileMotif);
    const papel = Skia.Color(theme.tilePaper);
    return {
      tinta: dados.ordens.map(() => tinta),
      // Um em cada cinco motivos é papel: azul demais vira mancha, e o papel é o respiro.
      motivo: dados.ordens.map((_, i) => (i % 5 === 0 ? papel : azul)),
    };
  }, [dados.ordens, theme.tileInk, theme.tileMotif, theme.tilePaper]);

  const { ordens, giros, comMotivo } = dados;
  const cols = g.cols;
  const lado = g.size;
  const overlap = Motion.curtain.overlap;
  const kTinta = (lado + SANGRIA) / S;
  const kMotivo = lado / S;
  const meio = S / 2;

  const tinta = useRSXformBuffer(g.count, (val, i) => {
    'worklet';
    const ordem = ordens[i];
    const pose = ordem < 0 ? { scale: 1, angle: 0 } : inkPose(tilePhase(progress.value, ordem, overlap));
    const sc = pose.scale * kTinta;
    const cos = sc * Math.cos(pose.angle);
    const sin = sc * Math.sin(pose.angle);
    const cx = ((i % cols) + 0.5) * lado;
    const cy = (Math.floor(i / cols) + 0.5) * lado;
    val.set(cos, sin, cx - (cos * meio - sin * meio), cy - (sin * meio + cos * meio));
  });

  const motivo = useRSXformBuffer(g.count, (val, i) => {
    'worklet';
    const ordem = ordens[i];
    let escala = 0;
    let angulo = 0;
    if (ordem < 0) {
      /*
        O canto só ganha desenho no FIM da onda, entrando com um quarto de volta. Coberto, o
        campo tem que ser tinta lisa — é o primeiro quadro da abertura, e ele precisa bater com o
        splash nativo, que é uma cor só.
      */
      if (comMotivo[i]) {
        const t = Math.min(1, Math.max(0, (progress.value - 0.55) / 0.4));
        escala = 1 - Math.pow(1 - t, 3);
        angulo = (escala - 1) * (Math.PI / 2);
      }
    } else {
      const pose = motifPose(tilePhase(progress.value, ordem, overlap));
      escala = pose.scale;
      angulo = pose.angle;
    }
    angulo += giros[i] * (Math.PI / 2);
    const sc = escala * kMotivo;
    const cos = sc * Math.cos(angulo);
    const sin = sc * Math.sin(angulo);
    const cx = ((i % cols) + 0.5) * lado;
    const cy = (Math.floor(i / cols) + 0.5) * lado;
    val.set(cos, sin, cx - (cos * meio - sin * meio), cy - (sin * meio + cos * meio));
  });

  useAnimatedReaction(
    () => textura.value !== null,
    (pronta, antes) => {
      if (pronta && !antes && onReady) runOnJS(onReady)();
    },
    [onReady]
  );

  const fundo = useAnimatedStyle(() => ({
    backgroundColor:
      cover && (textura.value === null || progress.value <= 0) ? theme.tileInk : 'transparent',
  }));

  return (
    <Animated.View style={[style, fundo]} onLayout={onLayout} pointerEvents="none">
      {box.w > 0 && box.h > 0 ? (
        <SkiaCanvas style={StyleSheet.absoluteFill}>
          <Atlas
            image={textura}
            sprites={dados.spritesTinta}
            transforms={tinta}
            colors={cores.tinta}
            colorBlendMode="modulate"
          />
          <Atlas
            image={textura}
            sprites={dados.spritesMotivo}
            transforms={motivo}
            colors={cores.motivo}
            colorBlendMode="modulate"
          />
        </SkiaCanvas>
      ) : null}
    </Animated.View>
  );
}
