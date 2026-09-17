import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { FractalNoise, RadialGradient, Rect, vec } from '@shopify/react-native-skia';
import { useDerivedValue, useReducedMotion } from 'react-native-reanimated';

import { SkiaCanvas } from '@/components/ui/skia-canvas';
import { useRolagemDaTela } from '@/components/ui/screen-scroll';
import { useTheme } from '@/hooks/use-theme';

/** Quanto a luz anda por dp rolado — devagar, para ler como reflexo e não como objeto. */
const PARALAXE_X = 0.35;
const PARALAXE_Y = 0.2;

/**
 * A "tinta viva" do bloco de destaque: a tinta chapada, uma luz larga que acompanha a rolagem e
 * um grão fino por cima.
 *
 * Liberado pelo dono do produto em 17/09/2026 ("sem degradê/brilho em conteúdo" deixou de valer
 * nas raízes). Dois canvases de propósito: o grão é estático e nunca redesenha; só a luz,
 * que é um degradê radial barato, redesenha quando a rolagem muda. Parado, custo zero.
 *
 * Com Reduzir Movimento a luz fica onde nasceu.
 */
export function InkSurface() {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const rolagem = useRolagemDaTela();
  const [tam, setTam] = useState({ w: 0, h: 0 });

  const centro = useDerivedValue(() => {
    const d = reduzido ? 0 : Math.max(-120, Math.min(240, rolagem.get()));
    return vec(tam.w * 0.82 - d * PARALAXE_X, -tam.h * 0.15 + d * PARALAXE_Y);
  }, [tam.w, tam.h, reduzido]);

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.heroSurface }]}
      onLayout={(e) => setTam({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {tam.w > 0 ? (
        <>
          <SkiaCanvas style={StyleSheet.absoluteFill}>
            <Rect x={0} y={0} width={tam.w} height={tam.h}>
              <RadialGradient
                c={centro}
                r={Math.max(tam.w, tam.h) * 0.9}
                colors={[theme.heroGlow, theme.heroGlowClear]}
              />
            </Rect>
          </SkiaCanvas>
          <SkiaCanvas style={StyleSheet.absoluteFill}>
            <Rect x={0} y={0} width={tam.w} height={tam.h} opacity={0.06}>
              <FractalNoise freqX={0.85} freqY={0.85} octaves={3} seed={7} />
            </Rect>
          </SkiaCanvas>
        </>
      ) : null}
    </View>
  );
}
