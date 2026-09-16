import { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';

import { Motion, Radius } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * O glifo do estado vazio: um painel 2×2 de azulejos.
 *
 * É a mesma linguagem do campo de azulejos (quarto de círculo, quadrado), só que parada e em
 * tamanho de ícone — o lugar vazio ganha a assinatura do app em vez de um desenho genérico. Um
 * dos quatro é azul: é o "comece por aqui" da tela.
 *
 * Ao aparecer, cada peça assenta com um quarto de volta, uma depois da outra. Estado vazio é
 * raro, então o gesto cabe (§5: delight só onde é raro).
 */
export function TileGlyph({ size = 22 }: { size?: number }) {
  const theme = useTheme();
  const quarto = (canto: keyof ViewStyle): ViewStyle => ({ [canto]: size }) as ViewStyle;
  const pecas: { forma: ViewStyle; cor: string }[] = [
    { forma: quarto('borderTopLeftRadius'), cor: theme.textSecondary },
    { forma: { borderRadius: Radius.xs }, cor: theme.tintFill },
    { forma: { borderRadius: Radius.xs }, cor: theme.backgroundSelected },
    { forma: quarto('borderBottomRightRadius'), cor: theme.textSecondary },
  ];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.grade, { width: size * 2 + 2 }]}>
      {pecas.map((p, i) => (
        <Peca key={i} indice={i} size={size} forma={p.forma} cor={p.cor} />
      ))}
    </View>
  );
}

function Peca({
  indice,
  size,
  forma,
  cor,
}: {
  indice: number;
  size: number;
  forma: ViewStyle;
  cor: string;
}) {
  const reduzido = useReducedMotion();
  const t = useSharedValue(reduzido ? 1 : 0);
  useEffect(() => {
    if (reduzido) return;
    t.set(withDelay(indice * 70, withSpring(1, Motion.spring.encaixe)));
  }, [indice, reduzido, t]);
  const estilo = useAnimatedStyle(() => ({
    opacity: Math.min(1, t.get() * 1.4),
    transform: [{ rotate: `${(1 - t.get()) * -90}deg` }, { scale: 0.6 + t.get() * 0.4 }],
  }));
  return (
    <Animated.View style={[{ width: size, height: size, backgroundColor: cor }, forma, estilo]} />
  );
}

const styles = StyleSheet.create({
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
});
