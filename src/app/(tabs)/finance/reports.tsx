import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { Chip } from '@/components/finance/chip';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { formatBRL, localISODate } from '@/hooks/use-items';
import { useAnnualReport, type AnnualCategoryRow, type YearEndBalance } from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

/** Valor em reais com ponto decimal — formato que planilha e IR aceitam. */
function reais(cents: number): string {
  return (cents / 100).toFixed(2);
}

function montaCsv(
  ano: number,
  categorias: AnnualCategoryRow[],
  saldos: YearEndBalance[],
): string {
  const linhas = [
    `Relatorio anual ${ano}`,
    '',
    'Tipo;Categoria;Total;Lancamentos',
    ...categorias.map(
      (c) =>
        `${c.kind === 'income' ? 'Receita' : 'Despesa'};${c.category};${reais(Number(c.total_cents))};${c.tx_count}`,
    ),
    '',
    `Saldos em 31/12/${ano}`,
    'Tipo;Nome;Valor',
    ...saldos.map(
      (s) => `${s.kind === 'account' ? 'Conta' : 'Bem'};${s.name};${reais(Number(s.balance_cents))}`,
    ),
  ];
  return linhas.join('\n');
}

export default function ReportsScreen() {
  const theme = useTheme();
  const anoAtual = Number(localISODate().slice(0, 4));
  const [ano, setAno] = useState(anoAtual);
  const { data, isLoading, isError, refetch } = useAnnualReport(ano);

  const anos = useMemo(
    () => [anoAtual, anoAtual - 1, anoAtual - 2],
    [anoAtual],
  );

  const receitas = (data?.categories ?? []).filter((c) => c.kind === 'income');
  const despesas = (data?.categories ?? []).filter((c) => c.kind === 'expense');
  const maiorDespesa = Math.max(...despesas.map((d) => Number(d.total_cents)), 1);

  const exportar = async () => {
    if (!data) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // share sheet com o CSV inline: sem servidor, sem arquivo temporário
    await Share.share({
      title: `Relatorio ${ano}`,
      message: montaCsv(ano, data.categories, data.yearEnd),
    });
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          <View style={styles.chipRow}>
            {anos.map((a) => (
              <Chip key={a} label={String(a)} selected={ano === a} onPress={() => setAno(a)} />
            ))}
          </View>

          {isError && <ErrorCard onRetry={refetch} />}
          {isLoading && !isError && <LoadingCard />}

          {data?.summary && (
            <Animated.View entering={FadeInDown.duration(400)}>
              <GlassCard style={styles.resumo}>
                <ThemedText type="smallBold">{ano} em números</ThemedText>
                <View style={styles.linha}>
                  <ThemedText type="small" themeColor="textSecondary">
                    💰 Recebido
                  </ThemedText>
                  <ThemedText type="small" style={{ color: theme.success }}>
                    {formatBRL(Number(data.summary.income_cents))}
                  </ThemedText>
                </View>
                <View style={styles.linha}>
                  <ThemedText type="small" themeColor="textSecondary">
                    💸 Gasto
                  </ThemedText>
                  <ThemedText type="small" style={{ color: theme.danger }}>
                    {formatBRL(Number(data.summary.expense_cents))}
                  </ThemedText>
                </View>
                <View style={styles.linha}>
                  <ThemedText type="smallBold">Sobrou</ThemedText>
                  <ThemedText
                    type="smallBold"
                    style={{
                      color: Number(data.summary.balance_cents) < 0 ? theme.danger : theme.text,
                    }}>
                    {formatBRL(Number(data.summary.balance_cents))}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  Taxa de poupança: {data.summary.savings_rate}% · {data.summary.tx_count}{' '}
                  lançamentos
                </ThemedText>
              </GlassCard>
            </Animated.View>
          )}

          {despesas.length > 0 && (
            <GlassCard style={styles.resumo}>
              <ThemedText type="smallBold">Gastos por categoria</ThemedText>
              {despesas.slice(0, 12).map((c) => (
                <View key={c.category} style={styles.categoria}>
                  <View style={styles.linha}>
                    <ThemedText type="small">{c.category}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatBRL(Number(c.total_cents))}
                    </ThemedText>
                  </View>
                  <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
                    <View
                      style={[
                        styles.fill,
                        {
                          backgroundColor: theme.tint,
                          width: `${Math.max((Number(c.total_cents) / maiorDespesa) * 100, 3)}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
              ))}
            </GlassCard>
          )}

          {receitas.length > 0 && (
            <GlassCard style={styles.resumo}>
              <ThemedText type="smallBold">Receitas por origem</ThemedText>
              {receitas.map((c) => (
                <View key={c.category} style={styles.linha}>
                  <ThemedText type="small">{c.category}</ThemedText>
                  <ThemedText type="small" style={{ color: theme.success }}>
                    {formatBRL(Number(c.total_cents))}
                  </ThemedText>
                </View>
              ))}
            </GlassCard>
          )}

          {(data?.yearEnd ?? []).length > 0 && (
            <GlassCard style={styles.resumo}>
              <ThemedText type="smallBold">Saldos em 31/12/{ano}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                É o que a ficha “Bens e Direitos” da declaração pede.
              </ThemedText>
              {(data?.yearEnd ?? []).map((s) => (
                <View key={`${s.kind}-${s.name}`} style={styles.linha}>
                  <ThemedText type="small">
                    {s.kind === 'account' ? '🏦' : '📈'} {s.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatBRL(Number(s.balance_cents))}
                  </ThemedText>
                </View>
              ))}
            </GlassCard>
          )}

          {data && (data.categories.length > 0 || data.yearEnd.length > 0) && (
            <Pressable
              onPress={exportar}
              style={({ pressed }) => [
                styles.submit,
                { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.buttonLabel}>
                Exportar CSV
              </ThemedText>
            </Pressable>
          )}

          {!isLoading && !isError && data?.categories.length === 0 && (
            <GlassCard style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>📊</ThemedText>
              <ThemedText type="smallBold">Sem lançamentos em {ano}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                Escolha outro ano ou comece a registrar{'\n'}pelo WhatsApp.
              </ThemedText>
            </GlassCard>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    width: '100%',
  },
  scroll: {
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  resumo: {
    gap: Spacing.one,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoria: {
    gap: Spacing.half,
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  submit: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  buttonLabel: {
    color: '#fff',
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
  emptyEmoji: {
    fontSize: 40,
  },
  centered: {
    textAlign: 'center',
  },
});
