import { useMemo } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ErrorCard } from '@/components/error-card';
import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { useConceal } from '@/components/ui/conceal';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { SectionHead } from '@/components/ui/section-head';
import { Skeleton } from '@/components/ui/skeleton';
import { ProgressBar, Sparkline } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Radius, Space, tabular } from '@/design/tokens';
import {
  useBudgetsStatus,
  useCashFlowForecast,
  useMarkPaid,
  useRecentTransactions,
  useUpcomingBills,
} from '@/hooks/use-finance';
import { formatBRL, formatDateBR, localISODate, useTodayReminders } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';
import { Fonts } from '@/constants/theme';

/** Um orçamento entra na seção "passando do orçamento" a partir de 80% consumido. */
const TIGHT = 0.8;

/**
 * A raiz da aba Hoje, no desenho do Stitch.
 *
 * A ordem das seções é a do design e é uma ordem de URGÊNCIA: o número que responde "dá para
 * gastar?", os três contadores, o que já venceu, o que acontece hoje, o que está estourando e,
 * por último, o que acabou de chegar do WhatsApp. Cada seção só existe se tiver conteúdo — o
 * desenho mostra as cinco cheias porque é uma composição, não porque a tela deva inventar
 * linha quando não há dado. Sem nada, a tela é um `EmptyState` com o atalho do WhatsApp.
 */
export default function TodayScreen() {
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { concealed, toggle } = useConceal();

  const { daysLeft, monthEndDay } = useMemo(() => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      daysLeft: Math.max(1, last.getDate() - now.getDate()),
      monthEndDay: last.getDate(),
    };
  }, []);

  const forecast = useCashFlowForecast(daysLeft);
  const bills = useUpcomingBills(7);
  const reminders = useTodayReminders();
  const budgets = useBudgetsStatus();
  const recent = useRecentTransactions(5);
  const markPaid = useMarkPaid();

  const series = (forecast.data ?? []).map((d) => Number(d.balance_cents));
  const leftover = series.at(-1) ?? 0;

  const overdue = (bills.data ?? []).filter((b) => b.overdue);
  const dueSoon = (bills.data ?? []).filter((b) => !b.overdue);
  const todayReminders = reminders.data ?? [];
  const tight = (budgets.data ?? []).filter(
    (b) => Number(b.limit_cents) > 0 && Number(b.spent_cents) / Number(b.limit_cents) >= TIGHT
  );
  const captured = (recent.data ?? []).find((tx) => tx.source === 'whatsapp');

  const loading = forecast.isLoading || bills.isLoading || reminders.isLoading;
  const nothing =
    !loading &&
    overdue.length === 0 &&
    dueSoon.length === 0 &&
    todayReminders.length === 0 &&
    tight.length === 0 &&
    !captured;

  const pay = (id: string, title: string) =>
    markPaid.mutate(
      { id, paidAt: localISODate() },
      {
        onSuccess: () => toast({ message: `${title} marcado como pago.`, tone: 'success' }),
        onError: () => toast({ message: `Não deu para dar baixa em ${title}.`, tone: 'error' }),
      }
    );

  /** Largura útil do gráfico: tela menos a calha da tela menos a calha do painel. */
  const chartWidth = width - Space.lg * 2 - Space.gutter * 2;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <AppHeader />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Space.xxxl * 2 }]}
        showsVerticalScrollIndicator={false}>
        {/* 1. Painel de destaque — a sobra projetada até o fim do mês. */}
        <View style={[styles.hero, { backgroundColor: theme.heroSurface, borderColor: theme.cardBorder }]}>
          {/* O fio de luz no topo do painel: é o `via-primary/20` do Stitch, e é ele que dá a
              impressão de superfície curva sem precisar de gradiente de verdade. */}
          <View style={[styles.specular, { backgroundColor: theme.heroSeparator }]} />

          <View style={styles.heroTop}>
            <ThemedText type="meta" themeColor="onHeroMuted">
              SOBRA ATÉ O FIM DO MÊS
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={concealed ? 'Mostrar valores' : 'Ocultar valores'}
              hitSlop={Space.sm}
              onPress={toggle}
              style={[styles.eye, { backgroundColor: theme.surfaceRaised }]}>
              <Icon name={concealed ? 'eye.slash' : 'eye'} size="sm" color="onHero" />
            </Pressable>
          </View>

          {forecast.isLoading ? (
            <Skeleton width={220} height={38} />
          ) : forecast.isError ? (
            <ErrorCard onRetry={() => forecast.refetch()} />
          ) : (
            <>
              <Money
                cents={leftover}
                variant="heroMoney"
                tone={leftover < 0 ? 'danger' : 'onHero'}
                concealable
              />

              <View style={styles.trend}>
                <Icon
                  name={leftover < 0 ? 'chart.line.downtrend.xyaxis' : 'chart.line.uptrend.xyaxis'}
                  size="sm"
                  color={leftover < 0 ? 'danger' : 'success'}
                />
                <ThemedText type="code" themeColor={leftover < 0 ? 'danger' : 'success'}>
                  {`${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'} até virar o mês · Projeção ${
                    leftover < 0 ? 'negativa' : 'positiva'
                  }`}
                </ThemedText>
              </View>

              {series.length > 1 ? (
                <View style={styles.chart}>
                  <View style={styles.legend}>
                    <ThemedText type="caption" themeColor="onHeroMuted">
                      Hoje
                    </ThemedText>
                    <ThemedText type="caption" themeColor={leftover < 0 ? 'danger' : 'success'}>
                      {`${formatBRL(leftover)} projetado`}
                    </ThemedText>
                    <ThemedText type="caption" themeColor="onHeroMuted">
                      {`Dia ${monthEndDay}`}
                    </ThemedText>
                  </View>
                  <Sparkline values={series} width={chartWidth} showZero={false} />
                </View>
              ) : null}
            </>
          )}
        </View>

        {/* 2. Os três contadores. Número real — zero é informação, não motivo para esconder. */}
        <View style={styles.triad}>
          <Counter
            label="Vencendo"
            value={overdue.length + dueSoon.length}
            tone={overdue.length > 0 ? 'danger' : 'textSecondary'}
            onPress={() => router.push('/finance/transactions')}
          />
          <Counter
            label="Lembretes"
            value={todayReminders.length}
            tone={todayReminders.length > 0 ? 'warning' : 'textSecondary'}
            onPress={() => router.push('/reminders')}
          />
          <Counter
            label="Orçamento"
            value={tight.length}
            tone={tight.length > 0 ? 'warning' : 'textSecondary'}
            onPress={() => router.push('/finance/budgets')}
          />
        </View>

        {loading ? (
          <View style={styles.section}>
            <Skeleton width="100%" height={92} radius={Radius.md} />
            <Skeleton width="100%" height={140} radius={Radius.md} />
          </View>
        ) : null}

        {nothing ? (
          <View style={styles.empty}>
            <EmptyState
              title="Nada para hoje"
              hint="Mande um áudio ou uma mensagem no WhatsApp e o que você contar aparece aqui organizado."
            />
          </View>
        ) : null}

        {/* 3. O que já venceu. */}
        {bills.isError ? (
          <View style={styles.section}>
            <SectionHead title="Atrasado / atenção" dot="danger" inset={false} />
            <ErrorCard onRetry={() => bills.refetch()} />
          </View>
        ) : overdue.length > 0 ? (
          <View style={styles.section}>
            <SectionHead
              title="Atrasado / atenção"
              dot="danger"
              inset={false}
              action={
                <ThemedText type="caption" themeColor="textSecondary">
                  {`${overdue.length} ${overdue.length === 1 ? 'pendência' : 'pendências'}`}
                </ThemedText>
              }
            />
            {overdue.map((b) => (
              <View
                key={b.ref_id}
                style={[styles.card, styles.billCard, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
                <View style={styles.billInfo}>
                  <View style={styles.billTitleRow}>
                    <ThemedText type="headline" numberOfLines={1} style={styles.shrink}>
                      {b.title}
                    </ThemedText>
                    <View style={[styles.duePill, { backgroundColor: theme.dangerSoft }]}>
                      <ThemedText type="caption" themeColor="danger">
                        {`VENCEU EM ${formatDateBR(b.due_date)}`}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText type="ticker" themeColor="danger" style={tabular}>
                    {formatBRL(Number(b.amount_cents))}
                  </ThemedText>
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
        ) : null}

        {/* 4. Os lembretes de hoje, agrupados numa superfície só, como no desenho. */}
        {reminders.isError ? (
          <View style={styles.section}>
            <SectionHead title="Lembretes de hoje" dot="text" inset={false} />
            <ErrorCard onRetry={() => reminders.refetch()} />
          </View>
        ) : todayReminders.length > 0 ? (
          <View style={styles.section}>
            <SectionHead
              title="Lembretes de hoje"
              dot="text"
              inset={false}
              action={
                <ThemedText type="caption" themeColor="textSecondary">
                  {`${todayReminders.length} ${todayReminders.length === 1 ? 'agendado' : 'agendados'}`}
                </ThemedText>
              }
            />
            <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
              {todayReminders.map((r, i) => (
                <View key={r.id}>
                  {i > 0 ? <View style={[styles.divider, { backgroundColor: theme.cardBorder }]} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push({ pathname: '/reminder-form', params: { id: r.id } })}
                    style={styles.taskRow}>
                    <View style={[styles.check, { borderColor: theme.separator }]} />
                    <View style={styles.shrink}>
                      <ThemedText type="small" numberOfLines={1}>
                        {r.title}
                      </ThemedText>
                      <View style={styles.taskMeta}>
                        <ThemedText type="code" themeColor="textSecondary">
                          {timeOf(r.next_run_at)}
                        </ThemedText>
                        <View style={[styles.metaDot, { backgroundColor: theme.separator }]} />
                        {r.channel === 'whatsapp' ? (
                          <View style={styles.tag}>
                            <Icon name="bubble.left" size="xs" color="success" />
                            <ThemedText type="caption" themeColor="success">
                              via WhatsApp
                            </ThemedText>
                          </View>
                        ) : (
                          <ThemedText type="caption" themeColor="textSecondary">
                            no app
                          </ThemedText>
                        )}
                      </View>
                    </View>
                    <Icon name={r.recurrence ? 'arrow.clockwise' : 'bell'} size="sm" color="textSecondary" />
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* 5. Orçamento apertado — barra em `warning`/`danger`, que é ESTADO a resolver. */}
        {tight.length > 0 ? (
          <View style={styles.section}>
            <SectionHead title="Passando do orçamento" dot="warning" inset={false} />
            {tight.map((b) => {
              const spent = Number(b.spent_cents);
              const limit = Number(b.limit_cents);
              const pct = Math.round((spent / limit) * 100);
              const left = limit - spent;

              return (
                <View
                  key={b.category}
                  style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
                  <View style={styles.budgetTop}>
                    <View style={[styles.iconCircle, { backgroundColor: theme.surfaceRaised }]}>
                      <Icon name="fork.knife" size="sm" color="text" />
                    </View>
                    <View style={styles.shrink}>
                      <ThemedText type="headline" numberOfLines={1}>
                        {b.category}
                      </ThemedText>
                      <ThemedText type="caption" themeColor="textSecondary">
                        {`Teto do mês: ${formatBRL(limit)}`}
                      </ThemedText>
                    </View>
                    <ThemedText type="ticker" themeColor={left < 0 ? 'danger' : 'text'} style={tabular}>
                      {`${pct}%`}
                    </ThemedText>
                  </View>

                  <ProgressBar value={spent} max={limit} tone={left < 0 ? 'danger' : 'warning'} />

                  <View style={styles.budgetFoot}>
                    <View style={styles.tag}>
                      <Icon name="exclamationmark.triangle" size="xs" color={left < 0 ? 'danger' : 'warning'} />
                      <ThemedText type="caption" themeColor={left < 0 ? 'danger' : 'warning'}>
                        {left < 0 ? `${formatBRL(-left)} acima` : `${formatBRL(left)} restantes`}
                      </ThemedText>
                    </View>
                    <ThemedText type="caption" themeColor="textSecondary">
                      {`${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'} até fechar`}
                    </ThemedText>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* 6. O que acabou de chegar pelo WhatsApp — a prova de que o canal funcionou. */}
        {captured ? (
          <View style={styles.section}>
            <SectionHead
              title="Capturado no WhatsApp"
              dot="success"
              inset={false}
              action={
                <ThemedText type="code" themeColor="success" style={tabular}>
                  {timeOf(captured.created_at)}
                </ThemedText>
              }
            />
            <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
              <View style={styles.captureTop}>
                <View style={[styles.iconCircle, { backgroundColor: theme.successSoft }]}>
                  <Icon name="mic" size="sm" color="success" />
                </View>
                <View style={styles.shrink}>
                  <ThemedText type="small" numberOfLines={1} style={styles.quote}>
                    {`“${captured.description ?? 'Lançamento por mensagem'}”`}
                  </ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    Registrado pela IA do ProOps
                  </ThemedText>
                </View>
                <View style={[styles.amountBadge, { backgroundColor: theme.surfaceRaised }]}>
                  <ThemedText type="code" themeColor="textSecondary" style={tabular}>
                    {`${captured.kind === 'income' ? '+' : '−'} ${formatBRL(Number(captured.amount_cents))}`}
                  </ThemedText>
                </View>
              </View>

              <View style={[styles.divider, { backgroundColor: theme.cardBorder }]} />

              <View style={styles.captureFoot}>
                <View style={styles.tag}>
                  <Icon name="checkmark.circle" size="xs" color="success" />
                  <ThemedText type="caption" themeColor="textSecondary">
                    {`Lançado em ${captured.category ?? 'sem categoria'}`}
                  </ThemedText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={Space.sm}
                  onPress={() => router.push(`/finance/${captured.id}`)}>
                  <ThemedText type="link">Editar</ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * Um dos três contadores da faixa. Vive aqui porque só esta tela usa (regra de `frontend.md`).
 *
 * O ponto à direita é cor SEMÂNTICA e apaga quando a contagem é zero — mesma régua do badge de
 * aba: sinal que está sempre aceso deixa de ser sinal.
 */
function Counter({
  label,
  value,
  tone,
  onPress,
}: {
  label: string;
  value: number;
  tone: 'danger' | 'warning' | 'textSecondary';
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={[styles.counter, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      <View style={styles.shrink}>
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
          {label}
        </ThemedText>
        <ThemedText type="headline" style={tabular}>
          {value}
        </ThemedText>
      </View>
      {value > 0 ? <View style={[styles.counterDot, { backgroundColor: theme[tone] }]} /> : null}
    </Pressable>
  );
}

/** `HH:MM` local a partir de um timestamp ISO. Vazio vira travessão, nunca "Invalid Date". */
function timeOf(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: Space.lg, gap: Space.xl },
  shrink: { flex: 1, minWidth: 0 },

  hero: {
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    padding: Space.gutter,
    gap: Space.sm,
    overflow: 'hidden',
  },
  specular: { position: 'absolute', top: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eye: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trend: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  chart: { marginTop: Space.md, gap: Space.xs },
  legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  triad: { flexDirection: 'row', gap: Space.sm },
  counter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.xs,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  counterDot: { width: 8, height: 8, borderRadius: Radius.pill },

  section: { gap: Space.sm },
  empty: { paddingVertical: Space.xl },

  card: {
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    gap: Space.md,
  },
  billCard: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  billInfo: { flex: 1, minWidth: 0, gap: Space.xs },
  billTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  duePill: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.half,
    borderRadius: Radius.pill,
  },

  group: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  divider: { height: StyleSheet.hairlineWidth },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.lg },
  check: { width: 20, height: 20, borderRadius: Radius.pill, borderWidth: 1.5 },
  taskMeta: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: Space.half },
  metaDot: { width: 3, height: 3, borderRadius: Radius.pill },
  tag: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },

  budgetTop: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  budgetFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  captureTop: { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.lg },
  quote: { fontFamily: Fonts.italic },
  amountBadge: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  captureFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Space.lg,
  },
});
