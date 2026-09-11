import { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { Elevation, HitTarget, Motion, Radius, Space } from '@/design/tokens';
import { useTheme, useScheme } from '@/hooks/use-theme';

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
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const theme = useTheme();
  const scheme = useScheme();
  const [width, setWidth] = useState(0);

  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const slot = width > 0 ? (width - 4) / options.length : 0;

  const thumb = useAnimatedStyle(() => ({
    width: slot,
    transform: [{ translateX: withSpring(index * slot, Motion.spring.snap) }],
  }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View
      accessibilityRole="tablist"
      onLayout={onLayout}
      style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
      {slot > 0 ? (
        <Animated.View
          style={[
            styles.thumb,
            thumb,
            { backgroundColor: theme.surface, boxShadow: Elevation[scheme].raised },
          ]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) return;
              Haptics.selectionAsync();
              onChange(option.value);
            }}
            style={styles.option}>
            <ThemedText
              type={selected ? 'smallBold' : 'small'}
              themeColor={selected ? 'text' : 'textSecondary'}
>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: 2,
    borderRadius: Radius.xs,
    borderCurve: 'continuous',
  },
  thumb: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 2,
    borderRadius: Radius.xs - 2,
    borderCurve: 'continuous',
  },
  option: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Space.sm,
    // Respiro lateral: sem ele o rótulo encosta na borda da célula e, com fonte grande, quebra
    // no meio da palavra. O rótulo não trunca mais (design.md §7), então a célula é que precisa
    // ter onde crescer — quem dá a largura é o `minWidth` de quem usa o controle.
    paddingHorizontal: Space.xs,
    minHeight: 32,
    /*
      ⚠️ **Piso de largura, senão o controle SOME quando o pai é uma linha.**

      `flex: 1` no React Native é `flexBasis: 0`, então a largura NATURAL da trilha é a soma das
      células: zero. Num pai `column` isso não aparece (o filho estica), mas dentro de um
      `flexDirection: 'row'` a trilha inteira colapsa para os 4pt do padding — uma lasquinha
      branca vertical, sem erro nenhum no log. Foi exatamente o que apareceu no Financeiro
      ("que toggle é esse no iOS?? eu nem tinha visto isso"): o `Mês | Ciclo` estava lá,
      desenhado com 4pt de largura, ao lado do seletor de mês.

      44 é o alvo de toque mínimo que design.md §11 já exige — o piso não é um número escolhido
      para este bug, é a regra que o controle não estava cumprindo.
    */
    minWidth: HitTarget,
  },
});
