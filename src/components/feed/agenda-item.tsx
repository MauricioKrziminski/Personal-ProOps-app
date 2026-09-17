import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { CardFace } from '@/components/finance/card-face';
import { PressableScale } from '@/components/motion/pressable-scale';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import type { ThemeColor } from '@/constants/theme';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { Tom } from '@/lib/today-sections';

const COR_DA_META: Record<Tom, ThemeColor> = {
  danger: 'danger',
  warning: 'warning',
  success: 'success',
  neutral: 'textSecondary',
};

/** Uma instância só: `LinearTransition` recriado a cada render remonta a animação. */
const linear = LinearTransition.duration(Motion.duration.base);

export interface AgendaItemProps {
  title: string;
  meta: string;
  metaTone: Tom;
  cents: number;
  valueTone: 'danger' | 'success' | 'text';
  icon: IconName;
  /** Compra no cartão: a minifase do emissor no lugar do ícone (cor do banco DENTRO do cartão). */
  cartao?: string | null;
  action?: { label: string; icon: IconName; onPress: () => void };
  onPress?: () => void;
}

/**
 * Um compromisso da agenda: conta, fatura, prestação, entrada ou compra que vai postar.
 *
 * ⚠️ **`Animated.View` POR FORA do tocável** — `createAnimatedComponent(Pressable)` não aplica
 * estilo em função, e a linha já virou coluna por isso (ver o histórico da Hoje).
 *
 * ⚠️ **Botão dentro de card tocável vira ação de acessibilidade do card**: o leitor de tela não
 * alcança botão dentro de botão.
 */
export function AgendaItem({ title, meta, metaTone, cents, valueTone, icon, cartao, action, onPress }: AgendaItemProps) {
  const theme = useTheme();

  const corpo = (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      <View style={styles.linha}>
        {cartao ? (
          <CardFace nome={cartao} largura={36} style={styles.mini} />
        ) : (
          <View style={[styles.selo, { backgroundColor: theme.backgroundElement }]}>
            <Icon name={icon} size="sm" color="text" />
          </View>
        )}
        <View style={styles.textos}>
          <ThemedText type="headline">{title}</ThemedText>
          <ThemedText type="caption" themeColor={COR_DA_META[metaTone]}>
            {meta}
          </ThemedText>
        </View>
        <Money cents={cents} variant="ticker" tone={valueTone} />
      </View>
      {action ? (
        <View style={styles.acao}>
          <Button label={action.label} icon={action.icon} size="sm" variant="secondary" onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );

  return (
    <Animated.View layout={linear} exiting={FadeOut.duration(Motion.duration.exit)}>
      {onPress ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${meta}`}
          accessibilityActions={action ? [{ name: 'activate' }, { name: 'acao', label: action.label }] : undefined}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'acao') action?.onPress();
            else onPress();
          }}
          onPress={onPress}>
          {corpo}
        </PressableScale>
      ) : (
        corpo
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  // `flexWrap` + `minWidth` nos textos: o valor desce de linha antes de o título partir (lição do `Row`).
  linha: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Space.md },
  selo: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mini: { flexShrink: 0 },
  textos: { flexGrow: 1, flexShrink: 1, minWidth: 134, gap: Space.half },
  acao: { flexDirection: 'row', justifyContent: 'flex-end' },
});
