import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, router } from 'expo-router';
import Animated, {
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';

import { monthLabel, monthShort, shiftMonth } from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/ui/sparkline';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  useAccounts,
  useDeleteInstallmentPlan,
  useInstallmentPlans,
  type InstallmentPlanSummary,
} from '@/hooks/use-finance';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import { useToast } from '@/components/ui/toast';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';
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

const MESES_COMPROMETIDOS = 12;
const ALTURA_BARRA = 88;
/** Largura fixa de cada mês na faixa rolável. */
const LARGURA_MES = 48;

/** Barra de um mês. Cresce da base com mola — valor que salta é bug visual. */
function Bar({
  ratio,
  index,
  destaque,
  passado,
}: {
  ratio: number;
  index: number;
  destaque: boolean;
  passado: boolean;
}) {
  const theme = useTheme();
  const grow = useSharedValue(0);

  useEffect(() => {
    grow.set(withDelay(index * Motion.stagger.step, withSpring(ratio, Motion.spring.settle)));
  }, [grow, ratio, index]);

  const animado = useAnimatedStyle(() => ({
    // Mês sem parcela desenha NADA — o piso é para valor que existe. Com a faixa cobrindo o
    // plano inteiro, buraco no meio virou caso comum.
    height: ratio <= 0 ? 0 : Math.max(Space.xs, grow.get() * ALTURA_BARRA),
  }));

  return (
    <Animated.View
      style={[
        styles.bar,
        animado,
        {
          backgroundColor: destaque ? theme.tint : theme.backgroundElement,
          // Parcela já paga fica mais fraca — mesma convenção da tendência da home: uma cor,
          // duas intensidades. O que o usuário decide é o que vem pela frente.
          opacity: passado ? 0.4 : 1,
        },
      ]}
    />
  );
}

export default function InstallmentsScreen() {
  const theme = useTheme();
  const toast = useToast();
  const plans = useInstallmentPlans();
  const removePlan = useDeleteInstallmentPlan();
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

  /**
   * Parcelas por mês — TODAS, inclusive as já pagas e as de meses passados.
   *
   * Antes este mapa nascia com dois filtros (`status = pending` e `mes >= hoje`), e por isso a
   * faixa não tinha como mostrar passado nenhum: o dado saía antes de chegar no gráfico. O
   * recorte "só o que ainda vai sair" continua existindo, mas em `comprometido`, que é o número
   * que precisa dele.
   */
  const porMes = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const plano of plans.data ?? []) {
      for (const parcela of plano.parcels) {
        const mes = parcela.occurred_at.slice(0, 7);
        mapa.set(mes, (mapa.get(mes) ?? 0) + parcela.amount_cents);
      }
    }
    return mapa;
  }, [plans.data]);

  const mesAtual = localISODate().slice(0, 7);

  // A faixa cobre o plano INTEIRO — da primeira parcela à última —, não seis meses para a
  // frente. O caso que originou a auditoria é exatamente este: compra em 8x lançada JÁ na 5ª
  // parcela, com quatro meses de passado que a tela não tinha como mostrar.
  const faixa = useMemo(() => {
    const meses = Array.from(porMes.keys()).sort();
    if (meses.length === 0) return [];
    const fim = meses[meses.length - 1];
    const out: { month: string; cents: number }[] = [];
    // Teto de segurança: `porMes` vem do banco e um `first_occurred_at` absurdo não pode
    // virar laço infinito.
    for (let mes = meses[0]; mes <= fim && out.length < 240; mes = shiftMonth(mes, 1)) {
      out.push({ month: mes, cents: porMes.get(mes) ?? 0 });
    }
    return out;
  }, [porMes]);

  // Abre no mês corrente, não no começo do histórico: a pergunta padrão é "quanto cai daqui
  // para a frente". `contentOffset` não é confiável nas duas plataformas — daí o `scrollTo`.
  const faixaRef = useRef<ScrollView>(null);
  const indexAtual = faixa.findIndex((f) => f.month >= mesAtual);

  /**
   * O que ainda vai SAIR do bolso nos próximos 12 meses.
   *
   * Lê as parcelas direto, e não o `porMes`, porque este número tem dois recortes que a faixa
   * não tem: só parcela `pending` (a já paga não é compromisso) e só do mês corrente para a
   * frente. Junto vem quantos meses da janela têm parcela — é o divisor da média, e contar mês
   * passado ali faria a média encolher sozinha.
   */
  const { comprometido, mesesNaJanela } = useMemo(() => {
    const fim = shiftMonth(mesAtual, MESES_COMPROMETIDOS - 1);
    const meses = new Set<string>();
    let total = 0;
    for (const plano of plans.data ?? []) {
      for (const parcela of plano.parcels) {
        if (parcela.status !== 'pending') continue;
        const mes = parcela.occurred_at.slice(0, 7);
        if (mes < mesAtual || mes > fim) continue;
        total += parcela.amount_cents;
        meses.add(mes);
      }
    }
    return { comprometido: total, mesesNaJanela: meses.size };
  }, [plans.data, mesAtual]);

  const ultimaParcela = useMemo(() => {
    let maior: string | null = null;
    for (const mes of porMes.keys()) if (!maior || mes > maior) maior = mes;
    return maior;
  }, [porMes]);

  const media = mesesNaJanela > 0 ? Math.round(comprometido / mesesNaJanela) : 0;
  const maiorDaFaixa = Math.max(...faixa.map((f) => f.cents), 0);
  // "Mês mais pesado" só ganha o accent quando existe UM. Com parcelas iguais — o caso comum,
  // porque parcela é o total dividido igual — três meses empatavam no máximo e os três saíam em
  // `tint`: três retângulos pretos colados viram um bloco, que era o achado cosmético parado
  // desde a Fase 1. Empate agora não destaca ninguém; o valor continua escrito embaixo.
  const maiorEhUnico = faixa.filter((f) => f.cents === maiorDaFaixa).length === 1;
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
      {
        label: 'Apagar a compra inteira',
        icon: 'trash' as const,
        destructive: true,
        onPress: () => apagarPlano(plano),
      },
    ]);
  };

  /**
   * Apagar o plano some com TODAS as parcelas (cascade em `installment_plan_id`).
   *
   * Esta tela documentava a ausência como decisão — "não se apaga, porque apagar
   * o plano faz cascade nas dez linhas do extrato". A decisão mudou: o cascade é
   * exatamente o que se quer quando a compra foi cancelada ou lançada errada, e a
   * alternativa era apagar dez lançamentos um por um, navegando dez meses.
   *
   * Sem "Desfazer" (o cascade não volta), então a confirmação nomeia o estrago.
   */
  const apagarPlano = (plano: InstallmentPlanSummary) => {
    confirmDestructive(
      'Apagar a compra parcelada inteira?',
      'Apagar tudo',
      () =>
        removePlan.mutate(plano.id, {
          onSuccess: () => toast({ message: `Apaguei ${plano.title} e as parcelas.`, tone: 'success' }),
          onError: () =>
            toast({ message: 'Não deu para apagar a compra. Tenta de novo.', tone: 'error' }),
        }),
      `Some as ${plano.installments} parcelas de ${plano.title}, ${formatBRL(plano.total_cents)} no total — de todos os meses. Isso não volta.`,
    );
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
                    variant="ticker"
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
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.nota}>
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

      {/* O único destaque da tela: é o número que muda a decisão de parcelar de novo. */}
      {!plans.isError && lista.length > 0 ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <Card style={styles.hero}>
            <HeroLabel>Comprometido nos próximos 12 meses</HeroLabel>
            <Money cents={comprometido} variant="money" />
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              {comprometido > 0
                ? `${formatBRL(media)} por mês em média${ultimaParcela ? ` · última parcela em ${monthLabel(ultimaParcela)}` : ''}`
                : 'Nada parcelado em aberto.'}
            </ThemedText>
          </Card>
        </Animated.View>
      ) : null}

      {temFaixa ? (
        <Card style={styles.faixa}>
          <ThemedText type="smallBold">Quanto cai por mês</ThemedText>
          <ScrollView
            ref={faixaRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            onContentSizeChange={() =>
              faixaRef.current?.scrollTo({
                // Um mês de folga à esquerda para o corrente não colar na borda.
                x: Math.max(0, (indexAtual - 1) * (LARGURA_MES + Space.sm)),
                animated: false,
              })
            }
            contentContainerStyle={styles.bars}>
            {faixa.map((mes, index) => (
              <Pressable
                key={mes.month}
                accessibilityRole="button"
                accessibilityLabel={`${monthLabel(mes.month)}, ${formatBRL(mes.cents)} em parcelas${mes.month < mesAtual ? ', já passou' : ''}`}
                style={styles.barSlot}
                onPress={() =>
                  router.push({ pathname: '/finance/transactions', params: { month: mes.month } })
                }>
                <View style={styles.barTrack}>
                  <Bar
                    ratio={maiorDaFaixa > 0 ? mes.cents / maiorDaFaixa : 0}
                    index={index}
                    destaque={maiorEhUnico && mes.cents === maiorDaFaixa && mes.cents > 0}
                    passado={mes.month < mesAtual}
                  />
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {monthShort(mes.month)}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
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
    width: LARGURA_MES,
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
    paddingHorizontal: Space.xl,
    paddingTop: Space.xs,
  },
});
