import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, MoneyField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { Sparkline } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  useAccounts,
  useAffordability,
  useCashFlowForecast,
  useMarkPaid,
  useUpcomingBills,
} from '@/hooks/use-finance';
import { useDebounced } from '@/hooks/use-debounced';
import { formatBRL, isoToBR, localISODate } from '@/lib/dates';
import { showItemActions } from '@/lib/item-actions';

/**
 * Projeção — "posso gastar isso?".
 *
 * É modelo de **caixa**, montado para não contar o mesmo gasto duas vezes:
 * saldo inicial = contas que guardam dinheiro (cartão fora), só `cleared`; saídas futuras = toda
 * fatura não paga **na data de vencimento** + `pending` sem fatura em `coalesce(due_at,
 * occurred_at)`.
 *
 * Daí a consequência contraintuitiva que a tela precisa dizer com todas as letras: **a compra no
 * cartão sai do caixa quando a fatura vence, não quando foi feita**. Quem gastou R$ 800 no cartão
 * hoje vê o saldo intacto por três semanas e acha que a projeção quebrou.
 *
 * O simulador é o diferencial do produto e por isso é o SEGUNDO bloco, sempre visível — antes ele
 * ficava no fim da tela e só renderizava com série carregada.
 */

const HORIZONTES = [
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
  { dias: 180, label: '6 meses' },
];

const PARCELAS = [1, 3, 6, 10, 12];

/** Faixa de erro por seção. Seção que falha DIZ que falhou — nunca some. */
function ErrorBand({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card style={styles.band}>
      <Icon name="exclamationmark.triangle.fill" size="lg" color="danger" />
      <ThemedText type="small" style={styles.bandText}>
        {message}
      </ThemedText>
      <Button label="Tentar de novo" variant="secondary" size="sm" onPress={onRetry} />
    </Card>
  );
}

export default function ForecastScreen() {
  const toast = useToast();
  const { width } = useWindowDimensions();
  const { simular } = useLocalSearchParams<{ simular?: string }>();

  const [dias, setDias] = useState(90);
  const [simCents, setSimCents] = useState(0);
  const [parcelas, setParcelas] = useState(1);
  const [comoCalculo, setComoCalculo] = useState(false);

  // Cada tecla do MoneyField é uma chave nova, e `affordability` roda uma projeção de 370 dias por
  // dentro: sem o atraso, digitar "1250" são quatro projeções de um ano.
  const simDebounced = useDebounced(simCents, 400);

  const forecast = useCashFlowForecast(dias);
  const bills = useUpcomingBills(30);
  const accounts = useAccounts();
  const sim = useAffordability(simDebounced, parcelas);
  const markPaid = useMarkPaid();

  const serie = forecast.data ?? [];
  const valores = serie.map((d) => Number(d.balance_cents));
  const hoje = valores[0] ?? 0;
  const fim = valores[valores.length - 1] ?? 0;
  const primeiroNegativo = serie.find((d) => Number(d.balance_cents) < 0);
  const contas = bills.data ?? [];
  const atrasadas = contas.filter((b) => b.overdue);
  const aVencer = contas.filter((b) => !b.overdue);

  /**
   * O empty de verdade é *nada para projetar*: sem conta cadastrada, sem nada a vencer e a série
   * inteira em zero. `serie.length === 0` nunca acontece — `generate_series` devolve uma linha por
   * dia mesmo sem nenhum lançamento, e o empty antigo era inalcançável.
   */
  const nadaParaProjetar =
    !forecast.isLoading &&
    !accounts.isLoading &&
    !bills.isLoading &&
    !bills.isError &&
    (accounts.data ?? []).length === 0 &&
    contas.length === 0 &&
    valores.every((v) => v === 0);

  const veredito = sim.data
    ? sim.data.can_afford
      ? `Dá para pagar. No pior dia você fica com ${formatBRL(Number(sim.data.worst_balance_cents))}, em ${isoToBR(sim.data.worst_day)}.`
      : `Aperta. Você fica com ${formatBRL(Number(sim.data.worst_balance_cents))} em ${isoToBR(sim.data.worst_day)}.`
    : null;

  // Haptic e anúncio só quando o veredito VIRA — nunca a cada tecla.
  const vereditoAnterior = useRef<boolean | null>(null);
  useEffect(() => {
    const cabe = sim.data?.can_afford;
    if (cabe === undefined || veredito === null) return;
    if (vereditoAnterior.current === cabe) return;
    vereditoAnterior.current = cabe;
    Haptics.notificationAsync(
      cabe ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning
    );
    AccessibilityInfo.announceForAccessibility(veredito);
  }, [sim.data?.can_afford, veredito]);

  const pagar = (id: string, titulo: string) =>
    markPaid.mutate(
      { id, paidAt: localISODate() },
      {
        onSuccess: () => toast({ message: `${titulo} marcado como pago.`, tone: 'success' }),
        // otimista sem rollback visível faz o usuário achar que pagou
        onError: () => toast({ message: `Não deu para dar baixa em ${titulo}.`, tone: 'error' }),
      }
    );

  const escolherHorizonte = () =>
    showItemActions(
      'Horizonte da projeção',
      HORIZONTES.map((h) => ({ label: h.label, onPress: () => setDias(h.dias) }))
    );

  const linhaConta = (b: (typeof contas)[number]) => {
    const fatura = b.kind === 'invoice';
    const cents = Number(b.amount_cents);

    return (
      <Row
        key={b.ref_id}
        title={b.title}
        subtitle={b.overdue ? `venceu em ${isoToBR(b.due_date)}` : isoToBR(b.due_date)}
        icon={fatura ? 'creditcard' : 'doc.text'}
        chevron={fatura}
        accessibilityLabel={`${b.title}, ${b.overdue ? 'atrasado, vencia' : 'vence'} em ${isoToBR(b.due_date)}, ${formatBRL(cents)}`}
        onPress={
          fatura
            ? () => router.push({ pathname: '/finance/invoice/[id]', params: { id: b.ref_id } })
            : undefined
        }
        onLongPress={
          fatura
            ? undefined
            : () =>
                showItemActions(b.title, [
                  {
                    label: `Marcar ${b.title} como pago`,
                    onPress: () => pagar(b.ref_id, b.title),
                  },
                ])
        }
        trailing={
          <View style={styles.trailing}>
            <Money cents={cents} variant="headline" tone={b.overdue ? 'danger' : 'text'} />
            {fatura ? (
              <Button
                label="Pagar fatura"
                size="sm"
                variant="secondary"
                onPress={() =>
                  router.push({ pathname: '/finance/invoice/[id]', params: { id: b.ref_id } })
                }
              />
            ) : (
              <Button
                label="Paguei"
                size="sm"
                variant="secondary"
                onPress={() => pagar(b.ref_id, b.title)}
              />
            )}
          </View>
        }
      />
    );
  };

  return (
    <Screen
      grouped
      onRefresh={() => {
        forecast.refetch();
        bills.refetch();
        accounts.refetch();
      }}
      refreshing={forecast.isRefetching}>
      <Stack.Screen
        options={{
          title: 'Projeção',
          headerLargeTitle: true,
          headerRight: () => (
            <Pressable
              accessibilityLabel={`Horizonte da projeção, ${HORIZONTES.find((h) => h.dias === dias)?.label}`}
              hitSlop={12}
              onPress={escolherHorizonte}>
              <Icon name="calendar" size="lg" color="tint" />
            </Pressable>
          ),
        }}
      />

      {forecast.isLoading ? (
        <>
          <Skeleton height={180} radius={Radius.lg} />
          <Skeleton height={140} radius={Radius.md} />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {/* O único GlassCard da tela: o título é a resposta, não o rótulo. */}
      {forecast.isError ? (
        <ErrorBand message="Não deu para carregar a projeção." onRetry={forecast.refetch} />
      ) : serie.length > 0 && !nadaParaProjetar ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <GlassCard style={styles.hero}>
            <View style={styles.heroTitulo}>
              {primeiroNegativo ? (
                <Icon name="exclamationmark.triangle" size="md" color="danger" />
              ) : null}
              <ThemedText
                type="smallBold"
                themeColor={primeiroNegativo ? 'danger' : 'text'}
                style={styles.heroTexto}>
                {primeiroNegativo
                  ? `Você fica no vermelho em ${isoToBR(primeiroNegativo.day)}`
                  : `Não fica negativo nos próximos ${HORIZONTES.find((h) => h.dias === dias)?.label}`}
              </ThemedText>
            </View>

            {/* Skia não gera árvore de acessibilidade: sem este label a tela fica muda. */}
            <View
              accessible
              accessibilityLabel={`Saldo hoje ${formatBRL(hoje)}, no fim do período ${formatBRL(fim)}${primeiroNegativo ? `, negativo a partir de ${isoToBR(primeiroNegativo.day)}` : ''}`}>
              <Sparkline values={valores} width={width - Space.lg * 4} height={96} showZero />
            </View>

            <View style={styles.heroSplit}>
              <View style={styles.heroParte}>
                <HeroLabel>hoje</HeroLabel>
                <Money cents={hoje} variant="title2" tone={hoje < 0 ? 'danger' : 'text'} />
              </View>
              <View style={styles.heroParte}>
                <HeroLabel>em {dias} dias</HeroLabel>
                <Money cents={fim} variant="title2" tone={fim < 0 ? 'danger' : 'text'} />
              </View>
            </View>
          </GlassCard>
        </Animated.View>
      ) : null}

      {/* Segundo bloco, sempre visível: é a pergunta mais frequente do produto. */}
      {!nadaParaProjetar ? (
        <Card style={styles.simulador}>
          <ThemedText type="smallBold">Posso comprar isso?</ThemedText>

          <Field label="Valor da compra">
            <MoneyField
              valueCents={simCents}
              onChangeCents={setSimCents}
              autoFocus={simular === '1'}
            />
          </Field>

          <Field label="Em quantas vezes">
            <Segmented
              options={PARCELAS.map((p) => ({ value: String(p), label: `${p}x` }))}
              value={String(parcelas)}
              onChange={(v) => setParcelas(Number(v))}
            />
          </Field>

          {sim.isError ? (
            <ErrorBand message="Não deu para simular agora." onRetry={sim.refetch} />
          ) : simCents === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Digite um valor para simular contra a sua projeção real.
            </ThemedText>
          ) : sim.data && veredito ? (
            <Animated.View key={veredito} entering={FadeIn.duration(Motion.duration.fast)}>
              <ThemedText
                type="small"
                themeColor={sim.data.can_afford ? 'success' : 'danger'}
                accessibilityLiveRegion="polite">
                {veredito}
              </ThemedText>
              {parcelas > 1 ? (
                <View style={styles.parcela}>
                  <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                    {parcelas}x de
                  </ThemedText>
                  <Money
                    cents={Number(sim.data.installment_cents)}
                    variant="subhead"
                    tone="textSecondary"
                  />
                </View>
              ) : null}
            </Animated.View>
          ) : (
            <Skeleton height={20} />
          )}
        </Card>
      ) : null}

      {bills.isError ? (
        <ErrorBand message="Não deu para carregar o que vence." onRetry={bills.refetch} />
      ) : null}

      {atrasadas.length > 0 ? <Section title="Atrasado">{atrasadas.map(linhaConta)}</Section> : null}
      {aVencer.length > 0 ? <Section title="O que vence">{aVencer.map(linhaConta)}</Section> : null}

      {!bills.isLoading && !bills.isError && contas.length === 0 && !nadaParaProjetar ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.calmo}>
          Nada vence nos próximos 30 dias.
        </ThemedText>
      ) : null}

      {nadaParaProjetar ? (
        <EmptyState
          icon="chart.line.uptrend.xyaxis"
          title="Ainda não dá para projetar"
          hint={'Cadastre suas contas e manda no WhatsApp “todo dia 5 pago 1200 de aluguel”.\nA partir daí eu mostro quanto sobra em cada dia.'}
          action={{ label: 'Cadastrar conta', onPress: () => router.push('/finance/accounts') }}
        />
      ) : null}

      {/* Quem duvida do número procura aqui; quem não duvida nem vê. */}
      <View style={styles.explicacao}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: comoCalculo }}
          onPress={() => setComoCalculo((v) => !v)}
          style={styles.explicacaoCabecalho}>
          <ThemedText type="small" themeColor="textSecondary">
            Como eu calculo isso
          </ThemedText>
          <Icon name={comoCalculo ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />
        </Pressable>
        {comoCalculo ? (
          <Card style={styles.explicacaoCorpo}>
            <ThemedText type="small" themeColor="textSecondary">
              Começo pelo dinheiro que já está nas suas contas — cartão fica de fora, e só conta o
              que já aconteceu.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Tiro cada fatura não paga no dia em que ela vence, e cada lançamento previsto na data
              dele.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Por isso a compra no cartão sai do caixa quando a fatura vence, não no dia da compra:
              o dinheiro ainda está com você até lá.
            </ThemedText>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: Space.md,
  },
  heroTitulo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  heroTexto: {
    flex: 1,
  },
  heroSplit: {
    flexDirection: 'row',
    gap: Space.xl,
  },
  heroParte: {
    gap: Space.xs,
  },
  simulador: {
    gap: Space.lg,
  },
  parcela: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingTop: Space.xs,
  },
  trailing: {
    alignItems: 'flex-end',
    gap: Space.xs,
  },
  band: {
    alignItems: 'center',
    gap: Space.sm,
  },
  bandText: {
    textAlign: 'center',
  },
  calmo: {
    paddingHorizontal: Space.lg,
  },
  explicacao: {
    gap: Space.sm,
  },
  explicacaoCabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
  },
  explicacaoCorpo: {
    gap: Space.sm,
  },
});
