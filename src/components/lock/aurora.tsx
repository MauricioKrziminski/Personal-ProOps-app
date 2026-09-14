/**
 * O fundo vivo da cortina de bloqueio: três massas de luz que respiram atrás do vidro.
 *
 * ## Por que ele existe (e não é enfeite)
 *
 * `glass-card.tsx` escreve o problema com todas as letras: *"vidro precisa de algo atrás para
 * refratar; sobre o fundo chapado do app ele virava um retângulo cinza"*. A cortina de bloqueio é
 * a única tela do app que **não tem conteúdo por baixo** — é justamente o que ela esconde —,
 * então o vidro ali não teria o que refratar e o disco central leria como um círculo cinza.
 *
 * A aurora é o que o vidro refrata. E ela diz, sem escrever, a coisa certa sobre um app
 * bloqueado: **tem algo vivo do outro lado, você só não consegue ler.** É o mesmo movimento do
 * brilho do `HeroPanel` (`GradientSurface`), promovido a tela inteira e com tempo.
 *
 * ## Como ele é barato
 *
 * ⚠️ **UMA passada de desfoque, não três.** Os círculos entram num `Group` com `layer` — uma
 * camada offscreen — e o `Blur` é aplicado nela. Com `BlurMask` por círculo seriam três blurs
 * independentes por quadro, que é o que derruba o Android. Aqui o custo não cresce com a
 * quantidade de massas.
 *
 * ⚠️ **O que anda é o `transform` do grupo, nunca o raio nem o blur.** Mudar `r` ou `blur`
 * obriga o Skia a refazer a máscara; mudar a matriz é o caminho que a GPU já ia percorrer. As
 * três massas derivam de UM relógio (`fase`), com defasagens diferentes — um shared value só
 * atravessa a ponte, e o resto é aritmética dentro do worklet.
 *
 * ⚠️ **Cor vem de token, e o ALFA vem junto** (`auroraDeep`/`auroraGlow`/`auroraLift` em
 * `constants/theme.ts`). Um `opacity` escolhido aqui seria decisão de cor fora do arquivo de cor
 * — e foi assim que a primeira versão pintou `heroTop` a 55% sobre o fundo claro e produziu um
 * borrão cinza no meio da tela.
 */

import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Blur, Circle, Group, Paint } from '@shopify/react-native-skia';
import {
  Easing,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { SkiaCanvas } from '@/components/ui/skia-canvas';
import { useTheme } from '@/hooks/use-theme';

/** Um ciclo inteiro da respiração. Longo de propósito: movimento que se nota vira distração. */
const CICLO_MS = 14_000;

/**
 * As três massas, em fração da largura da tela.
 *
 * `fase` desloca cada uma no mesmo relógio — com a fase igual, as três subiriam e desceriam
 * juntas e o conjunto leria como uma coisa só piscando. `cor` é o token; a do meio é o accent, e
 * é a única aparição grande de matiz aqui (design §2b: uma alavanca de cor só).
 */
const MASSAS = [
  { x: 0.18, y: 0.24, r: 0.6, fase: 0, amp: 0.05, cor: 'auroraDeep' },
  { x: 0.88, y: 0.44, r: 0.52, fase: 0.42, amp: 0.07, cor: 'auroraGlow' },
  { x: 0.4, y: 0.86, r: 0.64, fase: 0.75, amp: 0.045, cor: 'auroraLift' },
] as const;

export function Aurora() {
  const { width, height } = useWindowDimensions();
  const theme = useTheme();
  const reduzido = useReducedMotion();

  /** O relógio: 0 → 1 → 0, para sempre. Uma trava só para as três massas. */
  const fase = useSharedValue(0);
  /** A abertura: as massas entram de dentro para fora, junto com o disco. */
  const entrada = useSharedValue(reduzido ? 1 : 0);

  useEffect(() => {
    entrada.set(withTiming(1, { duration: 900, easing: Easing.bezier(0.16, 1, 0.3, 1) }));
    if (reduzido) return;
    fase.set(withRepeat(withTiming(1, { duration: CICLO_MS, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [fase, entrada, reduzido]);

  /*
    Um `transform` por massa, derivado do mesmo relógio. `useDerivedValue` roda no worklet: nada
    disto atravessa a ponte por quadro.
  */
  const t0 = useMassa(0, fase, entrada, width, height);
  const t1 = useMassa(1, fase, entrada, width, height);
  const t2 = useMassa(2, fase, entrada, width, height);
  const transforms = [t0, t1, t2];

  const opacidade = useDerivedValue(() => entrada.get());

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <SkiaCanvas style={StyleSheet.absoluteFill}>
        {/*
          A camada: o desfoque é da CAMADA, então ele acontece uma vez para as três massas. O raio
          é fração da largura para a aurora ter a mesma maciez em qualquer aparelho — 60px num
          celular pequeno é um borrão; num tablet, um contorno.
        */}
        <Group layer={<Paint><Blur blur={width * 0.16} /></Paint>} opacity={opacidade}>
          {MASSAS.map((m, i) => (
            <Group key={m.cor} transform={transforms[i]} origin={{ x: m.x * width, y: m.y * height }}>
              <Circle cx={m.x * width} cy={m.y * height} r={m.r * width} color={theme[m.cor]} />
            </Group>
          ))}
        </Group>
      </SkiaCanvas>
    </View>
  );
}

/**
 * A trajetória de uma massa: uma elipse lenta, mais a escala da abertura.
 *
 * ⚠️ **É um hook chamado em ordem fixa, nunca dentro de `map`.** As três chamadas explícitas lá
 * em cima existem por isso — `MASSAS` é uma constante de módulo, mas as Regras dos Hooks não leem
 * constantes, e a primeira versão deste arquivo quebrou o lint exatamente aqui.
 */
function useMassa(
  i: number,
  fase: { get: () => number },
  entrada: { get: () => number },
  width: number,
  height: number
) {
  const m = MASSAS[i];
  return useDerivedValue(() => {
    'worklet';
    const t = (fase.get() + m.fase) % 1;
    const ang = t * Math.PI * 2;
    // A abertura sai de 0,72: as massas crescem PARA FORA do centro, e não aparecem prontas.
    const escala = 0.72 + entrada.get() * 0.28;
    return [
      { translateX: Math.cos(ang) * m.amp * width },
      { translateY: Math.sin(ang) * m.amp * height * 0.6 },
      { scale: escala },
    ];
  });
}
