import { useMemo } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderActions } from '@/components/ui/header-actions';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { HeroPanel } from '@/components/ui/hero-panel';
import type { QuickAction } from '@/components/ui/quick-actions';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar, Sparkline } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { StatusBar } from 'expo-status-bar';
import { Space, Type, tabular } from '@/design/tokens';
import {
  useAiEvents,
  useBudgetsStatus,
  useCashFlowForecast,
  useMarkPaid,
  useUpcomingBills,
} from '@/hooks/use-finance';
import { formatDateBR, localISODate, useTodayReminders } from '@/hooks/use-items';
import { describeRRule } from '@/lib/rrule-text';

/**
 * Hoje — a aba que responde "o que eu preciso saber agora?".
 *
 * Substitui a antiga aba Notas nesta rota e absorve a antiga aba Lembretes: lembrete não é um
 * destino, é algo que vence.
 *
 * **Bloco sem dado não aparece.** Em dia tranquilo a tela é curta e diz isso, em vez de empurrar
 * cinco cabeçalhos vazios para parecer cheia.
 */
export default function TodayScreen() {
  const toast = useToast();
  const { width } = useWindowDimensions();

  const daysLeft = useMemo(() => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return Math.max(1, Math.ceil((last.getTime() - now.getTime()) / 86_400_000));
  }, []);

  const forecast = useCashFlowForecast(daysLeft);
  const bills = useUpcomingBills(7);
  const reminders = useTodayReminders();
  const budgets = useBudgetsStatus();
  const ai = useAiEvents(5);
  const markPaid = useMarkPaid();

  const leftover = forecast.data?.at(-1)?.balance_cents ?? 0;
  const series = (forecast.data ?? []).map((d) => Number(d.balance_cents));

  /**
   * A sparkline só entra quando a série DIZ alguma coisa.
   *
   * Perto da virada do mês a projeção tem dois ou três pontos praticamente iguais, e o gráfico
   * vira uma **linha reta** — que não lê como gráfico, lê como divisor no meio do painel. É o
   * mesmo princípio que já vale para o card que soma uma lista de um item: desenho que não
   * acrescenta informação é ruído, e some.
   *
   * O corte é 1% de amplitude sobre o maior valor absoluto da série — abaixo disso a linha é
   * visualmente horizontal de qualquer jeito.
   */
  const spread = series.length > 1 ? Math.max(...series) - Math.min(...series) : 0;
  const escala = Math.max(...series.map(Math.abs), 1);
  const serieInforma = series.length > 2 && spread / escala > 0.01;

  const overdue = (bills.data ?? []).filter((b) => b.overdue);
  const dueSoon = (bills.data ?? []).filter((b) => !b.overdue);
  const tight = (budgets.data ?? []).filter(
    (b) => Number(b.limit_cents) > 0 && Number(b.spent_cents) / Number(b.limit_cents) >= 0.8
  );
  const recent = (ai.data ?? []).filter((e) => e.actions.length > 0);

  const loading = forecast.isLoading && bills.isLoading;
  const anyError = forecast.isError || bills.isError || reminders.isError || budgets.isError;
  // Empty e erro são coisas diferentes: "não tem nada" não pode aparecer quando na verdade
  // é "não consegui carregar".
  const allEmpty =
    !anyError &&
    !forecast.isLoading &&
    leftover === 0 &&
    overdue.length === 0 &&
    dueSoon.length === 0 &&
    (reminders.data ?? []).length === 0 &&
    tight.length === 0 &&
    recent.length === 0;

  const pay = (id: string, title: string) =>
    markPaid.mutate(
      { id, paidAt: localISODate() },
      {
        onSuccess: () => toast({ message: `${title} marcado como pago.`, tone: 'success' }),
        onError: () => toast({ message: `Não deu para dar baixa em ${title}.`, tone: 'error' }),
      }
    );

  /**
   * Os atalhos do painel são **decisões pendentes**, não destinos.
   *
   * A referência que inspirou o painel (app de banco) põe aqui verbos de dinheiro — Pix, pagar,
   * transferir. Aqui isso não cabe: o app não movimenta dinheiro, ele mostra o que a IA
   * registrou a partir do WhatsApp. Repetir aquele grid daria quatro botões que navegam para
   * onde a tab bar já leva.
   *
   * Então cada tile carrega a contagem do que espera decisão — e **tile com zero não aparece**.
   */
  const atalhos: QuickAction[] = [
    {
      label: 'Vencendo',
      icon: 'calendar',
      count: overdue.length + dueSoon.length,
      onPress: () => router.push('/finance/transactions'),
    },
    {
      label: 'Lembretes',
      icon: 'bell',
      count: (reminders.data ?? []).length,
      onPress: () => router.push('/reminders'),
    },
    {
      label: 'Orçamento',
      icon: 'chart.pie',
      count: tight.length,
      onPress: () => router.push('/finance/budgets'),
    },
    {
      label: 'Revisar IA',
      icon: 'sparkles',
      count: recent.length,
      onPress: () => router.push('/ai-activity'),
    },
  ];

  return (
    <Screen
      grouped
      header={
        forecast.data ? (
          <HeroPanel
            label="Sobra até o fim do mês"
            value={
              <Money
                cents={leftover}
                variant="heroMoney"
                tone={leftover < 0 ? 'danger' : 'onHero'}
                concealable
              />
            }
            secondary={`${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'} até virar o mês`}
            chart={
              serieInforma ? (
                <Sparkline values={series} width={width - Space.lg * 2} showZero />
              ) : undefined
            }
            actions={atalhos}
            concealable
            onPress={() => router.push('/finance/forecast')}
          />
        ) : undefined
      }
      onRefresh={() => {
        forecast.refetch();
        bills.refetch();
        reminders.refetch();
        budgets.refetch();
        ai.refetch();
      }}
      refreshing={forecast.isRefetching}>
      {/* Título e cores do cabeçalho moram no `_layout` da aba. */}
      <StatusBar style="light" />

      {/* Os dois ícones eram uma `View` à mão com `gap: 16` — e o iOS 26 desenhava a pílula de
          vidro em volta dela, com o nosso respiro em vez do do sistema. `plus.circle.fill` ao
          lado de `magnifyingglass` ainda misturava preenchido com contorno no mesmo header
          (`design.md` §4); "Nova nota" agora usa o MESMO ícone da aba Notas. */}
      <HeaderActions
        onHero
        actions={[
          { label: 'Buscar', icon: 'magnifyingglass', onPress: () => router.push('/search') },
          { label: 'Nova nota', icon: 'square.and.pencil', onPress: () => router.push('/notes/new') },
        ]}
      />

      {loading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {forecast.isError ? (
        <Section title="Sobra do mês">
          <Row
            title="Não deu para calcular sua sobra"
            subtitle="Toque para tentar de novo"
            icon="exclamationmark.triangle"
            onPress={() => forecast.refetch()}
          />
        </Section>
      ) : null}

      {/* Vem em segundo porque é a única coisa da tela com consequência se ignorada. */}
      {bills.isError ? (
        <Section title="O que vence">
          <Row
            title="Não deu para carregar o que vence"
            subtitle="Toque para tentar de novo"
            icon="exclamationmark.triangle"
            onPress={() => bills.refetch()}
          />
        </Section>
      ) : null}
      {overdue.length > 0 ? (
        <Section title="Atrasado">
          {overdue.map((b) => (
            <Row
              key={b.ref_id}
              title={b.title}
              subtitle={`venceu em ${formatDateBR(b.due_date)}`}
              icon={b.kind === 'invoice' ? 'creditcard' : 'exclamationmark.circle'}
              accessibilityLabel={`${b.title}, atrasado, vencia em ${formatDateBR(b.due_date)}`}
              trailing={
                <View style={styles.trailing}>
                  <Money cents={Number(b.amount_cents)} variant="headline" tone="danger" />
                  {b.kind === 'transaction' ? (
                    <Button label="Paguei" size="sm" variant="secondary" onPress={() => pay(b.ref_id, b.title)} />
                  ) : null}
                </View>
              }
            />
          ))}
        </Section>
      ) : null}

      {dueSoon.length > 0 ? (
        <Section title="Vence nos próximos dias">
          {dueSoon.map((b) => (
            <Row
              key={b.ref_id}
              title={b.title}
              subtitle={formatDateBR(b.due_date)}
              icon={b.kind === 'invoice' ? 'creditcard' : 'calendar'}
              trailing={
                <View style={styles.trailing}>
                  <Money cents={Number(b.amount_cents)} variant="headline" />
                  {b.kind === 'transaction' ? (
                    <Button label="Paguei" size="sm" variant="secondary" onPress={() => pay(b.ref_id, b.title)} />
                  ) : null}
                </View>
              }
            />
          ))}
        </Section>
      ) : null}

      {(reminders.data ?? []).length > 0 ? (
        <Section title="Lembretes de hoje">
          {reminders.data!.map((r) => (
            <Row
              key={r.id}
              title={r.title}
              subtitle={
                r.recurrence
                  ? describeRRule(r.recurrence)
                  : new Date(r.next_run_at).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
              }
              icon="bell"
              onPress={() => router.push(`/reminder-form?id=${r.id}`)}
            />
          ))}
        </Section>
      ) : null}

      {tight.length > 0 ? (
        <Section title="Passando do orçamento">
          {tight.map((b) => {
            const pct = Number(b.spent_cents) / Number(b.limit_cents);
            return (
              <View key={b.category} style={styles.budget}>
                <View style={styles.budgetHead}>
                  <ThemedText type="default">{b.category}</ThemedText>
                  <ThemedText type="small" themeColor={pct >= 1 ? 'danger' : 'warning'} style={tabular}>
                    {Math.round(pct * 100)}%
                  </ThemedText>
                </View>
                <ProgressBar
                  value={Number(b.spent_cents)}
                  max={Number(b.limit_cents)}
                  tone={pct >= 1 ? 'danger' : 'warning'}
                />
              </View>
            );
          })}
        </Section>
      ) : null}

      {/* Por último: é confirmação, não decisão. */}
      {recent.length > 0 ? (
        <Section title="A IA registrou">
          {recent.map((e) => (
            <Row
              key={e.id}
              title={e.actions.map((a) => a.content ?? a.title ?? a.type).join(' · ')}
              subtitle={formatDateBR(e.created_at)}
              icon="sparkles"
              onPress={() => router.push('/ai-activity')}
            />
          ))}
        </Section>
      ) : null}

      {allEmpty ? (
        <EmptyState
          icon="sparkles"
          title="Tudo começa no WhatsApp"
          hint={'Manda “gastei 45 no mercado” ou\n“me lembra de pagar aluguel dia 5”'}
        />
      ) : null}

      {/* Só afirma "nada vence" quando a consulta REALMENTE respondeu — senão é palpite. */}
      {!allEmpty && !loading && !bills.isError && bills.isSuccess && overdue.length === 0 && dueSoon.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.calm}>
          Nada vence hoje.
        </ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  trailing: {
    alignItems: 'flex-end',
    gap: Space.xs,
  },
  budget: {
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  budgetHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  calm: {
    ...Type.footnote,
    paddingHorizontal: Space.lg,
  },
});
