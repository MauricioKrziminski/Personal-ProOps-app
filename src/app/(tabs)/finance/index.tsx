import { Link, Stack, router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SymbolViewProps } from 'expo-symbols';

import { ErrorCard } from '@/components/error-card';
import { MonthPicker, currentMonth, monthLabel, monthTitle, shiftMonth } from '@/components/finance/month-picker';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { androidOverflow } from '@/components/ui/overflow-menu';
import { HeroLabel, SectionHead } from '@/components/ui/section-head';
import { Screen } from '@/components/ui/screen';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar, Sparkline } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Elevation, Motion, Radius, Space, tabular } from '@/design/tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  useBudgetsStatus,
  useCardSummary,
  useCashFlowForecast,
  useDeleteTransaction,
  useRecentTransactions,
  useTransactionsSummary,
  type Transaction,
} from '@/hooks/use-finance';
import { formatBRL, formatDateBR } from '@/hooks/use-items';
import { monthBounds } from '@/lib/dates';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';
import { useTheme } from '@/hooks/use-theme';

/**
 * Financeiro — responde "como está o meu mês?" e, no fundo, "posso gastar?".
 *
 * O topo é **projeção**, não saldo bruto: saldo bruto mente para quem tem fatura fechando.
 * Os 13 links com emoji que terminavam a tela viraram uma seção "Gerenciar" discreta no fim.
 * Cada bloco tem query, loading e erro próprios — antes um `hasError` cobria cinco queries e
 * esquecia a de contas a pagar.
 */

const SOURCE_LABEL: Record<Transaction['source'], string> = {
  whatsapp: 'via WhatsApp',
  app: 'lançado no app',
  import: 'importado',
  recurring: 'recorrente',
};

const KIND_ICON: Record<Transaction['kind'], SymbolViewProps['name']> = {
  expense: 'arrow.up.right',
  income: 'arrow.down.left',
  transfer: 'arrow.left.arrow.right',
};

/** O menu do fim da tela. Uma seção, ícone SF, sem emoji. */
const MANAGE: { title: string; icon: SymbolViewProps['name']; href: Href }[] = [
  { title: 'Todos os lançamentos', icon: 'list.bullet', href: '/finance/transactions' },
  { title: 'Contas e carteiras', icon: 'wallet.pass', href: '/finance/accounts' },
  { title: 'Cartões e faturas', icon: 'creditcard', href: '/finance/cards' },
  { title: 'Faturas anteriores', icon: 'calendar', href: '/finance/invoices' },
  { title: 'Compras parceladas', icon: 'creditcard.and.123', href: '/finance/installments' },
  { title: 'Orçamentos', icon: 'chart.pie', href: '/finance/budgets' },
  { title: 'Metas', icon: 'target', href: '/finance/goals' },
  { title: 'Dívidas', icon: 'dollarsign.circle', href: '/finance/debts' },
  { title: 'Recorrentes', icon: 'arrow.triangle.2.circlepath', href: '/finance/recurring' },
  { title: 'Patrimônio', icon: 'building.columns', href: '/finance/net-worth' },
  { title: 'Relatórios e IR', icon: 'chart.bar', href: '/finance/reports' },
  { title: 'Plano e família', icon: 'person.2', href: '/finance/plan' },
];

/** Dias entre hoje e o último dia do mês corrente (mínimo 1). */
function daysToMonthEnd(): number {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return Math.max(1, Math.ceil((last.getTime() - now.getTime()) / 86_400_000));
}

/** `2026-08-23` → `sáb, 23 de agosto`. */
function dayTitle(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'long',
  });
}

/** Agrupa preservando a ordem (os dados já vêm ordenados do banco). */
/**
 * Agrupa por dia com `Map`, não comparando com o último elemento.
 *
 * A versão anterior só juntava linhas **consecutivas** do mesmo dia — ou seja, assumia a lista
 * ordenada por `occurred_at`. Bastavam dois lançamentos do mesmo dia não adjacentes para nascerem
 * dois grupos com a MESMA chave, e o React reclamava de chave duplicada (visto rodando).
 * Agrupamento não pode depender da ordenação de quem chama.
 */
function groupByDay(rows: Transaction[]): [string, Transaction[]][] {
  const groups = new Map<string, Transaction[]>();
  for (const tx of rows) {
    const day = groups.get(tx.occurred_at);
    if (day) day.push(tx);
    else groups.set(tx.occurred_at, [tx]);
  }
  return [...groups.entries()];
}

export default function FinanceScreen() {
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const toast = useToast();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState(currentMonth);

  const range = useMemo(() => monthBounds(month), [month]);
  const previousMonth = useMemo(() => shiftMonth(month, -1), [month]);
  const previousRange = useMemo(() => monthBounds(previousMonth), [previousMonth]);
  const isCurrent = month === currentMonth();
  const daysLeft = useMemo(() => daysToMonthEnd(), []);

  const forecast = useCashFlowForecast(daysLeft);
  const summary = useTransactionsSummary(range.from, range.to);
  const previous = useTransactionsSummary(previousRange.from, previousRange.to);
  const budgets = useBudgetsStatus(month);
  const cards = useCardSummary();
  const recent = useRecentTransactions(5);
  const remove = useDeleteTransaction();

  const totalOf = (rows: typeof summary.data, kind: 'expense' | 'income') =>
    (rows ?? []).filter((r) => r.kind === kind).reduce((s, r) => s + Number(r.total_cents), 0);

  const income = totalOf(summary.data, 'income');
  const expense = totalOf(summary.data, 'expense');
  const upcomingOut = (forecast.data ?? []).reduce((s, d) => s + Number(d.out_cents), 0);
  const projected = forecast.data?.at(-1)?.balance_cents ?? 0;
  const leftover = isCurrent ? Number(projected) : income - expense;
  const series = (forecast.data ?? []).map((d) => Number(d.balance_cents));

  const categories = useMemo(() => {
    const rows = (summary.data ?? []).filter((r) => r.kind === 'expense');
    return [...rows].sort((a, b) => Number(b.total_cents) - Number(a.total_cents));
  }, [summary.data]);
  const maxCategory = Math.max(...categories.map((r) => Number(r.total_cents)), 1);
  const previousByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of previous.data ?? []) {
      if (r.kind === 'expense') map.set(r.category, Number(r.total_cents));
    }
    return map;
  }, [previous.data]);

  const tight = (budgets.data ?? []).filter(
    (b) => Number(b.limit_cents) > 0 && Number(b.spent_cents) / Number(b.limit_cents) >= 0.8
  );
  const recentGroups = useMemo(() => groupByDay(recent.data ?? []), [recent.data]);

  const heroLoading = summary.isLoading || (isCurrent && forecast.isLoading);
  const heroError = summary.isError || (isCurrent && forecast.isError);
  const isEmpty =
    !summary.isLoading &&
    !recent.isLoading &&
    (summary.data ?? []).length === 0 &&
    (recent.data ?? []).length === 0;

  /** Destrutivo = action sheet nativo (`confirmDestructive`), nunca `Alert` de long press. */
  const confirmDelete = (tx: Transaction) => {
    const what = `${formatBRL(tx.amount_cents)}${tx.category ? ` em ${tx.category}` : ''}`;
    confirmDestructive(
      'Apagar este lançamento?',
      'Apagar',
      () =>
        remove.mutate(tx.id, {
          onSuccess: () => toast({ message: `Apaguei ${what}.`, tone: 'success' }),
          onError: () => toast({ message: 'Não deu para apagar. Tenta de novo.', tone: 'error' }),
        }),
      `${what}. Isso não volta.`
    );
  };

  const openTransactions = (params: Record<string, string>) =>
    router.push({ pathname: '/finance/transactions', params: { month, ...params } });

  return (
    <View style={styles.root}>
      <Screen
        grouped
        onRefresh={() => {
          forecast.refetch();
          summary.refetch();
          previous.refetch();
          budgets.refetch();
          cards.refetch();
          recent.refetch();
        }}
        refreshing={summary.isRefetching}>
        <Stack.Screen
          options={{
            title: 'Financeiro',
            headerLargeTitle: true,
            // O toolbar nativo não desenha no Android; lá o "..." vem por aqui.
            headerRight: androidOverflow('Mais opções', [
              { label: 'Importar extrato', onPress: () => router.push('/import') },
              { label: 'Regras de categoria', onPress: () => router.push('/finance/rules') },
              { label: 'Atividade da IA', onPress: () => router.push('/ai-activity') },
            ]),
          }}
        />
{Platform.OS === 'ios' ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="Mais opções">
            <Stack.Toolbar.MenuAction
              icon="square.and.arrow.down"
              onPress={() => router.push('/import')}>
              Importar extrato
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon="line.3.horizontal.decrease"
              onPress={() => router.push('/finance/rules')}>
              Regras de categoria
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon="sparkles"
              onPress={() => router.push('/ai-activity')}>
              Atividade da IA
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
        ) : null}

        <MonthPicker month={month} onChange={setMonth} />

        {/* Bloco 1 — o único GlassCard da tela. Projeção, não saldo bruto. */}
        {heroError ? (
          <ErrorCard
            onRetry={() => {
              summary.refetch();
              forecast.refetch();
            }}
          />
        ) : heroLoading ? (
          <View style={styles.heroSkeleton}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="70%" height={46} />
            <Skeleton height={56} radius={Radius.sm} />
          </View>
        ) : (
          <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${isCurrent ? 'Sobra até o fim do mês' : `Sobrou em ${monthTitle(month)}`}, ${formatBRL(leftover)}. Abrir projeção.`}
              onPress={() => router.push('/finance/forecast')}>
              <GlassCard style={styles.hero}>
                <HeroLabel>
                  {isCurrent ? 'Sobra até o fim do mês' : `Sobrou em ${monthTitle(month)}`}
                </HeroLabel>
                <Money cents={leftover} variant="money" tone={leftover < 0 ? 'danger' : 'text'} />
                {isCurrent && series.length > 1 ? (
                  <Sparkline values={series} width={width - Space.lg * 4} showZero />
                ) : null}
                <View style={styles.heroFacts}>
                  <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                    entrou {formatBRL(income)}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                    saiu {formatBRL(expense)}
                  </ThemedText>
                  {isCurrent ? (
                    <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                      previsto {formatBRL(upcomingOut)}
                    </ThemedText>
                  ) : null}
                </View>
              </GlassCard>
            </Pressable>
          </Animated.View>
        )}

        {/* Bloco 2 — o simulador estava enterrado dentro da projeção. */}
        <Section>
          <Row
            title="Posso comprar isso?"
            subtitle="Simula o parcelado em cima da projeção"
            icon="cart"
            onPress={() => router.push('/finance/forecast')}
          />
        </Section>

        {/* Bloco 3 — categoria sem comparação é número; com comparação é informação. */}
        {summary.isError ? null : categories.length > 0 ? (
          <View style={styles.block}>
            <SectionHead
              title="Onde o dinheiro foi"
              action={
                <Pressable
                  accessibilityRole="button"
                  hitSlop={12}
                  onPress={() => openTransactions({ kind: 'expense' })}>
                  <ThemedText type="small" themeColor="tint">
                    Ver tudo
                  </ThemedText>
                </Pressable>
              }
            />
            <Section>
              {categories.slice(0, 6).map((row, index) => {
                const total = Number(row.total_cents);
                const before = previousByCategory.get(row.category) ?? 0;
                const share = expense > 0 ? Math.round((total / expense) * 100) : 0;
                // Sem o mês anterior carregado a comparação não existe — inventar "novo" seria mentira.
                const delta =
                  previous.isSuccess && before > 0
                    ? Math.round(((total - before) / before) * 100)
                    : null;
                const comparison = !previous.isSuccess
                  ? null
                  : delta === null
                    ? `não teve em ${monthLabel(previousMonth)}`
                    : delta === 0
                      ? `igual a ${monthLabel(previousMonth)}`
                      : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}% vs ${monthLabel(previousMonth)}`;

                return (
                  <Animated.View
                    key={row.category}
                    entering={FadeInDown.duration(Motion.duration.base).delay(
                      Math.min(index * Motion.stagger.step, Motion.stagger.cap)
                    )}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${row.category}, ${formatBRL(total)}, ${share}% dos gastos do mês${comparison ? `, ${comparison}` : ''}`}
                      onPress={() => openTransactions({ category: row.category })}>
                      {({ pressed }) => (
                        <View
                          style={[
                            styles.category,
                            { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
                          ]}>
                          <View style={styles.categoryHead}>
                            <ThemedText type="default" numberOfLines={1} style={styles.categoryName}>
                              {row.category}
                            </ThemedText>
                            <Money cents={total} variant="headline" />
                          </View>
                          <ProgressBar value={total} max={maxCategory} />
                          <ThemedText
                            type="small"
                            themeColor={
                              delta !== null && delta >= 10
                                ? 'warning'
                                : delta !== null && delta <= -10
                                  ? 'success'
                                  : 'textSecondary'
                            }
                            style={tabular}>
                            {share}% do mês{comparison ? ` · ${comparison}` : ''}
                          </ThemedText>
                        </View>
                      )}
                    </Pressable>
                  </Animated.View>
                );
              })}
            </Section>
          </View>
        ) : null}

        {/* Bloco 4 — só o que já dói. Orçamento em 30% não é notícia. */}
        {budgets.isError ? (
          <ErrorCard onRetry={budgets.refetch} />
        ) : tight.length > 0 ? (
          <Section title="Passando do limite">
            {tight.map((b) => {
              const pct = Number(b.spent_cents) / Number(b.limit_cents);
              return (
                <Pressable
                  key={b.category}
                  accessibilityRole="button"
                  accessibilityLabel={`${b.category}, ${Math.round(pct * 100)}% de ${formatBRL(Number(b.limit_cents))} usados`}
                  onPress={() => router.push('/finance/budgets')}>
                  <View style={styles.budget}>
                    <View style={styles.categoryHead}>
                      <ThemedText type="default">{b.category}</ThemedText>
                      <ThemedText
                        type="small"
                        themeColor={pct >= 1 ? 'danger' : 'warning'}
                        style={tabular}>
                        {Math.round(pct * 100)}% de {formatBRL(Number(b.limit_cents))}
                      </ThemedText>
                    </View>
                    <ProgressBar
                      value={Number(b.spent_cents)}
                      max={Number(b.limit_cents)}
                      tone={pct >= 1 ? 'danger' : 'warning'}
                    />
                  </View>
                </Pressable>
              );
            })}
          </Section>
        ) : null}

        {/* Bloco 5 — cartões. */}
        {cards.isError ? (
          <ErrorCard onRetry={cards.refetch} />
        ) : (cards.data ?? []).length > 0 ? (
          <Section title="Cartões">
            {(cards.data ?? []).map((card) => (
              <Row
                key={card.account_id}
                title={card.name}
                subtitle={[
                  card.due_date ? `vence ${formatDateBR(card.due_date)}` : 'sem fatura aberta',
                  card.available_limit_cents != null
                    ? `livre ${formatBRL(Number(card.available_limit_cents))}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                icon="creditcard"
                accessibilityLabel={`${card.name}, fatura de ${formatBRL(Number(card.invoice_total_cents))}`}
                trailing={<Money cents={Number(card.invoice_total_cents)} variant="headline" />}
                onPress={() =>
                  card.invoice_id
                    ? router.push({
                        pathname: '/finance/invoice/[id]',
                        params: { id: card.invoice_id },
                      })
                    : router.push('/finance/cards')
                }
              />
            ))}
          </Section>
        ) : null}

        {/* Bloco 6 — confirmação do que a IA registrou, agrupada por dia. */}
        {recent.isError ? (
          <ErrorCard onRetry={recent.refetch} />
        ) : recent.isLoading ? (
          <Section>
            <SkeletonRow />
            <SkeletonRow />
          </Section>
        ) : recentGroups.length > 0 ? (
          <View style={styles.block}>
            <View style={styles.blockHead}>
              <ThemedText type="smallBold">Últimos lançamentos</ThemedText>
              <Pressable accessibilityRole="button" hitSlop={12} onPress={() => openTransactions({})}>
                <ThemedText type="small" themeColor="tint">
                  Ver todos
                </ThemedText>
              </Pressable>
            </View>
            {recentGroups.map(([day, rows]) => (
              <Section key={day} title={dayTitle(day)}>
                {rows.map((tx) => (
                  <Link
                    key={tx.id}
                    asChild
                    href={{
                      pathname: '/finance/[txId]',
                      params: { txId: tx.id, month: tx.occurred_at.slice(0, 7) },
                    }}>
                    <Link.Trigger>
                      <Row
                        title={tx.description || tx.merchant || tx.category || 'Sem descrição'}
                        subtitle={[tx.category, SOURCE_LABEL[tx.source]].filter(Boolean).join(' · ')}
                        icon={KIND_ICON[tx.kind]}
                        accessibilityLabel={`${tx.description || tx.category || 'lançamento'}, ${formatBRL(tx.amount_cents)}, ${tx.kind === 'income' ? 'receita' : tx.kind === 'expense' ? 'despesa' : 'transferência'}`}
                        // `Link.Menu` é iOS-only; sem isto o Android ficaria sem ação nenhuma na linha.
                        onLongPress={
                          Platform.OS === 'ios'
                            ? undefined
                            : () =>
                                showItemActions(
                                  tx.description || tx.merchant || tx.category || 'Lançamento',
                                  [
                                    {
                                      label: 'Ver detalhe',
                                      onPress: () =>
                                        router.push({
                                          pathname: '/finance/[txId]',
                                          params: { txId: tx.id, month: tx.occurred_at.slice(0, 7) },
                                        }),
                                    },
                                    {
                                      label: 'Editar',
                                      onPress: () =>
                                        router.push({
                                          pathname: '/finance/transaction-form',
                                          params: { id: tx.id, month },
                                        }),
                                    },
                                    {
                                      label: 'Apagar',
                                      destructive: true,
                                      onPress: () => confirmDelete(tx),
                                    },
                                  ]
                                )
                        }
                        trailing={
                          <Money
                            cents={tx.kind === 'expense' ? -tx.amount_cents : tx.amount_cents}
                            variant="headline"
                            tone={tx.kind === 'income' ? 'success' : 'text'}
                            signed={tx.kind !== 'transfer'}
                          />
                        }
                      />
                    </Link.Trigger>
                    <Link.Menu>
                      <Link.MenuAction
                        icon="doc.text.magnifyingglass"
                        onPress={() =>
                          router.push({
                            pathname: '/finance/[txId]',
                            params: { txId: tx.id, month: tx.occurred_at.slice(0, 7) },
                          })
                        }>
                        Ver detalhe
                      </Link.MenuAction>
                      <Link.MenuAction
                        icon="pencil"
                        onPress={() =>
                          router.push({
                            pathname: '/finance/transaction-form',
                            params: { id: tx.id, month },
                          })
                        }>
                        Editar
                      </Link.MenuAction>
                      <Link.MenuAction icon="trash" destructive onPress={() => confirmDelete(tx)}>
                        Apagar
                      </Link.MenuAction>
                    </Link.Menu>
                  </Link>
                ))}
              </Section>
            ))}
          </View>
        ) : null}

        {isEmpty ? (
          <EmptyState
            icon="chart.pie"
            title="Ainda não tem movimento"
            hint={'Manda “gastei 45 no mercado” no WhatsApp —\nou toca no + para lançar aqui'}
          />
        ) : null}

        {/* Fica sempre visível: sem conta cadastrada não existe dado para mostrar. */}
        <Section title="Gerenciar">
          {MANAGE.map((item) => (
            <Row
              key={item.title}
              title={item.title}
              icon={item.icon}
              onPress={() => router.push(item.href)}
            />
          ))}
        </Section>
      </Screen>

      <Button
        label="Lançar"
        icon="plus"
        onPress={() => router.push({ pathname: '/finance/transaction-form', params: { month } })}
        style={[
          styles.fab,
          { bottom: insets.bottom + Space.xxl, boxShadow: Elevation[scheme].floating },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  hero: {
    gap: Space.sm,
  },
  heroSkeleton: {
    gap: Space.md,
  },
  heroFacts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.md,
  },
  block: {
    gap: Space.md,
  },
  blockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
  },
  category: {
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  categoryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  categoryName: {
    flex: 1,
  },
  budget: {
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  fab: {
    position: 'absolute',
    right: Space.lg,
  },
});
