import { Path, Skia } from '@shopify/react-native-skia';
import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { SkiaCanvas } from '@/components/ui/skia-canvas';
import {
  amplitude,
  bordaDaOnda,
  pontosDaCurva,
  raioDaCobertura,
  type FaseDaOnda,
  type WaveMode,
} from '@/design/wave-math';

export interface WaveCurtainProps {
  /** 0 = tela coberta, 1 = tela livre. Quem anima é quem chama. */
  progress: SharedValue<number>;
  /** Cobrir desenha a região abaixo da borda; revelar, a de cima. */
  fase: FaseDaOnda;
  mode: WaveMode;
  /** Origem do círculo (`radial`), em fração da área. */
  origin?: { x: number; y: number };
  color: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A cortina curva: uma forma de tinta com a borda em curva que atravessa a tela.
 *
 * É um `Path` do Skia recalculado a cada quadro na thread de UI, a partir de UM valor — a
 * geometria mora em `design/wave-math.ts`. O círculo (`radial`) é a cobertura que nasce num
 * ponto, o botão que disparou a troca; revelar a partir dele é a mesma subida da onda `up`.
 *
 * ## O primeiro quadro
 *
 * O canvas do Skia pinta um ou dois quadros depois de montar. Com a cortina FECHADA (`p <= 0`)
 * uma `View` de tinta por trás garante a tela coberta desde o primeiro quadro — é o que casa com o
 * splash nativo e com o fim de uma cobertura.
 */
export function WaveCurtain({ progress, fase, mode, origin, color, style }: WaveCurtainProps) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b.w === width && b.h === height ? b : { w: width, h: height }));
  };

  const { w, h } = box;
  const ox = origin?.x ?? 0.5;
  const oy = origin?.y ?? 0.5;
  const espelhar = mode === 'down';
  const circulo = mode === 'radial' && fase === 'cobrir';

  const forma = useDerivedValue(() => {
    const p = progress.value;
    const b = Skia.PathBuilder.Make();
    if (w <= 0 || h <= 0) return b.detach();
    if (circulo) {
      const r = raioDaCobertura(p, ox, oy, w, h);
      if (r > 0) b.addCircle(ox * w, oy * h, r);
      return b.detach();
    }
    const A = amplitude(p, h);
    const base = bordaDaOnda(p, fase, h, A);
    const c = pontosDaCurva(base, w, A);
    // Com `down` a mesma forma, de cabeça para baixo.
    const y = (v: number) => (espelhar ? h - v : v);
    // Cobrir fica ancorado no pé da tela; revelar, no topo.
    const ancora = fase === 'cobrir' ? h : 0;
    b.moveTo(0, y(ancora));
    b.lineTo(0, y(c.y0));
    b.cubicTo(c.c1x, y(c.c1y), c.c2x, y(c.c2y), w, y(c.y1));
    b.lineTo(w, y(ancora));
    b.close();
    return b.detach();
  });

  const fundo = useAnimatedStyle(() => ({ opacity: progress.value <= 0 ? 1 : 0 }));

  return (
    <View style={style} onLayout={onLayout} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: color }, fundo]} />
      {w > 0 && h > 0 ? (
        <SkiaCanvas style={StyleSheet.absoluteFill}>
          <Path path={forma} color={color} />
        </SkiaCanvas>
      ) : null}
    </View>
  );
}
