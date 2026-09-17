import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { DonutChart, TONS_DA_ROSCA } from '@/components/ui/donut-chart';
import { Money } from '@/components/ui/money';
import { CHAVE_OUTRAS, fatias } from '@/design/donut-math';
import { Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

export type CategoriaDoMes = {
  categoria: string;
  total: number;
  /** "+12% vs agosto", "não teve em agosto"… nulo enquanto o mês anterior não chegou. */
  comparacao: string | null;
  tom: 'warning' | 'success' | 'textSecondary';
};

/**
 * "Para onde foi": a rosca com o total no centro e a lista embaixo, as duas falando da MESMA
 * soma (o percentual divide pelo total das linhas — `finance.md`).
 *
 * Tocar na rosca seleciona e escreve a fatia no centro; tocar numa linha abre os lançamentos da
 * categoria, como antes.
 */
export function SpendingDonut({
  itens,
  onOpenCategory,
  onOpenAll,
}: {
  itens: readonly CategoriaDoMes[];
  onOpenCategory: (categoria: string) => void;
  onOpenAll: () => void;
}) {
  const theme = useTheme();
  const lista = useMemo(() => fatias(itens.map((i) => ({ chave: i.categoria, valor: i.total }))), [itens]);
  const total = itens.reduce((s, i) => s + i.total, 0);
  const [selecionada, setSelecionada] = useState(-1);
  const atual = selecionada >= 0 ? lista[selecionada] : null;
  const nome = (chave: string) => (chave === CHAVE_OUTRAS ? 'Outras' : chave);
  const pct = (valor: number) => (total > 0 ? Math.round((valor / total) * 100) : 0);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      <View style={styles.rosca}>
        <DonutChart
          fatias={lista}
          selecionada={selecionada}
          onSelect={(i) => {
            if (i >= 0) Haptics.selectionAsync();
            setSelecionada((s) => (i === s ? -1 : i));
          }}>
          <ThemedText type="caption" themeColor="textSecondary">
            {atual ? nome(atual.chave) : 'Total'}
          </ThemedText>
          <Money cents={atual ? atual.valor : total} variant="headline" />
          {atual ? (
            <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
              {`${pct(atual.valor)}%`}
            </ThemedText>
          ) : null}
        </DonutChart>
      </View>

      <View>
        {lista.map((f, i) => {
          const item = itens.find((x) => x.categoria === f.chave);
          const outras = f.chave === CHAVE_OUTRAS;
          return (
            <Pressable
              key={f.chave}
              accessibilityRole="button"
              accessibilityLabel={`${nome(f.chave)}, ${pct(f.valor)}% dos gastos${item?.comparacao ? `, ${item.comparacao}` : ''}`}
              onPress={() => (outras ? onOpenAll() : onOpenCategory(f.chave))}>
              {({ pressed }) => (
                <View
                  style={[
                    styles.linha,
                    {
                      backgroundColor: pressed
                        ? theme.backgroundSelected
                        : i === selecionada
                          ? theme.backgroundElement
                          : 'transparent',
                    },
                  ]}>
                  <View style={[styles.amostra, { backgroundColor: theme[TONS_DA_ROSCA[f.tom]], borderColor: theme.separator }]} />
                  <View style={styles.textos}>
                    <ThemedText type="default">{nome(f.chave)}</ThemedText>
                    {item?.comparacao ? (
                      <ThemedText type="caption" themeColor={item.tom} style={tabular}>
                        {item.comparacao}
                      </ThemedText>
                    ) : null}
                  </View>
                  <View style={styles.direita}>
                    <Money cents={f.valor} variant="ticker" />
                    <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
                      {`${pct(f.valor)}%`}
                    </ThemedText>
                  </View>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingTop: Space.xl,
    paddingBottom: Space.sm,
    gap: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
  },
  rosca: { alignItems: 'center' },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
  },
  amostra: { width: 12, height: 12, borderRadius: Radius.pill, borderWidth: 1 },
  textos: { flexGrow: 1, flexShrink: 1, minWidth: 134, gap: 2 },
  direita: { alignItems: 'flex-end', gap: 2, marginLeft: 'auto' },
});
