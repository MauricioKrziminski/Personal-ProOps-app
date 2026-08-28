import { Link, Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SymbolViewProps } from 'expo-symbols';

import { ErrorCard } from '@/components/error-card';
import { MonthPicker, currentMonth, monthTitle, shiftMonth } from '@/components/finance/month-picker';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Row } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { Elevation, Motion, Radius, Space, tabular } from '@/design/tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  useAccounts,
  useDeleteTransaction,
  useMarkPaid,
  useRecentTransactions,
  useTransactions,
  useTransactionsSummary,
  type Transaction,
  type TransactionKind,
} from '@/hooks/use-finance';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import { monthBounds } from '@/lib/dates';
import { confirmDestructive } from '@/lib/item-actions';
import { useTheme } from '@/hooks/use-theme';

/**
 * Lançamentos — "cadê aquele lançamento, e o que entrou e saiu neste mês?".
 *
 * Mudanças estruturais em relação à versão anterior: busca no header nativo, navegador de mês
 * compartilhado (`MonthPicker`), lista agrupada por dia com cabeçalho sticky, UMA `GlassCard`
 * (era uma por linha, vinte glass na mesma tela) e totais vindos de `transactions_summary` —
 * `reduce` no cliente passa a mentir assim que a lista for paginada.
 */

const KIND_ICON: Record<TransactionKind, SymbolViewProps['name']> = {
  expense: 'arrow.up.right',
  income: 'arrow.down.left',
  transfer: 'arrow.left.arrow.right',
};

const SOURCE_LABEL: Record<Transaction['source'], string> = {
  whatsapp: 'via WhatsApp',
  app: '',
  import: 'importado',
  recurring: 'recorrente',
};

const KIND_OPTIONS: { value: TransactionKind | 'all'; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'expense', label: 'Gastos' },
  { value: 'income', label: 'Receitas' },
  { value: 'transfer', label: 'Transf.' },
];

const STATUS_OPTIONS: { value: 'all' | 'pending'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Previstos' },
];

interface DaySection {
  title: string;
  /** Receitas − despesas do dia (transferência não conta). */
  net: number;
  data: Transaction[];
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

function toSections(rows: Transaction[]): DaySection[] {
  const sections: DaySection[] = [];
  let currentDay = '';
  for (const tx of rows) {
    if (tx.occurred_at !== currentDay) {
      currentDay = tx.occurred_at;
      sections.push({ title: dayTitle(tx.occurred_at), net: 0, data: [] });
    }
    const section = sections[sections.length - 1];
    section.data.push(tx);
    if (tx.kind === 'income') section.net += tx.amount_cents;
    if (tx.kind === 'expense') section.net -= tx.amount_cents;
  }
  return sections;
}

export default function TransactionsScreen() {
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ month?: string; kind?: string; category?: string; recurringId?: string }>();

  const [month, setMonth] = useState(() => params.month ?? currentMonth());
  const [kind, setKind] = useState<TransactionKind | 'all'>(
    params.kind === 'expense' || params.kind === 'income' || params.kind === 'transfer'
      ? params.kind
      : 'all'
  );
  const [status, setStatus] = useState<'all' | 'pending'>('all');
  const [category, setCategory] = useState<string | undefined>(params.category);
  const [search, setSearch] = useState('');

  const range = useMemo(() => monthBounds(month), [month]);
  const list = useTransactions({
    month,
    kind: kind === 'all' ? undefined : kind,
    category,
    recurringId: params.recurringId,
  });
  const summary = useTransactionsSummary(range.from, range.to);
  const accounts = useAccounts();
  // Um item basta para separar "nunca teve nada" de "este mês não teve nada".
  const anyEver = useRecentTransactions(1);
  const markPaid = useMarkPaid();
  const remove = useDeleteTransaction();

  const accountName = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts.data ?? []) map.set(a.id, a.name);
    return map;
  }, [accounts.data]);

  const income = (summary.data ?? [])
    .filter((r) => r.kind === 'income')
    .reduce((s, r) => s + Number(r.total_cents), 0);
  const expense = (summary.data ?? [])
    .filter((r) => r.kind === 'expense')
    .reduce((s, r) => s + Number(r.total_cents), 0);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (list.data ?? []).filter((tx) => {
      if (status === 'pending' && tx.status !== 'pending') return false;
      if (!term) return true;
      return [tx.description, tx.merchant, tx.category].some((field) =>
        (field ?? '').toLowerCase().includes(term)
      );
    });
  }, [list.data, status, search]);

  const sections = useMemo(() => toSections(filtered), [filtered]);
  const hasFilters = kind !== 'all' || status !== 'all' || Boolean(category) || search.trim() !== '';
  const neverHadAnything = (anyEver.data ?? []).length === 0 && !anyEver.isLoading;

  const clearFilters = () => {
    setKind('all');
    setStatus('all');
    setCategory(undefined);
    setSearch('');
  };

  const pay = (tx: Transaction) =>
    markPaid.mutate(
      { id: tx.id, paidAt: localISODate() },
      {
        onSuccess: () => toast({ message: 'Dei baixa no lançamento.', tone: 'success' }),
        onError: () => toast({ message: 'Não deu para dar baixa. Tenta de novo.', tone: 'error' }),
      }
    );

  /** Destrutivo = action sheet nativo. `onLongPress` + `Alert` é proibido nesta tela. */
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

  const header = (
    <View style={styles.header}>
      <MonthPicker month={month} onChange={setMonth} />

      {summary.isError ? (
        <ErrorCard onRetry={summary.refetch} />
      ) : summary.isLoading ? (
        <View style={styles.summarySkeleton}>
          <Skeleton width="40%" height={14} />
          <Skeleton width="65%" height={40} />
        </View>
      ) : (
        <GlassCard style={styles.summary}>
          <ThemedText type="small" themeColor="textSecondary">
            Sobra de {monthTitle(month)}
          </ThemedText>
          <Money cents={income - expense} variant="money" tone={income - expense < 0 ? 'danger' : 'text'} />
          <View style={styles.summaryFacts}>
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              entrou {formatBRL(income)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              saiu {formatBRL(expense)}
            </ThemedText>
          </View>
        </GlassCard>
      )}

      <View style={styles.filters}>
        <Segmented options={KIND_OPTIONS} value={kind} onChange={setKind} />
        <Segmented options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        {category ? (
          <Button
            label={`categoria: ${category}`}
            icon="xmark"
            size="sm"
            variant="secondary"
            onPress={() => setCategory(undefined)}
          />
        ) : null}
      </View>
    </View>
  );

  const empty = list.isLoading ? (
    <View>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </View>
  ) : list.isError ? (
    <ErrorCard onRetry={list.refetch} />
  ) : hasFilters ? (
    <EmptyState
      icon="line.3.horizontal.decrease"
      title={
        search.trim()
          ? `Nenhum lançamento com “${search.trim()}” em ${monthTitle(month)}`
          : `Nenhum lançamento com esse filtro em ${monthTitle(month)}`
      }
      action={{ label: 'Limpar filtros', onPress: clearFilters }}
    />
  ) : neverHadAnything ? (
    <EmptyState
      icon="tray"
      title="Nenhum lançamento ainda"
      hint={'Manda “gastei 45 no mercado” no WhatsApp —\nou toca no + para lançar aqui'}
    />
  ) : (
    <EmptyState
      icon="calendar"
      title={`Nada em ${monthTitle(month)}`}
      action={{
        label: `Ver ${monthTitle(shiftMonth(month, -1))}`,
        onPress: () => setMonth(shiftMonth(month, -1)),
      }}
    />
  );

  return (
    <View style={styles.root}>
      <Screen scroll={false} grouped>
        <Stack.Screen options={{ title: 'Lançamentos', headerLargeTitle: true }} />
        <Stack.SearchBar
          placeholder="Buscar por descrição, lugar ou categoria"
          hideWhenScrolling={false}
          onChangeText={(event) => setSearch(event.nativeEvent.text)}
          onClose={() => setSearch('')}
        />
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
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>

        <SectionList<Transaction, DaySection>
          sections={sections}
          keyExtractor={(tx) => tx.id}
          style={styles.listHost}
          contentInsetAdjustmentBehavior="automatic"
          stickySectionHeadersEnabled
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Space.xxxl * 2 }]}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          refreshing={list.isRefetching}
          onRefresh={() => {
            list.refetch();
            summary.refetch();
          }}
          renderSectionHeader={({ section }) => (
            <View style={[styles.dayHeader, { backgroundColor: theme.groupedBackground }]}>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                accessibilityRole="header"
                style={styles.dayTitle}>
                {section.title}
              </ThemedText>
              <Money cents={section.net} variant="footnote" tone="textSecondary" signed />
            </View>
          )}
          renderItem={({ item: tx, index, section }) => {
            const badges = [
              tx.status === 'pending'
                ? `previsto${tx.due_at ? ` · vence ${formatDateBR(tx.due_at)}` : ''}`
                : null,
              tx.installment_no ? `parcela ${tx.installment_no}` : null,
              tx.invoice_id ? 'fatura' : null,
            ].filter(Boolean);
            const context = [
              tx.category,
              tx.account_id ? accountName.get(tx.account_id) : null,
              SOURCE_LABEL[tx.source],
            ].filter(Boolean);

            return (
              <Animated.View
                entering={FadeInDown.duration(Motion.duration.base).delay(
                  Math.min(index * 40, Motion.stagger.cap)
                )}
                style={[
                  styles.rowHost,
                  { backgroundColor: theme.surface },
                  index === 0 && styles.groupTop,
                  index === section.data.length - 1 && styles.groupBottom,
                ]}>
                <Link
                  asChild
                  href={{ pathname: '/finance/[txId]', params: { txId: tx.id, month } }}>
                  <Link.Trigger>
                    <Row
                      title={tx.description || tx.merchant || tx.category || 'Sem descrição'}
                      subtitle={[...badges, ...context].join(' · ')}
                      icon={KIND_ICON[tx.kind]}
                      accessibilityLabel={`${tx.description || tx.merchant || tx.category || 'Lançamento'}, ${formatBRL(tx.amount_cents)}, ${tx.kind === 'income' ? 'receita' : tx.kind === 'expense' ? 'despesa' : 'transferência'}, ${dayTitle(tx.occurred_at)}${tx.status === 'pending' ? ', previsto' : ''}`}
                      trailing={
                        <View style={styles.trailing}>
                          <Money
                            cents={tx.kind === 'expense' ? -tx.amount_cents : tx.amount_cents}
                            variant="headline"
                            tone={tx.kind === 'income' ? 'success' : 'text'}
                            signed={tx.kind !== 'transfer'}
                          />
                          {tx.status === 'pending' ? (
                            <Button
                              label="Paguei"
                              size="sm"
                              variant="secondary"
                              onPress={() => pay(tx)}
                            />
                          ) : null}
                        </View>
                      }
                    />
                  </Link.Trigger>
                  <Link.Menu>
                    <Link.MenuAction
                      icon="doc.text.magnifyingglass"
                      onPress={() =>
                        router.push({
                          pathname: '/finance/[txId]',
                          params: { txId: tx.id, month },
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
              </Animated.View>
            );
          }}
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: theme.separator }]} />
          )}
        />
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
  listHost: {
    flex: 1,
  },
  list: {
    paddingHorizontal: Space.lg,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  header: {
    gap: Space.lg,
    paddingTop: Space.md,
    paddingBottom: Space.lg,
  },
  summary: {
    gap: Space.sm,
  },
  summarySkeleton: {
    gap: Space.md,
  },
  summaryFacts: {
    flexDirection: 'row',
    gap: Space.lg,
  },
  filters: {
    gap: Space.sm,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingVertical: Space.sm,
  },
  dayTitle: {
    letterSpacing: 0.2,
  },
  rowHost: {
    overflow: 'hidden',
  },
  groupTop: {
    borderTopLeftRadius: Radius.md,
    borderTopRightRadius: Radius.md,
    borderCurve: 'continuous',
  },
  groupBottom: {
    borderBottomLeftRadius: Radius.md,
    borderBottomRightRadius: Radius.md,
    borderCurve: 'continuous',
  },
  trailing: {
    alignItems: 'flex-end',
    gap: Space.xs,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Space.xxl,
  },
  fab: {
    position: 'absolute',
    right: Space.lg,
  },
});
