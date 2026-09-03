import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

export interface QuickAction {
  label: string;
  icon: SymbolViewProps['name'];
  onPress: () => void;
  /**
   * Quantas coisas esperam por esta ação.
   *
   * **Não é enfeite: é o que decide se o atalho existe.** Um tile com contagem zero é um botão
   * morto ocupando o espaço mais caro do app, e a faixa cheia de botões mortos é a falha mais
   * comum de home de banco — o grid é preenchido por simetria, não por uso.
   */
  count: number;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function Tile({ action }: { action: QuickAction }) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${action.label}, ${action.count}`}
      onPressIn={() => scale.set(withTiming(Motion.pressScale, { duration: Motion.duration.fast }))}
      onPressOut={() => scale.set(withTiming(1, { duration: Motion.duration.fast }))}
      onPress={() => {
        Haptics.selectionAsync();
        action.onPress();
      }}
      style={[
        styles.tile,
        {
          borderColor: theme.heroSeparator,
          backgroundColor: theme.heroSeparator,
        },
        animated,
      ]}>
      <View style={styles.head}>
        <Icon name={action.icon} size="md" color="onHero" />
        <ThemedText type="caption" themeColor="onHero" style={[styles.count, tabular]}>
          {action.count}
        </ThemedText>
      </View>
      <ThemedText type="caption" themeColor="onHeroMuted" numberOfLines={1}>
        {action.label}
      </ThemedText>
    </AnimatedPressable>
  );
}

/**
 * A faixa de atalhos dentro do painel de destaque.
 *
 * É a adaptação do grid de ações rápidas dos apps de banco — e é uma **adaptação**, não uma
 * cópia. Naquele contexto as quatro ações são verbos de dinheiro (Pix, pagar, transferir), e o
 * app é a superfície onde o dinheiro se move. Aqui o dinheiro não se move: o app **registra** o
 * que já aconteceu, e o registro entra pelo WhatsApp. Repetir aquele grid daria botões que ou
 * abrem formulário manual (competindo com a proposta do produto) ou navegam para destinos que a
 * tab bar já cobre.
 *
 * Então os tiles são **decisões pendentes**, não destinos: confirmar, revisar, pagar, adiar —
 * cada um com a contagem do que espera. Sem nada pendente, a faixa inteira não aparece, e o
 * painel fica só com o número. Num dia tranquilo é essa a leitura certa da tela.
 */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  const vivos = actions.filter((a) => a.count > 0);
  if (vivos.length === 0) return null;

  return (
    <View style={styles.row}>
      {vivos.map((action) => (
        <Tile key={action.label} action={action} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  tile: {
    flex: 1,
    gap: Space.xs,
    paddingVertical: Space.md,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  count: {
    fontWeight: '700',
  },
});
