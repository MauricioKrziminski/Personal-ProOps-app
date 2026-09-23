import { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View, type TextProps } from 'react-native';
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { Fonts } from '@/constants/theme';
import { HitTarget, Motion, Radius, Space, Type } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { SegmentedProps } from './segmented.types';

/** Folga entre o trilho e o polegar. */
const FOLGA = 3;
const FRENTE = Motion.spring.segmentoFrente;
const TRAS = Motion.spring.segmentoTras;

/**
 * Controle animado compartilhado pelo Android e web.
 *
 * ## O movimento
 *
 * O polegar é descrito por DUAS bordas, cada uma com a sua mola. Ao trocar de opção, a borda que
 * aponta para o destino sai na frente e a outra vem atrás: o polegar se estica na direção do toque
 * e assenta quando a de trás chega. Para esticar sem achatar as pontas arredondadas, ele é feito de
 * três peças da mesma cor — duas tampas que seguem cada borda e um miolo reto entre elas.
 *
 * ## O rótulo
 *
 * A cor de cada rótulo é função da DISTÂNCIA entre o centro do polegar e o centro da célula, então
 * o texto acende quando o polegar passa por baixo dele. Todos usam o mesmo peso: trocar de face no
 * selecionado mudaria a largura do texto no meio da animação.
 *
 * ## O repouso é escrito pelo React
 *
 * ⚠️ **Parado, o polegar e os rótulos NÃO são do Reanimated** (23/09/2026). Medido no emulador:
 * depois de uma troca o polegar ficava preso num quadro do meio — só a tampa esquerda, uma
 * bolinha solta ao lado de um retângulo de ponta reta, ou esticado por cima das duas células. É a
 * atualização perdida do Android que `design.md` §5 já registrou nas entradas das raízes.
 *
 * ⚠️ **E trocar só o `style` da MESMA view não resolve** — foi a primeira tentativa: a view que
 * já teve estilo animado continua com os valores que o Reanimated escreveu nela, e o estilo
 * comum que chega depois não os desfaz (no estresse, 6 de 8 trocas rápidas terminaram
 * esticadas). Parado é OUTRA view (`PolegarParado`, `View` comum posicionada por `left`); o
 * polegar animado só existe enquanto `andando`, e a mola de trás — a última a chegar — é quem
 * desmonta ele e devolve o desenho ao React.
 */
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  /** Largura de uma célula e altura do polegar, para o ESTILO (comum, não animado). */
  const [caixa, setCaixa] = useState({ celula: 0, altura: 0 });
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  /** As bordas do polegar, em unidades de célula. */
  const esquerda = useSharedValue(index);
  const direita = useSharedValue(index + 1);
  const anterior = useRef(index);
  /**
   * O índice em que as molas já PARARAM. Diferente do atual = em troca: só aí o desenho é do
   * Reanimated; parado, é do React (ver o topo). Derivado no render — sem `setState` no efeito.
   */
  const [assentado, setAssentado] = useState(index);
  // Com Reduce Motion não há mola para avisar que assentou: o salto é o assentamento. Sem isto,
  // desligar o Reduce Motion com a tela aberta deixava o polegar animado montado para sempre.
  if (reduzido && assentado !== index) setAssentado(index);
  const andando = !reduzido && index !== assentado;

  useEffect(() => {
    const de = anterior.current;
    anterior.current = index;
    if (de === index) return;
    if (reduzido) {
      esquerda.set(index);
      direita.set(index + 1);
      return;
    }
    // Interrompida por outro toque, a mola devolve `false` e quem assenta é a do toque novo.
    const alvo = index;
    const assentou = (fim?: boolean) => {
      'worklet';
      if (fim) runOnJS(setAssentado)(alvo);
    };
    if (index > de) {
      direita.set(withSpring(index + 1, FRENTE));
      esquerda.set(withSpring(index, TRAS, assentou));
    } else {
      esquerda.set(withSpring(index, FRENTE));
      direita.set(withSpring(index + 1, TRAS, assentou));
    }
  }, [index, reduzido, esquerda, direita]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const celula = (width - FOLGA * 2) / options.length;
    const altura = height - FOLGA * 2;
    setCaixa((antes) =>
      antes.celula === celula && antes.altura === altura ? antes : { celula, altura }
    );
  };

  return (
    <View
      accessibilityRole="tablist"
      onLayout={onLayout}
      style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
      {caixa.celula > 0 ? (
        andando ? (
          <PolegarAndando
            key={`${caixa.celula}:${caixa.altura}`}
            celula={caixa.celula}
            altura={caixa.altura}
            cor={theme.thumb}
            esquerda={esquerda}
            direita={direita}
          />
        ) : (
          <View
            pointerEvents="none"
            style={[
              styles.parado,
              {
                left: FOLGA + index * caixa.celula,
                width: caixa.celula,
                height: caixa.altura,
                borderRadius: Radius.pill,
                backgroundColor: theme.thumb,
              },
            ]}
          />
        )
      ) : null}
      {options.map((option, i) => (
        <Celula
          key={option.value}
          label={option.label}
          index={i}
          selected={i === index}
          andando={andando}
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

/**
 * O polegar EM TROCA. Nasce só depois da medida e com as medidas como CONSTANTES — `key` o remonta
 * se elas mudarem (rotação, fonte). Parado quem desenha é uma `View` comum (ver o topo).
 *
 * ⚠️ **A largura não pode ser valor compartilhado gravado no `onLayout`.** No Android ela chegava
 * à thread de UI antes de o estilo animado existir, o estilo nunca recalculava e o bloco ficava
 * parado na primeira célula. Constante na montagem, não há corrida.
 */
function PolegarAndando({
  celula,
  altura,
  cor,
  esquerda,
  direita,
}: {
  celula: number;
  altura: number;
  cor: string;
  esquerda: SharedValue<number>;
  direita: SharedValue<number>;
}) {
  const r = altura / 2;
  const tampaEsquerda = useAnimatedStyle(() => ({
    transform: [{ translateX: esquerda.get() * celula }],
  }));
  const tampaDireita = useAnimatedStyle(() => ({
    transform: [{ translateX: direita.get() * celula - altura }],
  }));
  const miolo = useAnimatedStyle(() => {
    const largura = Math.max(0, (direita.get() - esquerda.get()) * celula - altura);
    return {
      transform: [
        { translateX: esquerda.get() * celula + r },
        { scaleX: largura / Math.max(1, celula - altura) },
      ],
    };
  });
  const tampa = { width: altura, height: altura, borderRadius: r, backgroundColor: cor };
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[styles.peca, { width: Math.max(1, celula - altura), height: altura, backgroundColor: cor }, miolo]}
      />
      <Animated.View pointerEvents="none" style={[styles.peca, tampa, tampaEsquerda]} />
      <Animated.View pointerEvents="none" style={[styles.peca, tampa, tampaDireita]} />
    </>
  );
}

function Celula({
  label,
  index,
  selected,
  andando,
  esquerda,
  direita,
  onPress,
}: {
  label: string;
  index: number;
  selected: boolean;
  andando: boolean;
  esquerda: { get: () => number };
  direita: { get: () => number };
  onPress: () => void;
}) {
  const theme = useTheme();
  const apagado = theme.textSecondary;
  const aceso = theme.text;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.option}>
      {/*
        ⚠️ **O rótulo ENCOLHE para caber, nunca parte nem trunca.** Célula de segmentado tem
        largura dividida, não natural: em 384dp × fonte 1,3 "Transferência" pede mais que a célula
        e o Android partia a palavra ("Transferênci/a"). Quebrar a linha mudaria a altura de uma
        célula só. É o que o `UISegmentedControl` do iOS faz: a fonte desce até caber, com piso.
      */}
      {/* Parado é `Text` comum, pelo mesmo motivo do polegar (ver o topo). */}
      {andando ? (
        <RotuloAndando
          label={label}
          index={index}
          apagado={apagado}
          aceso={aceso}
          esquerda={esquerda}
          direita={direita}
        />
      ) : (
        <Text {...ROTULO} style={[styles.label, { color: selected ? aceso : apagado }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const ROTULO = {
  allowFontScaling: true,
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.7,
  android_hyphenationFrequency: 'none',
} as const satisfies TextProps;

function RotuloAndando({
  label,
  index,
  apagado,
  aceso,
  esquerda,
  direita,
}: {
  label: string;
  index: number;
  apagado: string;
  aceso: string;
  esquerda: { get: () => number };
  direita: { get: () => number };
}) {
  const cor = useAnimatedStyle(() => {
    const centro = (esquerda.get() + direita.get()) / 2;
    const perto = Math.min(1, Math.max(0, 1 - Math.abs(centro - (index + 0.5))));
    return { color: interpolateColor(perto, [0, 1], [apagado, aceso]) };
  });
  return (
    <Animated.Text {...ROTULO} style={[styles.label, cor]}>
      {label}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: FOLGA,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
  peca: {
    position: 'absolute',
    top: FOLGA,
    left: FOLGA,
    transformOrigin: 'left',
  },
  parado: {
    position: 'absolute',
    top: FOLGA,
    borderCurve: 'continuous',
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
    paddingHorizontal: Space.sm,
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
