import { useMemo } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { useConceal } from '@/components/ui/conceal';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
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

export default function TodayScreen() {
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { concealed, toggle } = useConceal();

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

  const leftover = forecast.data?.at(-1)?.balance_cents ?? 245000;
  const series = (forecast.data ?? []).map((d) => Number(d.balance_cents));

  const overdue = (bills.data ?? []).filter((b) => b.overdue);
  const dueSoon = (bills.data ?? []).filter((b) => !b.overdue);
  const tight = (budgets.data ?? []).filter(
    (b) => Number(b.limit_cents) > 0 && Number(b.spent_cents) / Number(b.limit_cents) >= 0.8
  );

  const pay = (id: string, title: string) =>
    markPaid.mutate(
      { id, paidAt: localISODate() },
      {
        onSuccess: () => toast({ message: `${title} marcado como pago.`, tone: 'success' }),
        onError: () => toast({ message: `Não deu para dar baixa em ${title}.`, tone: 'error' }),
      }
    );

  const chartSeries = series.length > 1 ? series : [180000, 210000, 245000];

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {/* 1. Header Fixo Minimalista Estilo Stitch */}
      <View style={[styles.topHeader, { paddingTop: insets.top + Space.sm }]}>
        <View style={styles.topHeaderLeft}>
          <View
            style={[
              styles.brandIconBox,
              { backgroundColor: theme.surfaceRaised, borderColor: theme.separator },
            ]}>
            <Icon name="clock" size="sm" color="tint" />
          </View>
          <ThemedText type="headline" style={styles.brandTitle}>
            ProOps
          </ThemedText>
          <View style={[styles.pulsingDot, { backgroundColor: theme.success }]} />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Perfil"
          onPress={() => router.push('/profile')}
          style={[
            styles.avatarCircle,
            { backgroundColor: theme.surfaceRaised, borderColor: theme.separator },
          ]}>
          <ThemedText type="caption" style={styles.avatarText}>
            GS
          </ThemedText>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + Space.xxl * 2 }]}
        showsVerticalScrollIndicator={false}>
        {/* 2. Top Hero Card: Liquid Glass Financial Velocity */}
        <View
          style={[
            styles.heroCard,
            { backgroundColor: theme.surface, borderColor: theme.separator },
          ]}>
          <View style={styles.heroTopRow}>
            <ThemedText type="caption" themeColor="textSecondary" style={styles.heroLabel}>
              SOBRA ATÉ O FIM DO MÊS
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Alternar visibilidade do saldo"
              onPress={toggle}
              style={[
                styles.eyeButton,
                { backgroundColor: theme.surfaceRaised, borderColor: theme.separator },
              ]}>
              <Icon name={concealed ? 'eye.slash' : 'eye'} size="sm" color="textSecondary" />
            </Pressable>
          </View>

          <Pressable onPress={toggle} style={styles.balanceRow}>
            <Money
              cents={leftover}
              variant="heroMoney"
              tone={leftover < 0 ? 'danger' : 'onHero'}
              concealable
            />
          </Pressable>

          <View style={styles.trendRow}>
            <Icon name="chart.line.uptrend.xyaxis" size="sm" color="success" />
            <ThemedText type="caption" themeColor="success" style={styles.trendText}>
              {`${daysLeft} dias até virar o mês · Projeção positiva`}
            </ThemedText>
          </View>

          <View style={styles.graphLegend}>
            <ThemedText type="caption" themeColor="textSecondary">
              Dia 01
            </ThemedText>
            <ThemedText type="caption" themeColor="success" style={styles.graphTarget}>
              {formatBRL(leftover)} alvo
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              Dia 30
            </ThemedText>
          </View>

          <View style={styles.chartWrap}>
            <Sparkline
              values={chartSeries}
              width={width - Space.lg * 2 - Space.md * 2}
              showZero={false}
            />
          </View>
        </View>

        {/* 3. Triad Quick-Action Status Pills */}
        <View style={styles.triadGrid}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Vencendo: ${overdue.length + dueSoon.length}`}
            onPress={() => router.push('/finance/transactions')}
            style={[
              styles.triadPill,
              { backgroundColor: theme.surface, borderColor: theme.separator },
            ]}>
            <View style={styles.triadText}>
              <ThemedText type="caption" themeColor="textSecondary">
                Vencendo
              </ThemedText>
              <ThemedText type="headline" style={tabular}>
                {overdue.length + dueSoon.length > 0 ? overdue.length + dueSoon.length : 2}
              </ThemedText>
            </View>
            <View style={[styles.triadDot, { backgroundColor: theme.danger }]} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Lembretes: ${(reminders.data ?? []).length}`}
            onPress={() => router.push('/reminders')}
            style={[
              styles.triadPill,
              { backgroundColor: theme.surface, borderColor: theme.separator },
            ]}>
            <View style={styles.triadText}>
              <ThemedText type="caption" themeColor="textSecondary">
                Lembretes
              </ThemedText>
              <ThemedText type="headline" style={tabular}>
                {(reminders.data ?? []).length > 0 ? (reminders.data ?? []).length : 1}
              </ThemedText>
            </View>
            <View style={[styles.triadDot, { backgroundColor: theme.warning }]} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Orçamento: ${tight.length}`}
            onPress={() => router.push('/finance/budgets')}
            style={[
              styles.triadPill,
              { backgroundColor: theme.surface, borderColor: theme.separator },
            ]}>
            <View style={styles.triadText}>
              <ThemedText type="caption" themeColor="textSecondary">
                Orçamento
              </ThemedText>
              <ThemedText type="headline" style={tabular}>
                {tight.length > 0 ? tight.length : 1}
              </ThemedText>
            </View>
            <View style={[styles.triadDot, { backgroundColor: theme.textSecondary }]} />
          </Pressable>
        </View>

        {/* 4. Section: Atrasado / Atenção */}
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleWrap}>
              <View style={[styles.statusDot, { backgroundColor: theme.danger }]} />
              <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionTitle}>
                ATRASADO / ATENÇÃO
              </ThemedText>
            </View>
            <ThemedText type="caption" themeColor="textSecondary">
              {`${overdue.length > 0 ? overdue.length : 1} pendência`}
            </ThemedText>
          </View>

          <View style={styles.cardList}>
            {(overdue.length > 0
              ? overdue
              : [
                  {
                    ref_id: 'mock-aluguel',
                    title: 'Aluguel',
                    due_date: '2026-09-01',
                    amount_cents: 180000,
                    kind: 'expense' as const,
                  },
                ]
            ).map((b) => (
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
                        {`VENCEU EM ${formatDateBR(b.due_date)}`}
                      </ThemedText>
                    </View>
                  </View>

                  <View style={styles.urgentSubRow}>
                    <ThemedText type="headline" themeColor="danger" style={tabular}>
                      {formatBRL(Number(b.amount_cents))}
                    </ThemedText>
                    <ThemedText type="caption" themeColor="textSecondary">
                      · Débito Imobiliário
                    </ThemedText>
                  </View>
                </View>

                <Button
                  label="Paguei"
                  icon="checkmark"
                  size="sm"
                  variant="secondary"
                  onPress={() => pay(b.ref_id, b.title)}
                  style={styles.payBtn}
                />
              </View>
            ))}
          </View>
        </View>

        {/* 5. Section: Lembretes de Hoje */}
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleWrap}>
              <View style={[styles.statusDot, { backgroundColor: theme.text }]} />
              <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionTitle}>
                LEMBRETES DE HOJE
              </ThemedText>
            </View>
            <ThemedText type="caption" themeColor="textSecondary">
              {`${(reminders.data ?? []).length > 0 ? (reminders.data ?? []).length : 2} agendados`}
            </ThemedText>
          </View>

          <View
            style={[
              styles.groupCard,
              { backgroundColor: theme.surface, borderColor: theme.separator },
            ]}>
            <View style={styles.taskRow}>
              <View style={styles.taskLeft}>
                <View style={[styles.checkCircle, { borderColor: theme.separator }]} />
                <View style={styles.taskInfo}>
                  <ThemedText type="headline" numberOfLines={1}>
                    Ligar para o contador sobre IRPF
                  </ThemedText>
                  <View style={styles.taskMeta}>
                    <ThemedText type="caption" themeColor="textSecondary">
                      15:00
                    </ThemedText>
                    <View style={[styles.metaDot, { backgroundColor: theme.separator }]} />
                    <View style={styles.whatsappTag}>
                      <Icon name="bubble.left" size="xs" color="success" />
                      <ThemedText type="caption" themeColor="success" style={styles.whatsappText}>
                        via WhatsApp
                      </ThemedText>
                    </View>
                  </View>
                </View>
              </View>
              <Icon name="bell" size="sm" color="textSecondary" />
            </View>

            <View style={[styles.itemDivider, { backgroundColor: theme.separator }]} />

            <View style={styles.taskRow}>
              <View style={styles.taskLeft}>
                <View style={[styles.checkCircle, { borderColor: theme.separator }]} />
                <View style={styles.taskInfo}>
                  <ThemedText type="headline" numberOfLines={1}>
                    Comprar filtro de água
                  </ThemedText>
                  <View style={styles.taskMeta}>
                    <ThemedText type="caption" themeColor="textSecondary">
                      18:30
                    </ThemedText>
                    <View style={[styles.metaDot, { backgroundColor: theme.separator }]} />
                    <ThemedText type="caption" themeColor="textSecondary">
                      Casa & Utilidades
                    </ThemedText>
                  </View>
                </View>
              </View>
              <Icon name="clock" size="sm" color="textSecondary" />
            </View>
          </View>
        </View>

        {/* 6. Section: Passando do Orçamento */}
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleWrap}>
              <View style={[styles.statusDot, { backgroundColor: theme.warning }]} />
              <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionTitle}>
                PASSANDO DO ORÇAMENTO
              </ThemedText>
            </View>
            <ThemedText type="caption" themeColor="warning">
              88% atingido
            </ThemedText>
          </View>

          <View
            style={[
              styles.budgetCard,
              { backgroundColor: theme.surface, borderColor: theme.separator },
            ]}>
            <View style={styles.budgetTop}>
              <View style={styles.budgetTitleWrap}>
                <View style={[styles.budgetIconCircle, { backgroundColor: theme.surfaceRaised }]}>
                  <Icon name="fork.knife" size="sm" color="tint" />
                </View>
                <View style={styles.budgetInfo}>
                  <ThemedText type="headline">Alimentação & Mercado</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    Teto Mensal: R$ 2.000,00
                  </ThemedText>
                </View>
              </View>
              <ThemedText type="headline">
                R$ 1.760{' '}
                <ThemedText type="caption" themeColor="textSecondary">
                  / R$ 2.000
                </ThemedText>
              </ThemedText>
            </View>

            <ProgressBar value={1760} max={2000} tone="warning" />

            <View style={styles.budgetBottom}>
              <View style={styles.warningTag}>
                <Icon name="exclamationmark.triangle" size="xs" color="warning" />
                <ThemedText type="caption" themeColor="warning">
                  R$ 240 restantes
                </ThemedText>
              </View>
              <ThemedText type="caption" themeColor="textSecondary">
                12 dias úteis
              </ThemedText>
            </View>
          </View>
        </View>

        {/* 7. Section: Capturado Recentemente no WhatsApp */}
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleWrap}>
              <View style={[styles.statusDot, { backgroundColor: theme.success }]} />
              <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionTitle}>
                CAPTURADO RECENTEMENTE NO WHATSAPP
              </ThemedText>
            </View>
            <View style={styles.syncStatusWrap}>
              <Icon name="arrow.clockwise" size="xs" color="success" />
              <ThemedText type="caption" themeColor="success" style={tabular}>
                12:44
              </ThemedText>
            </View>
          </View>

          <View
            style={[
              styles.captureCard,
              { backgroundColor: theme.surface, borderColor: theme.separator },
            ]}>
            <View style={styles.captureTop}>
              <View style={styles.captureLeft}>
                <View style={[styles.micCircle, { backgroundColor: theme.accentSoft }]}>
                  <Icon name="mic" size="sm" color="success" />
                </View>
                <View style={styles.captureInfo}>
                  <ThemedText type="headline" numberOfLines={1} style={styles.captureQuote}>
                    {recentWhatsApp?.description
                      ? `"${recentWhatsApp.description}"`
                      : '"Gastei 45 no almoço do R..."'}
                  </ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    Transcrição por IA ProOps
                  </ThemedText>
                </View>
              </View>
              <View style={[styles.amountBadge, { backgroundColor: theme.surfaceRaised }]}>
                <ThemedText
                  type="caption"
                  themeColor="textSecondary"
                  style={styles.amountBadgeText}>
                  {recentWhatsApp
                    ? `- ${formatBRL(Number(recentWhatsApp.amount_cents))}`
                    : '- R$ 45,00'}
                </ThemedText>
              </View>
            </View>

            <View style={[styles.itemDivider, { backgroundColor: theme.separator }]} />

            <View style={styles.captureBottom}>
              <View style={styles.processedRow}>
                <Icon name="checkmark.circle" size="xs" color="success" />
                <ThemedText type="caption" themeColor="textSecondary">
                  Processado como{' '}
                  <ThemedText type="caption" themeColor="text">
                    {recentWhatsApp?.category ?? 'Despesa Alimentação'}
                  </ThemedText>
                </ThemedText>
              </View>
              <Pressable
                onPress={() =>
                  router.push(
                    recentWhatsApp ? `/finance/${recentWhatsApp.id}` : '/finance/transactions'
                  )
                }>
                <ThemedText type="caption" themeColor="tint" style={styles.editText}>
                  Editar
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
    paddingBottom: Space.md,
  },
  topHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  brandIconBox: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    letterSpacing: -0.5,
  },
  pulsingDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.pill,
  },
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontWeight: '600',
  },
  scrollContent: {
    paddingTop: Space.xs,
    gap: Space.lg,
  },
  heroCard: {
    marginHorizontal: Space.lg,
    borderRadius: Radius.xl,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    padding: Space.lg,
    gap: Space.md,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroLabel: {
    fontWeight: '600',
    letterSpacing: 1.2,
  },
  eyeButton: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceRow: {
    marginTop: Space.xs,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  trendText: {
    fontWeight: '600',
  },
  graphLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Space.sm,
  },
  graphTarget: {
    fontWeight: '600',
  },
  chartWrap: {
    marginTop: Space.xs,
    overflow: 'hidden',
  },
  triadGrid: {
    flexDirection: 'row',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
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
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  urgentSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  payBtn: {
    paddingHorizontal: Space.md,
  },
  groupCard: {
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Space.lg,
  },
  taskLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    flex: 1,
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
  },
  taskInfo: {
    flex: 1,
    gap: Space.half,
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: Radius.pill,
  },
  whatsappTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.half,
  },
  whatsappText: {
    fontWeight: '600',
  },
  itemDivider: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
  budgetCard: {
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    padding: Space.lg,
    gap: Space.md,
  },
  budgetTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  budgetTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  budgetIconCircle: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  budgetInfo: {
    gap: Space.half,
  },
  budgetBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  warningTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  syncStatusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  captureCard: {
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    padding: Space.lg,
    gap: Space.md,
  },
  captureTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  captureLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    flex: 1,
  },
  micCircle: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureInfo: {
    flex: 1,
    gap: Space.half,
  },
  captureQuote: {
    fontStyle: 'italic',
  },
  amountBadge: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.half,
    borderRadius: Radius.pill,
  },
  amountBadgeText: {
    fontWeight: '600',
  },
  captureBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  processedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  editText: {
    fontWeight: '600',
  },
});
