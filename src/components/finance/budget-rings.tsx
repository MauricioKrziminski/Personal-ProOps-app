import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/motion/pressable-scale';
import { useBRL } from '@/components/ui/conceal';
import { RingGauge } from '@/components/ui/ring-gauge';
import { Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { OrcamentoApertado } from '@/lib/budget-tight';

/**
 * Orçamentos no limite como anéis numa fileira que rola na horizontal — Hoje e Financeiro.
 *
 * O anel mostra o GASTO (o número da tela); a cor mostra o AVISO, que conta o comprometido
 * (`finance.md`). Um toque abre Orçamentos.
 */
export function BudgetRings({ itens, onPress }: { itens: readonly OrcamentoApertado[]; onPress: () => void }) {
  const theme = useTheme();
  const brl = useBRL();
  return (
    <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fileira}>
      {itens.map((o) => {
        const pct = Math.round(o.fracaoGasta * 100);
        return (
          <PressableScale
            key={o.categoria}
            haptic="selection"
            accessibilityRole="button"
            accessibilityLabel={`${o.categoria}, ${pct}% do limite de ${brl(o.limite)}`}
            onPress={onPress}
            style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
            <RingGauge value={o.fracaoGasta} size={64} stroke={7} tone={o.estourou ? 'danger' : 'warning'}>
              <ThemedText type="code" style={tabular}>{`${pct}%`}</ThemedText>
            </RingGauge>
            <View style={styles.textos}>
              <ThemedText type="headline">{o.categoria}</ThemedText>
              <ThemedText type="caption" themeColor={o.restante < 0 ? 'danger' : 'textSecondary'}>
                {o.restante < 0 ? `${brl(-o.restante)} acima` : `${brl(o.restante)} restantes`}
              </ThemedText>
            </View>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fileira: { gap: Space.md, paddingRight: Space.lg },
  card: {
    width: 148,
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  textos: { gap: Space.half },
});
