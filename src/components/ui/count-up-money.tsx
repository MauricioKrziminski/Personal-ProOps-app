import { useEffect, useRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Money } from '@/components/ui/money';
import { useConceal } from '@/components/ui/conceal';
import { type ThemeColor } from '@/constants/theme';
import { Motion, Type, tabular, type TypeVariant } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { brlWorklet } from '@/lib/brl-worklet';
import { formatBRL } from '@/lib/dates';

const AnimatedInput = Animated.createAnimatedComponent(TextInput);

/**
 * Acima disto o valor é desenhado por `<Money>`, sem animação.
 *
 * ⚠️ `TextInput` não tem `adjustsFontSizeToFit`, e o painel tem `overflow: 'hidden'`. A 384dp
 * com fonte 1,3× um valor de 8 dígitos seria **CORTADO** — que é pior que estourar a caixa (§7:
 * identificador não trunca). 13 glifos é `−R$ 999.999,99`.
 */
const MAX_GLIFOS = 13;

/**
 * O número grande do herói contando até o valor novo.
 *
 * ## Anima na MUDANÇA, nunca na montagem
 *
 * ⚠️ Contar de zero ao abrir escreveria **"R$ 0,00" no primeiro quadro** — um valor que não é
 * verdade, no lugar mais nobre da tela, e justamente o tipo de número que o painel já se recusa
 * a mostrar. Na montagem quem entra é o `translateY` do container (§5: continuidade); aqui o
 * valor nasce pronto.
 *
 * Na mudança, §5 manda o contrário, e com todas as letras: *"barra de progresso e gráfico
 * **animam** quando o valor muda — valor que salta é bug visual"*. Dar baixa numa conta muda o
 * número, e a animação é o que liga a ação ao efeito.
 *
 * ## Por que é um `TextInput`
 *
 * ⚠️ **É a única forma.** `text` é uma prop ANIMÁVEL do `TextInput`; o conteúdo de um `<Text>`
 * não é — animá-lo exigiria um `setState` por quadro, na thread de JS, que é exatamente o que o
 * Reanimated existe para evitar. Ele nasce `editable={false}`, sem foco e escondido do leitor de
 * tela: quem fala é a `View` em volta, com o valor FINAL.
 *
 * `tabular-nums` sobrevive (o `TextInput` aceita `fontVariant`), e sem ele os dígitos mudariam
 * de largura a cada quadro — o número "dançaria" enquanto conta.
 */
export function CountUpMoney({
  cents,
  variant = 'heroMoney',
  tone = 'onHero',
  concealable = true,
}: {
  cents: number;
  variant?: TypeVariant;
  tone?: ThemeColor;
  concealable?: boolean;
}) {
  const theme = useTheme();
  const { concealed } = useConceal();
  const reduzido = useReducedMotion();
  const valor = useSharedValue(cents);
  const montado = useRef(false);

  useEffect(() => {
    if (!montado.current) {
      montado.current = true;
      valor.value = cents;
      return;
    }
    valor.value = reduzido
      ? cents
      : withTiming(cents, { duration: Motion.duration.slow, easing: Motion.easing.out });
  }, [cents, reduzido, valor]);

  const texto = useDerivedValue(() => brlWorklet(valor.value));
  // `defaultValue` junto de `text` é obrigatório no Fabric: sem ele o primeiro quadro sai vazio.
  const animado = useAnimatedProps(() => ({ text: texto.value, defaultValue: texto.value }));

  const oculto = concealable && concealed;
  const largo = formatBRL(Math.abs(cents)).length + (cents < 0 ? 1 : 0) > MAX_GLIFOS;

  if (oculto || reduzido || largo) {
    return <Money cents={cents} variant={variant} tone={tone} concealable={concealable} />;
  }

  return (
    <View accessible accessibilityLabel={formatBRL(cents)}>
      <AnimatedInput
        editable={false}
        pointerEvents="none"
        underlineColorAndroid="transparent"
        accessibilityElementsHidden
        importantForAccessibility="no"
        animatedProps={animado}
        style={[Type[variant], tabular, styles.campo, { color: theme[tone] }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  /*
    `TextInput` traz padding e altura de linha próprios em cada plataforma. Zerar os três é o que
    faz ele ocupar exatamente a caixa que um `<Text>` ocuparia — sem isso o número desalinha do
    rótulo acima dele, e só no Android.
  */
  campo: { padding: 0, margin: 0, includeFontPadding: false, textAlignVertical: 'center' },
});
