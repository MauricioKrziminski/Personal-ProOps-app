import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, router } from 'expo-router';
import Animated, {
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';

import { GlassCard } from '@/components/glass/glass-card';
import { monthLabel, shiftMonth } from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/ui/sparkline';
import { Motion, Radius, Space, Type, tabular } from '@/design/tokens';
import {
  useAccounts,
  useInstallmentPlans,
  type InstallmentPlanSummary,
} from '@/hooks/use-finance';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import { showItemActions } from '@/lib/item-actions';
import { useTheme } from '@/hooks/use-theme';

/**
 * Parceladas — "o que eu já comprometi nos próximos meses, e quanto falta para acabar?".
 *
 * Leitura pura: não se cria plano por aqui (parcelamento nasce da compra) e não se apaga
 * (apagar o plano faz cascade nas dez linhas do extrato).
 *
 * **A soma das parcelas bate com o total porque o resto da divisão inteira vai na última** —
 * por isso "por mês" é a parcela normal e a última pode ter alguns centavos a mais.
 */

const MESES_NA_FAIXA = 6;
const MESES_COMPROMETIDOS = 12;
const ALTURA_BARRA = 88;

/** `2026-08` → `ago.` */
function mesCurto(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short' });
}

/** Barra de um mês. Cresce da base com mola — valor que salta é bug visual. */
function Bar({ ratio, index, destaque }: { ratio: number; index: number; destaque: boolean }) {
  const theme = useTheme();
  const grow = useSharedValue(0);

  useEffect(() => {
    grow.set(withDelay(index * Motion.stagger.step, withSpring(ratio, Motion.spring.settle)));
  }, [grow, ratio, index]);

  const animado = useAnimatedStyle(() => ({
    height: Math.max(Space.xs, grow.get() * ALTURA_BARRA),
  }));

  return (
    <Animated.View
      style={[
        styles.bar,
        animado,
        { backgroundColor: destaque ? theme.tint : theme.backgroundElement },
      ]}
    />
  );
}

export default function InstallmentsScreen() {
  const theme = useTheme();
  const plans = useInstallmentPlans();
  const accounts = useAccounts();
  const [aberto, setAberto] = useState<string | null>(null);
  const [verTerminadas, setVerTerminadas] = useState(false);

  const contaPorId = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const conta of accounts.data ?? []) mapa.set(conta.id, conta.name);
    return mapa;
  }, [accounts.data]);

  const lista = plans.data ?? [];
  const emAndamento = useMemo(
    () =>
      (plans.data ?? [])
        .filter((p) => p.active)
        .sort((a, b) => b.remaining_cents - a.remaining_cents),
    [plans.data],
  );
  const terminadas = useMemo(() => (plans.data ?? []).filter((p) => !p.active), [plans.data]);

  /** Parcelas previstas por mês, do mês corrente para a frente. */
  const porMes = useMemo(() => {
    const mapa = new Map<string, number>();
    const hoje = localISODate().slice(0, 7);
    for (const plano of plans.data ?? []) {
      for (const parcela of plano.parcels) {
        if (parcela.status !== 'pending') continue;
        const mes = parcela.occurred_at.slice(0, 7);
        if (mes < hoje) continue;
        mapa.set(mes, (mapa.get(mes) ?? 0) + parcela.amount_cents);
      }
    }
    return mapa;
  }, [plans.data]);

  const faixa = useMemo(() => {
    const inicio = localISODate().slice(0, 7);
    return Array.from({ length: MESES_NA_FAIXA }, (_, i) => {
      const mes = shiftMonth(inicio, i);
      return { month: mes, cents: porMes.get(mes) ?? 0 };
    });
  }, [porMes]);

  const comprometido = useMemo(() => {
    const inicio = localISODate().slice(0, 7);
    const fim = shiftMonth(inicio, MESES_COMPROMETIDOS - 1);
    let total = 0;
    for (const [mes, cents] of porMes) if (mes >= inicio && mes <= fim) total += cents;
    return total;
  }, [porMes]);

  const ultimaParcela = useMemo(() => {
    let maior: string | null = null;
    for (const mes of porMes.keys()) if (!maior || mes > maior) maior = mes;
    return maior;
  }, [porMes]);

  const mesesComParcela = Array.from(porMes.values()).filter((c) => c > 0).length;
  const media = mesesComParcela > 0 ? Math.round(comprometido / Math.min(mesesComParcela, MESES_COMPROMETIDOS)) : 0;
  const maiorDaFaixa = Math.max(...faixa.map((f) => f.cents), 0);
  const temFaixa = maiorDaFaixa > 0;

  const acoes = (plano: InstallmentPlanSummary) => {
    const primeira = [...plano.parcels].sort((a, b) => (a.installment_no ?? 0) - (b.installment_no ?? 0))[0];
    showItemActions(plano.title, [
      {
        label: aberto === plano.id ? 'Esconder parcelas' : 'Ver parcelas',
        onPress: () => setAberto(aberto === plano.id ? null : plano.id),
      },
      ...(primeira
        ? [
            {
              label: 'Ver a primeira compra',
              onPress: () =>
                router.push({
                  pathname: '/finance/[txId]',
                  params: { txId: primeira.id, month: primeira.occurred_at.slice(0, 7) },
                }),
            },
          ]
        : []),
      ...(plano.account_id
        ? [{ label: 'Ver o cartão', onPress: () => router.push('/finance/cards') }]
        : []),
    ]);
  };

  const bloco = (plano: InstallmentPlanSummary, index: number) => {
    const conta = plano.account_id ? contaPorId.get(plano.account_id) : null;
    const expandido = aberto === plano.id;
    const parcelas = [...plano.parcels].sort(
      (a, b) => (a.installment_no ?? 0) - (b.installment_no ?? 0),
    );
    const atual = Math.min(plano.installments, plano.paid + 1);
    const resumo = plano.active
      ? `${atual} de ${plano.installments} · ${formatBRL(plano.installment_cents)} por mês`
      : `${plano.installments} de ${plano.installments} · quitada`;

    return (
      <Animated.View
        key={plano.id}
        layout={LinearTransition.duration(Motion.duration.base)}
        entering={FadeInDown.duration(Motion.duration.base).delay(
          Math.min(index * Motion.stagger.step, Motion.stagger.cap),
        )}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: expandido }}
          accessibilityLabel={`${plano.title}, parcela ${atual} de ${plano.installments}, ${formatBRL(plano.installment_cents)} por mês${plano.active ? `, faltam ${formatBRL(plano.remaining_cents)}` : ', quitada'}`}
          onPress={() => setAberto(expandido ? null : plano.id)}
          onLongPress={() => acoes(plano)}>
          {({ pressed }) => (
            <View
              style={[
                styles.plano,
                { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
              ]}>
              <View style={styles.planoTopo}>
                <ThemedText type="default" numberOfLines={1} style={styles.planoNome}>
                  {plano.title}
                </ThemedText>
                <View style={styles.planoValor}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {plano.active ? 'falta' : 'total'}
                  </ThemedText>
                  <Money
                    cents={plano.active ? plano.remaining_cents : plano.total_cents}
                    variant="headline"
                  />
                </View>
              </View>
              <ProgressBar
                value={plano.paid}
                max={plano.installments}
                tone={plano.active ? 'tint' : 'success'}
              />
              <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                {[resumo, conta, plano.category].filter(Boolean).join(' · ')}
              </ThemedText>
            </View>
          )}
        </Pressable>

        {expandido ? (
          <Animated.View
            layout={LinearTransition.duration(Motion.duration.base)}
            entering={FadeInDown.duration(Motion.duration.base)}
            style={styles.parcelas}>
            {parcelas.map((parcela) => (
              <Pressable
                key={parcela.id}
                accessibilityRole="button"
                accessibilityLabel={`Parcela ${parcela.installment_no ?? ''} de ${plano.installments}, ${formatBRL(parcela.amount_cents)}, ${parcela.status === 'cleared' ? 'paga' : 'prevista'}, ${formatDateBR(parcela.occurred_at)}`}
                onPress={() =>
                  router.push({
                    pathname: '/finance/[txId]',
                    params: { txId: parcela.id, month: parcela.occurred_at.slice(0, 7) },
                  })
                }>
                {({ pressed }) => (
                  <View
                    style={[
                      styles.parcela,
                      { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
                    ]}>
                    <ThemedText type="small" style={tabular}>
                      {parcela.installment_no ?? '—'}/{plano.installments} ·{' '}
                      {formatDateBR(parcela.occurred_at)}
                    </ThemedText>
                    <View style={styles.parcelaValor}>
                      <ThemedText
                        type="small"
                        themeColor={parcela.status === 'cleared' ? 'success' : 'textSecondary'}>
                        {parcela.status === 'cleared' ? 'paga' : 'prevista'}
                      </ThemedText>
                      <Money cents={parcela.amount_cents} variant="subhead" />
                    </View>
                  </View>
                )}
              </Pressable>
            ))}
            {plano.last_installment_cents !== plano.installment_cents ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.nota}>
                A última parcela fecha a conta com os centavos da divisão.
              </ThemedText>
            ) : null}
          </Animated.View>
        ) : null}
      </Animated.View>
    );
  };

  return (
    <Screen grouped onRefresh={() => plans.refetch()} refreshing={plans.isRefetching}>
      {/* Sem headerRight de propósito: parcelamento nasce da compra, não desta tela. */}
      <Stack.Screen options={{ title: 'Parceladas', headerLargeTitle: true }} />

      {plans.isLoading ? (
        <>
          <Skeleton height={132} radius={Radius.lg} />
          <Skeleton height={ALTURA_BARRA + Space.xxl} radius={Radius.md} />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {plans.isError ? (
        <Section title="Parceladas">
          <Row
            title="Não deu para carregar suas compras parceladas"
            subtitle="Toque para tentar de novo"
            icon="exclamationmark.triangle"
            onPress={() => plans.refetch()}
          />
        </Section>
      ) : null}

      {/* O único GlassCard da tela: é o número que muda a decisão de parcelar de novo. */}
      {!plans.isError && lista.length > 0 ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <GlassCard style={styles.hero}>
            <ThemedText type="small" themeColor="textSecondary">
              Comprometido nos próximos 12 meses
            </ThemedText>
            <Money cents={comprometido} variant="money" />
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              {comprometido > 0
                ? `${formatBRL(media)} por mês em média${ultimaParcela ? ` · última parcela em ${monthLabel(ultimaParcela)}` : ''}`
                : 'Nada parcelado em aberto.'}
            </ThemedText>
          </GlassCard>
        </Animated.View>
      ) : null}

      {temFaixa ? (
        <Card style={styles.faixa}>
          <ThemedText type="smallBold">Quanto cai por mês</ThemedText>
          <View style={styles.bars}>
            {faixa.map((mes, index) => (
              <Pressable
                key={mes.month}
                accessibilityRole="button"
                accessibilityLabel={`${monthLabel(mes.month)}, ${formatBRL(mes.cents)} em parcelas`}
                style={styles.barSlot}
                onPress={() =>
                  router.push({ pathname: '/finance/transactions', params: { month: mes.month } })
                }>
                <View style={styles.barTrack}>
                  <Bar
                    ratio={maiorDaFaixa > 0 ? mes.cents / maiorDaFaixa : 0}
                    index={index}
                    destaque={mes.cents === maiorDaFaixa && mes.cents > 0}
                  />
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {mesCurto(mes.month)}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={tabular}>
            {`Mês mais pesado: ${formatBRL(maiorDaFaixa)}`}
          </ThemedText>
        </Card>
      ) : null}

      {emAndamento.length > 0 ? (
        <Section title="Em andamento">{emAndamento.map(bloco)}</Section>
      ) : null}

      {terminadas.length > 0 ? (
        <Section title="Terminadas">
          <Row
            title={verTerminadas ? 'Esconder terminadas' : `Ver ${terminadas.length} terminadas`}
            subtitle="compras que já foram quitadas"
            icon={verTerminadas ? 'chevron.up' : 'checkmark.circle'}
            chevron={false}
            onPress={() => setVerTerminadas(!verTerminadas)}
          />
          {verTerminadas ? terminadas.map(bloco) : null}
        </Section>
      ) : null}

      {!plans.isLoading && !plans.isError && lista.length === 0 ? (
        <EmptyState
          icon="creditcard"
          title="Nenhuma compra parcelada"
          hint={'Quando você lançar uma compra em 10x,\nela aparece aqui com quanto falta.'}
        />
      ) : null}

    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: Space.sm,
  },
  faixa: {
    gap: Space.md,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Space.sm,
  },
  barSlot: {
    flex: 1,
    alignItems: 'center',
    gap: Space.xs,
  },
  barTrack: {
    width: '100%',
    height: ALTURA_BARRA,
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderRadius: Radius.xs,
    borderCurve: 'continuous',
  },
  plano: {
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  planoTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  planoNome: {
    flex: 1,
  },
  planoValor: {
    alignItems: 'flex-end',
  },
  parcelas: {
    paddingBottom: Space.sm,
  },
  parcela: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingHorizontal: Space.xl,
    paddingVertical: Space.sm,
  },
  parcelaValor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  nota: {
    ...Type.footnote,
    paddingHorizontal: Space.xl,
    paddingTop: Space.xs,
  },
});
