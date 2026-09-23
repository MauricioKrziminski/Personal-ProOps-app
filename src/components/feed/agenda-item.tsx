import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

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
import { transicaoDeLayout } from '@/components/motion/transicao';

const COR_DA_META: Record<Tom, ThemeColor> = {
  danger: 'danger',
  warning: 'warning',
  success: 'success',
  neutral: 'textSecondary',
};

const linear = transicaoDeLayout;

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
      {cartao ? (
        <CardFace nome={cartao} largura={36} style={styles.mini} />
      ) : (
        <View style={[styles.selo, { backgroundColor: theme.backgroundElement }]}>
          <Icon name={icon} size="sm" color="text" />
        </View>
      )}
      <View style={styles.coluna}>
        {/* Título e valor na mesma linha; sem espaço, o valor desce — o título nunca parte (§3). */}
        <View style={styles.topo}>
          <ThemedText type="headline" style={styles.titulo}>
            {title}
          </ThemedText>
          <View style={styles.valor}>
            <Money cents={cents} variant="ticker" tone={valueTone} />
          </View>
        </View>
        {/* O estado à esquerda e a ação que o resolve à direita, na mesma linha. */}
        <View style={styles.base}>
          <ThemedText type="caption" themeColor={COR_DA_META[metaTone]}>
            {meta}
          </ThemedText>
          {action ? (
            <View style={styles.valor}>
              <Button label={action.label} icon={action.icon} size="sm" variant="secondary" onPress={action.onPress} />
            </View>
          ) : null}
        </View>
      </View>
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  selo: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mini: { flexShrink: 0, marginTop: Space.xs },
  coluna: { flex: 1, minWidth: 0, gap: Space.xs },
  topo: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: Space.md, rowGap: Space.half },
  titulo: { flexShrink: 0, maxWidth: '100%' },
  // `marginLeft: auto` mantém o valor e a ação encostados à direita mesmo quando descem de linha.
  valor: { marginLeft: 'auto' },
  base: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: Space.md, rowGap: Space.sm, minHeight: 36 },
});
