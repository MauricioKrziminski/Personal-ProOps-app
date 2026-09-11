import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Stack, router, useLocalSearchParams } from 'expo-router';

import { ErrorCard } from '@/components/error-card';
import { MonthPicker, currentMonth, monthTitle } from '@/components/finance/month-picker';
import { MonthRuler, useMonthRuler } from '@/components/finance/month-ruler';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { HeroPanel } from '@/components/ui/hero-panel';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SectionHead } from '@/components/ui/section-head';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  useMarkPaid,
  useMonthBreakdown,
  useMonthLines,
  useMonthRange,
  useMonthSummary,
  type MonthLine,
} from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';
import { formatBRL, isoToBR, localISODate } from '@/lib/dates';
import { showItemActions } from '@/lib/item-actions';
import {
  BUCKETS,
  GROUP_OPTIONS,
  bucketTitle,
  gapExplanation,
  groupLabel,
  heroFigure,
  horizonWarning,
  lineSubtitle,
  sharePercent,
  undocumentedWarning,
  type Bucket,
  type GroupBy,
} from '@/lib/month-view';
import { settleLabel, unsettledLabel } from '@/lib/settle-labels';

/**
 * Mês — "para onde foi o dinheiro deste mês, e como ele fechou?".
 *
 * O app organiza dinheiro por OBJETO: o financiamento do carro mora em Dívidas, a fatura em
 * Cartões, o salário em Recorrentes. Nenhuma tela dizia "setembro". Esta diz — e é a página de
 * mês que o dono do produto já mantinha numa planilha, com os mesmos quatro blocos: o que entra,
 * o que já estava comprometido em fixas, o que já estava comprometido em parcelas, e o que sobrou
 * de escolha.
 *
 * **A parcela do financiamento é uma LINHA daqui** (`9/48`), não uma tela — era a queixa concreta
 * que originou a tela.
 *
 * ## Dois números, duas perguntas
 *
 * O herói mostra **caixa** (o dinheiro que passou pela conta) e a seção "A conta do mês" mostra o
 * **resultado** (competência: a compra conta no dia em que foi feita, como na planilha). Eles não
 * batem, e isso não é defeito: a diferença é a fatura que ainda não venceu. A tela nomeia a
 * diferença em vez de escondê-la — esconder é o que faz alguém achar que a conta não fecha.
 *
 * ## O que a tela declara em vez de mentir
 *
 * Recorrentes são materializadas um ANO à frente e, além disso, expandidas da regra
 * (`20260910140000`); o cronograma de financiamento não tem horizonte nenhum. Antes das duas
 * coisas, o quarto mês mostrava a parcela do carro e ZERO contas fixas — e o resultado daquele
 * mês ficava lindo e falso. O aviso continua porque a natureza da linha muda: além do horizonte
 * materializado ela é projeção da regra, não lançamento que alguém pode editar.
 */

/** Faixa de aviso por seção. Seção incompleta DIZ que está incompleta. */
function Aviso({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.aviso, { backgroundColor: theme.backgroundElement }]}>
      <Icon name="exclamationmark.triangle.fill" size="sm" color="warning" />
      <ThemedText type="footnote" themeColor="textSecondary" style={styles.avisoTexto}>
        {children}
      </ThemedText>
    </View>
  );
}

export default function MonthScreen() {
  const params = useLocalSearchParams<{ month?: string }>();
  const toast = useToast();
  const [month, setMonth] = useState(() => params.month ?? currentMonth());
  /*
    ⚠️ **Padrão `meio`, não `natureza`.** A lista logo acima JÁ está agrupada por natureza
    (Fixas, Parcelas, Variáveis), então abrir o recorte na mesma régua repetia a mesma leitura
    duas vezes na mesma tela. Por meio de pagamento ele acrescenta o que a lista não diz — e é
    o bloco "Saídas" da planilha do dono do produto: Nubank 3.271 · BB 1.432 · Itaú 1.485 · Pix.
  */
  const [groupBy, setGroupBy] = useState<GroupBy>('meio');

  const regua = useMonthRuler();
  const lines = useMonthLines(month, regua.view);
  const janela = useMonthRange(month, regua.view);
  const summary = useMonthSummary(month, true, regua.view);
  const breakdown = useMonthBreakdown(month, groupBy, regua.view);
  const darBaixa = useMarkPaid();

  const hoje = currentMonth();
  const nomeDoMes = monthTitle(month).replace(/ de \d{4}$/, '').toLowerCase();
  const s = summary.data;
  const porBloco = (bucket: Bucket) => (lines.data ?? []).filter((l) => l.bucket === bucket);

  /*
    As faturas que o período contém — derivadas das LINHAS, não de uma consulta nova.
    Cada linha de cartão já diz a que fatura pertence (`invoice_id`/`invoice_due`), então o bloco
    é um agrupamento no cliente: zero rede, zero número novo para divergir do que está acima.

    ⚠️ **Isto NÃO substitui a lista.** O pedido foi *"mostrar a fatura e se ele quiser ver os
    lançamentos daquela fatura ele clica nela"*, e a tela da fatura já existe e já lista as
    compras dela — o que faltava era o caminho. Tirar as compras da lista para pôr só a fatura
    quebraria os subtotais por natureza, que vêm do `month_summary` e não sabem de fatura.
  */
  const faturasDoPeriodo = useMemo(() => {
    const mapa = new Map<string, { id: string; nome: string; vence: string; cents: number }>();
    for (const l of lines.data ?? []) {
      if (!l.invoice_id || !l.invoice_due) continue;
      const atual = mapa.get(l.invoice_id);
      if (atual) atual.cents += Number(l.amount_cents);
      else mapa.set(l.invoice_id, {
        id: l.invoice_id,
        nome: l.method_label ?? 'Cartão',
        vence: l.invoice_due,
        cents: Number(l.amount_cents),
      });
    }
    return [...mapa.values()].sort((a, b) => a.vence.localeCompare(b.vence));
  }, [lines.data]);

  const subtotal: Record<Bucket, number> = {
    entrada: Number(s?.income_cents ?? 0),
    fixa: Number(s?.fixas_cents ?? 0),
    parcela: Number(s?.parcelas_cents ?? 0),
    variavel: Number(s?.variaveis_cents ?? 0),
  };
  const falta: Record<Bucket, number> = {
    // Era `0` cravado porque `month_summary` não devolvia o recorte de receita — o dado existia
    // em `month_lines` (coluna `settled`) e só não era somado. `20260909130000` fechou isso.
    entrada: Number(s?.income_unsettled_cents ?? 0),
    fixa: Number(s?.fixas_unsettled_cents ?? 0),
    parcela: Number(s?.parcelas_unsettled_cents ?? 0),
    variavel: Number(s?.variaveis_unsettled_cents ?? 0),
  };

  /** Linha projetada aponta para a DÍVIDA: o `ref_id` dela é id de dívida, não de lançamento. */
  const abrir = (l: MonthLine) =>
    l.projected
      ? router.push({ pathname: '/finance/debts', params: { id: l.ref_id } })
      : router.push({ pathname: '/finance/[txId]', params: { txId: l.ref_id, month } });

  const acoes = (l: MonthLine) => {
    if (l.projected || l.settled) return undefined;
    return () =>
      showItemActions(l.title, [
        {
          label: settleLabel(l.kind),
          onPress: () =>
            darBaixa.mutate(
              { id: l.ref_id, paidAt: localISODate() },
              {
                onSuccess: () => toast({ message: `${l.title} baixado.`, tone: 'success' }),
                onError: () => toast({ message: `Não deu para dar baixa em ${l.title}.`, tone: 'error' }),
              },
            ),
        },
        { label: 'Ver detalhe', onPress: () => abrir(l) },
      ]);
  };

  const vazio = !lines.isLoading && !lines.isError && (lines.data ?? []).length === 0;

  return (
    <Screen
      grouped
      onRefresh={() => Promise.all([lines.refetch(), summary.refetch(), breakdown.refetch()])}
      refreshing={lines.isRefetching}>
      <Stack.Screen options={{ title: 'Mês', headerLargeTitle: true }} />

      <View style={styles.escopo}>
        <MonthPicker month={month} onChange={setMonth} />
        <MonthRuler value={regua.view} onChange={regua.setView} visible={regua.temCiclo} />
        {/*
          ⚠️ **Qual mês é "este mês" não é óbvio, e a confusão custa uma tarde.**

          Esta tela é o mês do CALENDÁRIO. A fatura do cartão é um CICLO (o Nubank fecha dia 3,
          então a fatura que vence em outubro cobre 03/09 a 02/10). Quem compara os dois lado a
          lado vê números diferentes para "outubro" e conclui que um dos dois está errado —
          quando os dois estão certos e recortam janelas diferentes. Foi exatamente o que
          aconteceu com o dono do produto em 10/09/2026, contra a planilha dele.

          Uma linha de legenda resolve o que nenhuma explicação depois resolve.
        */}
        <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
          {/* A legenda diz a JANELA, não o nome dela: com fechamento configurado, "setembro"
              vai de 11/08 a 10/09 e escrever "mês de calendário" viraria a mentira que esta
              linha existe para evitar. */}
          {isoToBR(janela.from)} a {isoToBR(janela.to)}
        </ThemedText>
      </View>

      {/* 1. O destaque: como o mês fecha. Único da tela. */}
      {summary.isLoading ? (
        <View style={styles.heroSkeleton}>
          <Skeleton width="55%" height={14} />
          <Skeleton width="70%" height={46} />
        </View>
      ) : summary.isError || !s ? (
        <ErrorCard onRetry={() => summary.refetch()} />
      ) : (
        (() => {
          const heroi = heroFigure(
            { closingCashCents: s.closing_cash_cents, resultCents: Number(s.result_cents) },
            month,
            hoje,
            nomeDoMes,
          );
          const resultado = Number(s.result_cents);
          return (
            <HeroPanel
              label={heroi.label}
              value={
                <Money
                  cents={heroi.cents}
                  variant="heroMoney"
                  tone={heroi.cents < 0 ? 'danger' : 'onHero'}
                  concealable
                />
              }
              secondary={{
                icon: resultado < 0 ? 'chart.line.downtrend.xyaxis' : 'chart.line.uptrend.xyaxis',
                negative: resultado < 0,
                text: `entrou ${formatBRL(Number(s.income_cents))} · saiu ${formatBRL(Number(s.expense_cents))}`,
              }}
              trend={
                heroi.isCash
                  ? {
                      value: formatBRL(resultado),
                      positive: resultado >= 0,
                      label: 'resultado do mês',
                    }
                  : undefined
              }
              concealable
            />
          );
        })()
      )}

      {/*
        O aviso de horizonte vinha SÓ no bloco de fixas, e o número grande é o que se lê. Quem
        olha o destaque e sai não descobria que aquele mês está além do que o cron materializou.
      */}
      {s?.beyond_recurring_horizon ? (
        <Aviso>
          {horizonWarning(
            s.recurring_covered_until ? monthTitle(s.recurring_covered_until.slice(0, 7)) : null,
          )}
        </Aviso>
      ) : null}

      {/* 2. A equação da planilha, em linhas. É o segundo número sem virar segundo destaque. */}
      {s ? (
        <View style={styles.bloco}>
          <SectionHead title="A conta do mês" />
          <Section>
            <Row
              title={`Comecei ${nomeDoMes} com`}
              chevron={false}
              trailing={<Money cents={Number(s.opening_cash_cents)} variant="headline" tone="textSecondary" />}
            />
            <Row
              title="Entrou"
              chevron={false}
              trailing={<Money cents={Number(s.income_cents)} variant="headline" tone="success" />}
            />
            <Row
              title="Saiu"
              chevron={false}
              trailing={<Money cents={Number(s.expense_cents)} variant="headline" tone="danger" />}
            />
            <Row
              title="Resultado"
              chevron={false}
              trailing={
                <Money
                  cents={Number(s.result_cents)}
                  variant="headline"
                  tone={Number(s.result_cents) < 0 ? 'danger' : 'success'}
                />
              }
            />
            {s.closing_cash_cents !== null ? (
              <Row
                title={heroFigure(
                  { closingCashCents: s.closing_cash_cents, resultCents: Number(s.result_cents) },
                  month,
                  hoje,
                  nomeDoMes,
                ).label}
                chevron={false}
                trailing={<Money cents={Number(s.closing_cash_cents)} variant="headline" />}
              />
            ) : (
              <Row
                title="Ver a projeção de caixa"
                subtitle="quanto ainda vai entrar e sair até lá"
                onPress={() => router.push('/finance/forecast')}
              />
            )}
          </Section>
          {s.closing_cash_cents !== null
            ? (() => {
                const frase = gapExplanation(
                  Number(s.opening_cash_cents),
                  Number(s.result_cents),
                  Number(s.closing_cash_cents),
                );
                return frase ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {frase}
                  </ThemedText>
                ) : null;
              })()
            : null}
        </View>
      ) : null}

      {lines.isLoading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {lines.isError ? <ErrorCard onRetry={() => lines.refetch()} /> : null}

      {vazio ? (
        <EmptyState
          title={`Nada registrado em ${nomeDoMes}`}
          hint="Manda `gastei 45 no mercado` para o agente — ou lança pelo +. Contas fixas e parcelas aparecem aqui sozinhas."
        />
      ) : null}

      {/* 3–6. Os quatro blocos da planilha, na mesma ordem. */}
      {BUCKETS.map((bucket, i) => {
        const doBloco = porBloco(bucket);
        if (doBloco.length === 0) return null;
        return (
          <Animated.View
            key={bucket}
            entering={FadeInDown.duration(Motion.duration.slow).delay(
              Math.min(i * Motion.stagger.step, Motion.stagger.cap),
            )}
            style={styles.bloco}>
            <SectionHead
              title={bucketTitle(bucket)}
              action={<Money cents={subtotal[bucket]} variant="ticker" tone="textSecondary" />}
            />

            {bucket === 'parcela' && month < hoje && (s?.debt_installments_undocumented ?? 0) > 0 ? (
              <Aviso>{undocumentedWarning(s!.debt_installments_undocumented)}</Aviso>
            ) : null}

            <Section>
              {doBloco.map((l) => (
                <Row
                  key={`${l.origin}-${l.ref_id}-${l.installment_no ?? 0}`}
                  title={l.title}
                  subtitle={lineSubtitle(l, { comCategoria: bucket === 'variavel' })}
                  onPress={() => abrir(l)}
                  onLongPress={acoes(l)}
                  accessibilityLabel={`${l.title}, ${formatBRL(Number(l.amount_cents))}, ${
                    l.settled ? 'pago' : `previsto para ${isoToBR(l.due_date)}`
                  }`}
                  trailing={
                    <View style={styles.valor}>
                      <Money cents={Number(l.amount_cents)} variant="headline" />
                      {!l.settled ? (
                        <ThemedText type="footnote" themeColor="textSecondary">
                          previsto
                        </ThemedText>
                      ) : null}
                    </View>
                  }
                />
              ))}
            </Section>

            {falta[bucket] > 0 ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                {unsettledLabel(bucket)} {formatBRL(falta[bucket])}
              </ThemedText>
            ) : null}
          </Animated.View>
        );
      })}

      {/* 7. Para onde foi — três cortes, um desenho só. */}
      {faturasDoPeriodo.length > 0 ? (
        <View style={styles.bloco}>
          <SectionHead title="Faturas do período" />
          <Section>
            {faturasDoPeriodo.map((f) => (
              <Row
                key={f.id}
                title={f.nome}
                subtitle={`vence ${isoToBR(f.vence)} · ${f.cents === 0 ? 'sem compras aqui' : 'toque para ver as compras'}`}
                icon="creditcard"
                trailing={<Money cents={f.cents} variant="ticker" />}
                onPress={() =>
                  router.push({ pathname: '/finance/invoice/[id]', params: { id: f.id } })
                }
              />
            ))}
          </Section>
          {/* A soma daqui JÁ está dentro dos blocos acima — dizer isso evita a leitura de que
              são gastos a mais. */}
          <ThemedText type="footnote" themeColor="textSecondary">
            O que está aqui já está somado acima; é a mesma compra, vista pela fatura que vai
            pagá-la.
          </ThemedText>
        </View>
      ) : null}

      {(breakdown.data ?? []).length > 0 || breakdown.isLoading ? (
        <View style={styles.bloco}>
          <SectionHead title="Para onde o dinheiro foi" />
          <Segmented options={GROUP_OPTIONS} value={groupBy} onChange={setGroupBy} />
          {breakdown.isError ? (
            <ErrorCard onRetry={() => breakdown.refetch()} />
          ) : breakdown.isLoading ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : (
            <Card style={styles.fatias}>
              {(breakdown.data ?? []).map((fatia) => (
                <View key={fatia.group_key} style={styles.fatia}>
                  <View style={styles.fatiaTopo}>
                    <ThemedText type="default" style={styles.fatiaRotulo}>
                      {groupLabel(groupBy, fatia.group_key, fatia.group_label)}
                    </ThemedText>
                    <Money cents={Number(fatia.total_cents)} variant="headline" />
                  </View>
                  <ProgressBar
                    value={Number(fatia.total_cents)}
                    max={Number(breakdown.data?.[0]?.total_cents ?? 1)}
                    tone="data"
                  />
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {sharePercent(fatia.share_bp)}% do que saiu
                    {Number(fatia.unsettled_cents) > 0
                      ? ` · ${formatBRL(Number(fatia.unsettled_cents))} ainda não pagos`
                      : ''}
                  </ThemedText>
                </View>
              ))}
            </Card>
          )}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  escopo: {
    marginBottom: Space.xs,
  },
  heroSkeleton: {
    gap: Space.sm,
  },
  bloco: {
    gap: Space.sm,
  },
  aviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    padding: Space.md,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  avisoTexto: {
    flex: 1,
  },
  valor: {
    alignItems: 'flex-end',
  },
  fatias: {
    gap: Space.lg,
  },
  fatia: {
    gap: Space.xs,
  },
  fatiaTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  fatiaRotulo: {
    flexShrink: 1,
  },
});
