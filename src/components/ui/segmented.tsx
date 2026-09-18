import { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { GlassBackdrop, supportsLiquidGlass } from '@/components/ui/glass-backdrop';
import { Fonts } from '@/constants/theme';
import { Elevation, HitTarget, Radius, Space, Type } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';

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

/** Folga entre o trilho e o polegar. */
const FOLGA = 3;
/** A borda da FRENTE corre com esta mola… */
const FRENTE = { duration: 300, dampingRatio: 0.84 };
/** …e a de TRÁS vem com esta, mais lenta: é a diferença que estica o polegar. */
const TRAS = { duration: 520, dampingRatio: 0.9 };

/**
 * Um controle para todos os seletores do app. No iOS 26+, o trilho e o polegar
 * usam Liquid Glass nativo; no Android, mantêm as superfícies do tema.
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
 */
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const theme = useTheme();
  const scheme = useScheme();
  const vidro = supportsLiquidGlass();
  const reduzido = useReducedMotion();
  /** Largura de uma célula e altura do polegar, para o ESTILO (comum, não animado). */
  const [caixa, setCaixa] = useState({ celula: 0, altura: 0 });
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  /** As bordas do polegar, em unidades de célula. */
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
      style={[
        styles.track,
        // The native material needs a transparent host to keep its refraction visible.
        { backgroundColor: vidro ? 'transparent' : theme.backgroundElement },
        vidro && {
          borderWidth: 1,
          borderColor: theme.glassRim,
          boxShadow: Elevation[scheme].raised,
        },
      ]}>
      {vidro ? <GlassBackdrop fallbackColor={theme.backgroundElement} radius={Radius.pill} tintColor={theme.backgroundElement} /> : null}
      {caixa.celula > 0 ? (
        <Polegar
          key={`${caixa.celula}:${caixa.altura}`}
          celula={caixa.celula}
          altura={caixa.altura}
          cor={theme.thumb}
          esquerda={esquerda}
          direita={direita}
        />
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

/**
 * O polegar. Nasce só depois da medida e com as medidas como CONSTANTES — `key` o remonta se elas
 * mudarem (rotação, fonte).
 *
 * ⚠️ **A largura não pode ser valor compartilhado gravado no `onLayout`.** No Android ela chegava
 * à thread de UI antes de o estilo animado existir, o estilo nunca recalculava e o bloco ficava
 * parado na primeira célula. Constante na montagem, não há corrida.
 */
function Polegar({
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
  const theme = useTheme();
  const scheme = useScheme();
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
  const vidro = useAnimatedStyle(() => ({
    width: Math.max(1, (direita.get() - esquerda.get()) * celula),
    transform: [{ translateX: esquerda.get() * celula }],
  }));
  const tampa = { width: altura, height: altura, borderRadius: r, backgroundColor: cor };
  if (supportsLiquidGlass()) {
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          styles.polegarVidro,
          {
            height: altura,
            borderRadius: r,
            borderWidth: 1,
            borderColor: theme.glassRim,
            boxShadow: Elevation[scheme].floating,
          },
          vidro,
        ]}>
        <GlassBackdrop fallbackColor={cor} radius={r} effectStyle="clear" />
      </Animated.View>
    );
  }
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
  const aceso = theme.text;

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
      {/*
        ⚠️ **O rótulo ENCOLHE para caber, nunca parte nem trunca.** Célula de segmentado tem
        largura dividida, não natural: em 384dp × fonte 1,3 "Transferência" pede mais que a célula
        e o Android partia a palavra ("Transferênci/a"). Quebrar a linha mudaria a altura de uma
        célula só. É o que o `UISegmentedControl` do iOS faz: a fonte desce até caber, com piso.
      */}
      <Animated.Text
        allowFontScaling
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
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
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
  peca: {
    position: 'absolute',
    top: FOLGA,
    left: FOLGA,
    transformOrigin: 'left',
  },
  polegarVidro: { position: 'absolute', top: FOLGA, left: FOLGA },
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
