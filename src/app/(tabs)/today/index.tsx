import { useMemo } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderActions } from '@/components/ui/header-actions';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { HeroPanel } from '@/components/ui/hero-panel';
import type { QuickAction } from '@/components/ui/quick-actions';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar, Sparkline } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Radius, Space, Type, tabular } from '@/design/tokens';
import {
  useBudgetsStatus,
  useCashFlowForecast,
  useMarkPaid,
  useRecentTransactions,
  useUpcomingBills,
} from '@/hooks/use-finance';
import { formatDateBR, localISODate, useTodayReminders } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';
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
  const theme = useTheme();
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
  const recent = useRecentTransactions(5);
  const markPaid = useMarkPaid();

  const recentWhatsApp =
    (recent.data ?? []).find((tx) => tx.source === 'whatsapp') ?? recent.data?.[0];

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
    !recentWhatsApp;

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
            trend={
              leftover > 0
                ? { value: 'Projeção positiva', positive: true, label: `${daysLeft}d restantes` }
                : leftover < 0
                  ? { value: 'Atenção ao saldo', positive: false, label: 'ritmo acima do teto' }
                  : undefined
            }
            chart={
              serieInforma ? (
                <Sparkline values={series} width={width - Space.lg * 2} showZero />
              ) : undefined
            }
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
        recent.refetch();
      }}
      refreshing={forecast.isRefetching}>
      {/* Título, cores do cabeçalho e estilo da status bar moram no `_layout` da aba. */}
      <HeaderActions
        onHero
        actions={[
          { label: 'Buscar', icon: 'magnifyingglass', onPress: () => router.push('/search') },
          { label: 'Nova nota', icon: 'square.and.pencil', onPress: () => router.push('/notes/new') },
        ]}
      />

      {/* Faixa Triad de Status — Vencendo, Lembretes, Orçamentos (Stitch Seção 2) */}
      <View style={styles.triadGrid}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Vencendo: ${overdue.length + dueSoon.length}`}
          onPress={() => router.push('/finance/transactions')}
          style={[styles.triadPill, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
          <View style={styles.triadText}>
            <ThemedText type="caption" themeColor="textSecondary">
              Vencendo
            </ThemedText>
            <ThemedText type="headline" style={tabular}>
              {overdue.length + dueSoon.length}
            </ThemedText>
          </View>
          <View
            style={[
              styles.triadDot,
              { backgroundColor: overdue.length > 0 ? theme.danger : theme.success },
            ]}
          />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Lembretes: ${(reminders.data ?? []).length}`}
          onPress={() => router.push('/reminders')}
          style={[styles.triadPill, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
          <View style={styles.triadText}>
            <ThemedText type="caption" themeColor="textSecondary">
              Lembretes
            </ThemedText>
            <ThemedText type="headline" style={tabular}>
              {(reminders.data ?? []).length}
            </ThemedText>
          </View>
          <View
            style={[
              styles.triadDot,
              {
                backgroundColor:
                  (reminders.data ?? []).length > 0 ? theme.warning : theme.textSecondary,
              },
            ]}
          />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Orçamento: ${tight.length}`}
          onPress={() => router.push('/finance/budgets')}
          style={[styles.triadPill, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
          <View style={styles.triadText}>
            <ThemedText type="caption" themeColor="textSecondary">
              Orçamento
            </ThemedText>
            <ThemedText type="headline" style={tabular}>
              {tight.length}
            </ThemedText>
          </View>
          <View
            style={[
              styles.triadDot,
              { backgroundColor: tight.length > 0 ? theme.warning : theme.tint },
            ]}
          />
        </Pressable>
      </View>

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

      {/* Atrasado / Atenção — Cards elevados com tag pill e ação Paguei direta (Stitch Seção 3) */}
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
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleWrap}>
              <View style={[styles.statusDot, { backgroundColor: theme.danger }]} />
              <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionTitle}>
                ATRASADO / ATENÇÃO
              </ThemedText>
            </View>
            <View style={[styles.badgePill, { backgroundColor: theme.accentSoft }]}>
              <ThemedText type="caption" themeColor="danger" style={styles.badgePillText}>
                {`${overdue.length} ${overdue.length === 1 ? 'pendência' : 'pendências'}`}
              </ThemedText>
            </View>
          </View>

          <View style={styles.cardList}>
            {overdue.map((b) => (
              <View
                key={b.ref_id}
                style={[
                  styles.urgentCard,
                  { backgroundColor: theme.surface, borderColor: theme.separator },
                ]}>
                <View style={styles.urgentCardLeft}>
                  <View style={styles.urgentTitleRow}>
                    <ThemedText type="headline" numberOfLines={1} style={styles.urgentTitle}>
                      {b.title}
                    </ThemedText>
                    <View style={[styles.duePill, { backgroundColor: theme.accentSoft }]}>
                      <ThemedText type="caption" themeColor="danger" style={styles.duePillText}>
                        {`venceu em ${formatDateBR(b.due_date)}`}
                      </ThemedText>
                    </View>
                  </View>

                  <View style={styles.urgentSubRow}>
                    <Money cents={Number(b.amount_cents)} variant="headline" tone="danger" />
                    <ThemedText type="caption" themeColor="textSecondary">
                      · {b.kind === 'invoice' ? 'Fatura Cartão' : 'Despesa'}
                    </ThemedText>
                  </View>
                </View>

                <Button
                  label="Paguei"
                  icon="checkmark"
                  size="sm"
                  variant="secondary"
                  onPress={() => pay(b.ref_id, b.title)}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Capturado no WhatsApp — o selo do produto, mostrando em tempo real o que a IA registrou */}
      {recentWhatsApp ? (
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleWrap}>
              <Icon name="waveform" size="sm" color="success" />
              <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionTitle}>
                CAPTURADO NO WHATSAPP
              </ThemedText>
            </View>
            <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
              {formatDateBR(recentWhatsApp.occurred_at)}
            </ThemedText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Última captura: ${recentWhatsApp.description || recentWhatsApp.merchant || 'Lançamento'}, ${recentWhatsApp.category}`}
            onPress={() => router.push(`/finance/${recentWhatsApp.id}`)}>
            {({ pressed }) => (
              <View
                style={[
                  styles.captureCard,
                  {
                    backgroundColor: pressed ? theme.backgroundSelected : theme.surface,
                    borderColor: theme.separator,
                  },
                ]}>
                <View style={styles.captureHead}>
                  <View style={[styles.captureBadge, { backgroundColor: theme.accentSoft }]}>
                    <Icon name="waveform" size="sm" color="success" />
                    <ThemedText type="caption" themeColor="success" style={styles.captureSync}>
                      IA Sync WhatsApp
                    </ThemedText>
                  </View>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {recentWhatsApp.category} · IA ProOps
                  </ThemedText>
                </View>

                <View style={styles.captureBody}>
                  <View style={styles.captureTextCol}>
                    <ThemedText type="headline" numberOfLines={2}>
                      "{recentWhatsApp.description || recentWhatsApp.merchant || 'Lançamento via WhatsApp'}"
                    </ThemedText>
                  </View>
                  <Money
                    cents={Number(recentWhatsApp.amount_cents)}
                    variant="headline"
                    tone={recentWhatsApp.kind === 'expense' ? 'danger' : 'success'}
                  />
                </View>
              </View>
            )}
          </Pressable>
        </View>
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

      {/* Sem `icon`: vazio genérico usa a espiral (`design.md` §2b). O `sparkles` que estava
          aqui era uma referência à IA, sobra da tela de Atividade removida. */}
      {allEmpty ? (
        <EmptyState
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
  captureCard: {
    padding: Space.lg,
    gap: Space.md,
  },
  captureHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  captureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.half,
    borderRadius: Radius.pill,
  },
  captureSync: {
    fontWeight: '600',
  },
  captureBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Space.md,
  },
  captureTextCol: {
    flex: 1,
    gap: Space.half,
  },
  triadGrid: {
    flexDirection: 'row',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    marginTop: Space.md,
    marginBottom: Space.sm,
  },
  triadPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  triadText: {
    gap: Space.half,
  },
  triadDot: {
    width: 8,
    height: 8,
    borderRadius: Radius.pill,
  },
  sectionBlock: {
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    marginTop: Space.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.xs,
  },
  sectionTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.pill,
  },
  sectionTitle: {
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  badgePill: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.half,
    borderRadius: Radius.pill,
  },
  badgePillText: {
    fontWeight: '600',
  },
  cardList: {
    gap: Space.sm,
  },
  urgentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Space.lg,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    gap: Space.md,
  },
  urgentCardLeft: {
    flex: 1,
    gap: Space.xs,
  },
  urgentTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    flexWrap: 'wrap',
  },
  urgentTitle: {
    flexShrink: 1,
  },
  duePill: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.half,
    borderRadius: Radius.pill,
  },
  duePillText: {
    fontWeight: '600',
  },
  urgentSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
});
