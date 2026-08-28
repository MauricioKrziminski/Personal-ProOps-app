import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { Chip } from '@/components/finance/chip';
import { MoneyInput } from '@/components/finance/money-input';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import {
  useAffordability,
  useCashFlowForecast,
  useMarkPaid,
  useUpcomingBills,
  type ForecastDay,
} from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

const HORIZONS = [
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
  { days: 180, label: '6 meses' },
] as const;

const SIM_INSTALLMENTS = [1, 3, 6, 10, 12] as const;

/**
 * Gráfico de linha em Views puras (mesmo princípio do CashflowChart do
 * dashboard): cada dia vira uma coluna cuja altura é o saldo normalizado.
 * Coluna abaixo da linha do zero = saldo negativo.
 */
function BalanceChart({ days, danger, tint, track }: {
  days: ForecastDay[];
  danger: string;
  tint: string;
  track: string;
}) {
  const { max, min } = useMemo(() => {
    const valores = days.map((d) => Number(d.balance_cents));
    return { max: Math.max(...valores, 0), min: Math.min(...valores, 0) };
  }, [days]);
  const amplitude = max - min || 1;
  // linha do zero dentro da altura do gráfico
  const zeroRatio = max / amplitude;

  return (
    <View style={styles.chart}>
      <View style={[styles.zeroLine, { bottom: `${zeroRatio * 100}%`, backgroundColor: track }]} />
      <View style={styles.chartBars}>
        {days.map((d) => {
          const valor = Number(d.balance_cents);
          const altura = (Math.abs(valor) / amplitude) * 100;
          const negativo = valor < 0;
          return (
            <View key={d.day} style={styles.chartCol}>
              <View
                style={[
                  styles.chartBar,
                  {
                    height: `${Math.max(altura, 0.5)}%`,
                    backgroundColor: negativo ? danger : tint,
                    [negativo ? 'top' : 'bottom']: `${zeroRatio * 100}%`,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function ForecastScreen() {
  const theme = useTheme();
  const [days, setDays] = useState<number>(90);
  const [simCents, setSimCents] = useState(0);
  const [simParcelas, setSimParcelas] = useState(1);

  const forecast = useCashFlowForecast(days);
  const bills = useUpcomingBills(30);
  const sim = useAffordability(simCents, simParcelas);
  const markPaid = useMarkPaid();

  // memo próprio: `forecast.data ?? []` cria array novo a cada render e
  // invalidaria os useMemo abaixo sem parar
  const serie = useMemo(() => forecast.data ?? [], [forecast.data]);
  const hoje = serie[0];
  const fim = serie[serie.length - 1];
  const pior = useMemo(
    () =>
      serie.length
        ? serie.reduce((min, d) =>
            Number(d.balance_cents) < Number(min.balance_cents) ? d : min,
          )
        : null,
    [serie],
  );
  const vaiFicarNegativo = pior ? Number(pior.balance_cents) < 0 : false;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {forecast.isError && <ErrorCard onRetry={forecast.refetch} />}
          {forecast.isLoading && !forecast.isError && <LoadingCard />}

          {serie.length > 0 && (
            <>
              <Animated.View entering={FadeInDown.duration(400)}>
                <GlassCard style={styles.resumo}>
                  <View style={styles.chipRow}>
                    {HORIZONS.map((h) => (
                      <Chip
                        key={h.days}
                        label={h.label}
                        selected={days === h.days}
                        onPress={() => setDays(h.days)}
                      />
                    ))}
                  </View>

                  <ThemedText type="small" themeColor="textSecondary">
                    Saldo hoje
                  </ThemedText>
                  <ThemedText type="subtitle">
                    {formatBRL(Number(hoje?.balance_cents ?? 0))}
                  </ThemedText>

                  <BalanceChart
                    days={serie}
                    danger={theme.danger}
                    tint={theme.tint}
                    track={theme.backgroundElement}
                  />

                  <View style={styles.linha}>
                    <ThemedText type="small" themeColor="textSecondary">
                      hoje
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {fim ? formatDateBR(fim.day) : ''}
                    </ThemedText>
                  </View>

                  <ThemedText type="smallBold">
                    Em {formatDateBR(fim?.day ?? '')}: {formatBRL(Number(fim?.balance_cents ?? 0))}
                  </ThemedText>
                  {pior && (
                    <ThemedText
                      type="small"
                      style={{ color: vaiFicarNegativo ? theme.danger : theme.textSecondary }}>
                      {vaiFicarNegativo
                        ? `⚠️ Fica negativo em ${formatDateBR(pior.day)} (${formatBRL(Number(pior.balance_cents))})`
                        : `Menor saldo do período: ${formatBRL(Number(pior.balance_cents))} em ${formatDateBR(pior.day)}`}
                    </ThemedText>
                  )}
                </GlassCard>
              </Animated.View>

              <Animated.View entering={FadeInDown.duration(400).delay(60)}>
                <GlassCard style={styles.simulador}>
                  <ThemedText type="smallBold">Posso comprar isso?</ThemedText>
                  <MoneyInput valueCents={simCents} onChangeCents={setSimCents} />
                  <View style={styles.chipRow}>
                    {SIM_INSTALLMENTS.map((n) => (
                      <Chip
                        key={n}
                        label={n === 1 ? 'À vista' : `${n}x`}
                        selected={simParcelas === n}
                        onPress={() => setSimParcelas(n)}
                      />
                    ))}
                  </View>
                  {simCents > 0 && sim.data && (
                    <ThemedText
                      type="small"
                      style={{ color: sim.data.can_afford ? theme.success : theme.danger }}>
                      {sim.data.can_afford
                        ? `✅ Dá para pagar. Saldo mais apertado: ${formatBRL(Number(sim.data.worst_balance_cents))} em ${formatDateBR(sim.data.worst_day)}.`
                        : `⚠️ Aperta: você fica em ${formatBRL(Number(sim.data.worst_balance_cents))} no dia ${formatDateBR(sim.data.worst_day)}.`}
                    </ThemedText>
                  )}
                  {simCents > 0 && simParcelas > 1 && sim.data && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {simParcelas}x de {formatBRL(Number(sim.data.installment_cents))}
                    </ThemedText>
                  )}
                  {simCents === 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      Digite um valor para simular contra a sua projeção real.
                    </ThemedText>
                  )}
                </GlassCard>
              </Animated.View>
            </>
          )}

          {(bills.data ?? []).length > 0 && (
            <Animated.View entering={FadeInDown.duration(400).delay(120)}>
              <GlassCard style={styles.contas}>
                <ThemedText type="smallBold">📅 A pagar nos próximos 30 dias</ThemedText>
                {(bills.data ?? []).map((bill) => (
                  <View key={`${bill.kind}-${bill.ref_id}`} style={styles.contaRow}>
                    <View style={styles.contaTexto}>
                      <ThemedText type="small" numberOfLines={1}>
                        {bill.overdue ? '🔴 ' : ''}
                        {bill.title}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {bill.overdue ? 'venceu ' : 'vence '}
                        {formatDateBR(bill.due_date)}
                      </ThemedText>
                    </View>
                    <ThemedText type="smallBold">{formatBRL(Number(bill.amount_cents))}</ThemedText>
                    {bill.kind === 'transaction' && (
                      <Pressable
                        hitSlop={8}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          markPaid.mutate({ id: bill.ref_id, paidAt: localISODate() });
                        }}
                        style={({ pressed }) => [
                          styles.pagar,
                          { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.6 : 1 },
                        ]}>
                        <ThemedText type="small">paguei</ThemedText>
                      </Pressable>
                    )}
                  </View>
                ))}
              </GlassCard>
            </Animated.View>
          )}

          {!forecast.isLoading && !forecast.isError && serie.length === 0 && (
            <GlassCard style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>🔮</ThemedText>
              <ThemedText type="smallBold">Nada para projetar ainda</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                Cadastre suas contas e diga no WhatsApp{'\n'}
                “todo dia 5 pago 1200 de aluguel”.{'\n\n'}
                A partir daí eu mostro quanto sobra{'\n'}em cada dia do mês.
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
  simulador: {
    gap: Spacing.three,
  },
  contas: {
    gap: Spacing.two,
  },
  chart: {
    height: 120,
    marginVertical: Spacing.two,
    justifyContent: 'flex-end',
  },
  zeroLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
  chartBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: '100%',
    gap: 1,
  },
  chartCol: {
    flex: 1,
    height: '100%',
  },
  chartBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: 1,
  },
  linha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  contaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  contaTexto: {
    flex: 1,
    gap: Spacing.half,
  },
  pagar: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
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
