import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { ThemeColor } from '@/constants/theme';
import { Type, tabular as tabularStyle, type TypeVariant } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/** Distância entre o início de uma letra e o da seguinte. */
const PASSO = 22;
/** Quanto cada letra leva para subir. */
const SUBIDA = 520;

/**
 * Texto que sobe de uma máscara, letra a letra — a entrada tipográfica do Concreto.
 *
 * ## Só o valor verdadeiro
 *
 * Cada letra já nasce com o texto FINAL; o que anima é a posição dentro de um recorte. Nenhum
 * quadro mostra um número que não existe — a regra do herói ("nunca R$ 0,00 no primeiro
 * quadro") continua de pé. Quando o valor MUDA depois da entrada, quem conta é o `CountUpMoney`.
 *
 * ## Como é barato
 *
 * Um relógio só para a frase inteira; cada letra lê a sua fatia dele. As palavras não quebram no
 * meio (cada uma é uma linha própria de letras), e a frase quebra entre palavras como qualquer
 * texto.
 *
 * O leitor de tela lê a frase inteira no contêiner; as letras soltas ficam escondidas dele. Com
 * Reduce Motion, é um texto só aparecendo.
 */
export function SplitReveal({
  text,
  variant = 'display',
  themeColor = 'text',
  tabular = false,
  play = true,
  delay = 0,
  style,
}: {
  text: string;
  variant?: TypeVariant;
  themeColor?: ThemeColor;
  tabular?: boolean;
  /** A entrada começa quando fica `true` (a raiz espera a cortina sair). */
  play?: boolean;
  delay?: number;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const relogio = useSharedValue(0);
  const total = text.length * PASSO + SUBIDA;

  useEffect(() => {
    if (!play || reduzido) return;
    /*
      O atraso mora DENTRO do relógio (ele parte de −delay), não num `withDelay`. Medido no
      Android: com `withDelay` na primeira montagem de uma tela, a frase atrasada nunca aparecia —
      o espaço ficava lá, vazio —, e remontada ela aparecia normal. Um relógio linear só não tem
      o que perder.
    */
    relogio.set(-delay);
    relogio.set(withTiming(total, { duration: total + delay, easing: Easing.linear }));
  }, [play, reduzido, delay, total, relogio]);

  const estilo: StyleProp<TextStyle> = [
    Type[variant],
    tabular ? tabularStyle : null,
    { color: theme[themeColor] },
    styles.letra,
    style,
  ];

  if (reduzido) {
    return (
      <Animated.Text entering={FadeIn.duration(200)} style={estilo} android_hyphenationFrequency="none">
        {text}
      </Animated.Text>
    );
  }

  const altura = Type[variant].lineHeight;
  const palavras = text.split(' ');
  let indice = 0;

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={text} style={styles.frase}>
      {palavras.map((palavra, p) => {
        const letras = (p < palavras.length - 1 ? `${palavra} ` : palavra).split('');
        return (
          <View
            key={p}
            style={styles.palavra}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden>
            {letras.map((letra, l) => {
              const i = indice++;
              return (
                <Letra
                  key={l}
                  letra={letra}
                  indice={i}
                  relogio={relogio}
                  altura={altura}
                  estilo={estilo}
                />
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function Letra({
  letra,
  indice,
  relogio,
  altura,
  estilo,
}: {
  letra: string;
  indice: number;
  relogio: SharedValue<number>;
  altura: number;
  estilo: StyleProp<TextStyle>;
}) {
  const sobe = useAnimatedStyle(() => {
    const t = Math.min(1, Math.max(0, (relogio.get() - indice * PASSO) / SUBIDA));
    const e = 1 - Math.pow(1 - t, 4);
    // Antes da vez dela (inclusive antes de `play`), a letra está fora do recorte e invisível.
    return {
      opacity: t > 0 ? 1 : 0,
      transform: [{ translateY: (1 - e) * altura }],
    };
  });
  return (
    <View style={[styles.mascara, { height: altura }]}>
      <Animated.Text
        android_hyphenationFrequency="none"
        style={[estilo, sobe]}>
        {letra}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frase: { flexDirection: 'row', flexWrap: 'wrap' },
  palavra: { flexDirection: 'row' },
  mascara: { overflow: 'hidden' },
  /** Letra solta não encolhe: encolher dentro da máscara cortaria o glifo. */
  letra: { flexShrink: 0 },
});
