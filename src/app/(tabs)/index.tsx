import { useMemo } from 'react';
import { Stack, router } from 'expo-router';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ErrorCard } from '@/components/error-card';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar, Sparkline } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Motion, Space, Type, tabular } from '@/design/tokens';
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

  const overdue = (bills.data ?? []).filter((b) => b.overdue);
  const dueSoon = (bills.data ?? []).filter((b) => !b.overdue);
  const tight = (budgets.data ?? []).filter(
    (b) => Number(b.limit_cents) > 0 && Number(b.spent_cents) / Number(b.limit_cents) >= 0.8
  );
  const recent = (ai.data ?? []).filter((e) => e.actions.length > 0);

  const loading = forecast.isLoading && bills.isLoading;
  const allEmpty =
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

  return (
    <Screen
      grouped
      onRefresh={() => {
        forecast.refetch();
        bills.refetch();
        reminders.refetch();
        budgets.refetch();
        ai.refetch();
      }}
      refreshing={forecast.isRefetching}>
      <Stack.Screen
        options={{
          title: 'Hoje',
          headerLargeTitle: true,
          headerRight: () => (
            <View style={styles.headerActions}>
              <Pressable
                accessibilityLabel="Buscar"
                hitSlop={12}
                onPress={() => router.push('/search')}>
                <Icon name="magnifyingglass" size="lg" color="tint" />
              </Pressable>
              <Pressable
                accessibilityLabel="Nova nota"
                hitSlop={12}
                onPress={() => router.push('/notes/new')}>
                <Icon name="plus.circle.fill" size="lg" color="tint" />
              </Pressable>
            </View>
          ),
        }}
      />

      {loading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {/* O único GlassCard da tela: é a pergunta que mais gente tem ao abrir o app. */}
      {forecast.isError ? (
        <ErrorCard onRetry={forecast.refetch} />
      ) : forecast.data ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <Pressable onPress={() => router.push('/finance/forecast')}>
            <GlassCard style={styles.hero}>
              <ThemedText type="small" themeColor="textSecondary">
                Sobra até o fim do mês
              </ThemedText>
              <Money cents={leftover} variant="money" tone={leftover < 0 ? 'danger' : 'text'} />
              <Sparkline values={series} width={width - Space.lg * 4} showZero />
              <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'} até virar o mês
              </ThemedText>
            </GlassCard>
          </Pressable>
        </Animated.View>
      ) : null}

      {/* Vem em segundo porque é a única coisa da tela com consequência se ignorada. */}
      {bills.isError ? <ErrorCard onRetry={bills.refetch} /> : null}
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
              onPress={() => router.push('/finance/ai-activity')}
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

      {!allEmpty && !loading && overdue.length === 0 && dueSoon.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.calm}>
          Nada vence hoje.
        </ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: 'row',
    gap: Space.lg,
  },
  hero: {
    gap: Space.sm,
  },
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
