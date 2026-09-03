import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { BlurMask, Canvas, Circle, Fill, LinearGradient, vec } from '@shopify/react-native-skia';

/**
 * O fundo das superfícies de destaque do Stitch: um gradiente vertical curto e, opcionalmente,
 * um **brilho** difuso num canto.
 *
 * ## Por que não é uma cor chapada
 *
 * O export pinta o painel com `from-surface-container-high via-surface-container to-…-low` — 15
 * valores de 255 entre topo e base. O olho não lê "gradiente"; lê uma superfície que tem CIMA e
 * BAIXO. Chapada, ela lê como um retângulo colado na tela, que foi exatamente a queixa de "sem
 * graça" que o `HeroPanel` de tinta sólida ainda carregava.
 *
 * O brilho (`bg-secondary/10 blur-3xl` num círculo de 224px sobrando pela borda) é a única
 * aparição de cor grande do design, e é o que faz o painel parecer iluminado em vez de pintado.
 *
 * ## Por que Skia
 *
 * Não há gradiente em `StyleSheet`, e `expo-linear-gradient` seria uma dependência a mais para
 * algo que o Skia — já no bundle por causa da marca e do sparkline — desenha com dois nós. O
 * `Canvas` fica em `absoluteFill` atrás do conteúdo; irmão posterior na árvore desenha por cima.
 */
export function GradientSurface({
  from,
  to,
  sheen,
  /** Raio do brilho. O `w-56` do export, que sobra metade para fora do card. */
  sheenSize = 112,
}: {
  from: string;
  to: string;
  /** Cor do brilho, já com alfa (ex.: `tint` a 12%). Ausente = sem brilho. */
  sheen?: string;
  sheenSize?: number;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  const measure = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    // Só remonta quando muda de verdade: `onLayout` dispara em toda re-medição do pai.
    setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
  };

  return (
    /*
      A medição fica na `View`, não no `Canvas`: o `Canvas` do Skia **não aceita `onLayout`** e
      responde com "is not supported" em tempo de execução (visto no simulador). Ele também não
      sabe o próprio tamanho a tempo de posicionar o gradiente, então a `View` mede e o canvas
      preenche.
    */
    <View style={StyleSheet.absoluteFill} onLayout={measure} pointerEvents="none">
      {size.h > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill>
            <LinearGradient start={vec(0, 0)} end={vec(0, size.h)} colors={[from, to]} />
          </Fill>
          {sheen ? (
            <Circle cx={size.w - sheenSize / 3} cy={-sheenSize / 3} r={sheenSize} color={sheen}>
              <BlurMask blur={sheenSize / 2} style="normal" />
            </Circle>
          ) : null}
        </Canvas>
      ) : null}
    </View>
  );
}
