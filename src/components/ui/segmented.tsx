import { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { Fonts } from '@/constants/theme';
import { HitTarget, Radius, Space, Type } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

type Opcao<T extends string> = { value: T; label: string };

interface SegmentedProps<T extends string> {
  /**
   * De duas a QUATRO opções, e quem trava é o TIPO.
   *
   * Medido a 384dp × fonte 1,3 (a régua de verificação do projeto): numa calha de
   * 352pt, cinco células deixam ~62pt de texto e "Investimento" precisa de ~117 —
   * a palavra parte no meio ("Investimen/to"), o que design.md §3 proíbe. Já
   * aconteceu em três telas. O `minWidth` de quem chama não resolve: não existe
   * largura que caiba cinco células num sheet, ela só empurraria o controle para
   * fora da tela.
   *
   * Cinco ou mais é `SelectField` (quando o valor vai ser GRAVADO) ou uma fileira
   * rolável de `Chip` (quando FILTRA uma lista). E quatro só com rótulo CURTO: a
   * folga some rápido — em Lançamentos, "Transferências" já teve que virar
   * "Transf." para caber, o que é truncar na copy em vez de no `numberOfLines`.
   *
   * ⚠️ Lista de tamanho VARIÁVEL nunca entra aqui, nem que hoje tenha três itens:
   * em Faturas as opções eram os cartões do usuário, então a largura por célula
   * era função de quantos cartões ele tinha.
   *
   * A trava é o tipo e não um teste porque ela precisa valer em tempo de
   * compilação: um `.map()` sobre lista de tamanho desconhecido para de compilar
   * aqui, que é onde o defeito nasce.
   */
  options:
    | readonly [Opcao<T>, Opcao<T>]
    | readonly [Opcao<T>, Opcao<T>, Opcao<T>]
    | readonly [Opcao<T>, Opcao<T>, Opcao<T>, Opcao<T>];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Seletor segmentado.
 *
 * ponytail: reconstruído em JS em vez de usar o controle nativo — o projeto tirou `@expo/ui` no
 * commit `de229d7` e nenhuma lib de segmented está aprovada. Se a diferença de timing incomodar,
 * o upgrade é `@react-native-segmented-control/segmented-control`, e a API não muda.
 *
 * O polegar desliza com `Motion.spring.snap`, que `tokens.ts` nomeia literalmente para "o
 * indicador de um segmented" e explica por quê: `settle` é criticamente amortecida e, num
 * controle tocado o dia inteiro, lê como travada. O componente usava `settle` — contra o próprio
 * token, e em silêncio, porque as duas molas compilam igual.
 */
/** Folga entre o trilho e o bloco. */
const FOLGA = 3;
/** A borda da FRENTE corre com esta mola… */
const FRENTE = { duration: 300, dampingRatio: 0.84 };
/** …e a de TRÁS vem com esta, mais lenta: é a diferença que estica o bloco. */
const TRAS = { duration: 520, dampingRatio: 0.9 };

/**
 * Controle segmentado do mundo Concreto: um bloco de tinta que desliza por um trilho.
 *
 * ## O movimento
 *
 * O bloco é descrito por DUAS bordas, cada uma com a sua mola. Ao trocar de opção, a borda que
 * aponta para o destino sai na frente e a outra vem atrás: o bloco se estica na direção do toque
 * e assenta quando a de trás chega. É o que dá corpo ao gesto sem quicar — e continua sendo só
 * `translateX` + `scaleX`, na thread de UI.
 *
 * ## O rótulo
 *
 * A cor de cada rótulo é função da DISTÂNCIA entre o centro do bloco e o centro da célula: o texto
 * inverte (secundário → cor do fundo) exatamente quando a tinta passa por baixo dele, inclusive
 * no meio do caminho. Por isso todos os rótulos usam o mesmo peso — trocar de face no selecionado
 * mudaria a largura do texto no meio da animação.
 */
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  /** A largura de uma célula para o ESTILO do bloco (comum, não animado). */
  const [celula, setCelula] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  /**
   * A mesma largura, num valor COMPARTILHADO, para a conta do `translateX`.
   *
   * ⚠️ A largura do bloco é estilo COMUM, e só o `transform` anima. Com `width` animado (prop de
   * layout vinda do worklet) o bloco nascia com largura zero no Android depois de um início a
   * frio e o rótulo selecionado ficava da cor do fundo, sobre nada — invisível.
   */
  const slot = useSharedValue(0);

  /** As bordas do bloco, em unidades de célula. */
  const esquerda = useSharedValue(index);
  const direita = useSharedValue(index + 1);
  const anterior = useRef(index);

  useEffect(() => {
    const de = anterior.current;
    anterior.current = index;
    if (de === index) return;
    if (reduzido) {
      esquerda.set(index);
      direita.set(index + 1);
      return;
    }
    if (index > de) {
      direita.set(withSpring(index + 1, FRENTE));
      esquerda.set(withSpring(index, TRAS));
    } else {
      esquerda.set(withSpring(index, FRENTE));
      direita.set(withSpring(index + 1, TRAS));
    }
  }, [index, reduzido, esquerda, direita]);

  const bloco = useAnimatedStyle(() => ({
    transform: [
      { translateX: esquerda.get() * slot.get() },
      { scaleX: Math.max(0.2, direita.get() - esquerda.get()) },
    ],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const w = (e.nativeEvent.layout.width - FOLGA * 2) / options.length;
    slot.set(w);
    setCelula((antes) => (antes === w ? antes : w));
  };

  return (
    <View
      accessibilityRole="tablist"
      onLayout={onLayout}
      style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
      {celula > 0 ? (
        <Animated.View style={[styles.thumb, { width: celula, backgroundColor: theme.text }, bloco]} />
      ) : null}
      {options.map((option, i) => (
        <Celula
          key={option.value}
          label={option.label}
          index={i}
          selected={i === index}
          esquerda={esquerda}
          direita={direita}
          onPress={() => {
            if (i === index) return;
            Haptics.selectionAsync();
            onChange(option.value);
          }}
        />
      ))}
    </View>
  );
}

function Celula({
  label,
  index,
  selected,
  esquerda,
  direita,
  onPress,
}: {
  label: string;
  index: number;
  selected: boolean;
  esquerda: { get: () => number };
  direita: { get: () => number };
  onPress: () => void;
}) {
  const theme = useTheme();
  const apagado = theme.textSecondary;
  const aceso = theme.background;

  const cor = useAnimatedStyle(() => {
    const centro = (esquerda.get() + direita.get()) / 2;
    const perto = Math.min(1, Math.max(0, 1 - Math.abs(centro - (index + 0.5))));
    return { color: interpolateColor(perto, [0, 1], [apagado, aceso]) };
  });

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.option}>
      <Animated.Text
        allowFontScaling
        android_hyphenationFrequency="none"
        style={[styles.label, cor]}>
        {label}
      </Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: FOLGA,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  thumb: {
    position: 'absolute',
    top: FOLGA,
    bottom: FOLGA,
    left: FOLGA,
    borderRadius: Radius.xs,
    borderCurve: 'continuous',
    transformOrigin: 'left',
  },
  label: {
    ...Type.subhead,
    fontFamily: Fonts.semibold,
    textAlign: 'center',
  },
  option: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Space.sm,
    paddingHorizontal: Space.xs,
    minHeight: 34,
    /*
      ⚠️ **Piso de largura, senão o controle SOME quando o pai é uma linha.**
      `flex: 1` no React Native é `flexBasis: 0`, então a largura NATURAL da trilha é a soma das
      células: zero. Dentro de um `flexDirection: 'row'` a trilha inteira colapsava para os 4pt do
      padding — foi o `Mês | Ciclo` "sumido" ao lado do seletor de mês no Financeiro. 44 é o alvo
      de toque mínimo que design.md §11 já exige.
    */
    minWidth: HitTarget,
  },
});
