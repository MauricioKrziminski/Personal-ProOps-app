import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { categoryIcon } from '@/design/category-icons';
import { ErrorCard } from '@/components/error-card';
import { MonthPicker, currentMonth, monthTitle, shiftMonth } from '@/components/finance/month-picker';
import { Card } from '@/components/ui/card';
import { ThemedText } from '@/components/themed-text';
import { HeaderMenu } from '@/components/ui/header-actions';
import { ItemLink } from '@/components/ui/item-link';
import { Search } from '@/components/ui/search';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/finance/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Row } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { Elevation, Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  NO_ACCOUNT,
  useAccounts,
  useDeleteTransaction,
  useMarkPaid,
  useRecentTransactions,
  useMonthRange,
  useTransactions,
  useTransactionsSummary,
  type Transaction,
  type TransactionKind,
  type TransactionSource,
} from '@/hooks/use-finance';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import { confirmDestructive } from '@/lib/item-actions';
import { dueInline, settleLabel } from '@/lib/settle-labels';
import { useDebounced } from '@/hooks/use-debounced';
import { useTheme, useScheme } from '@/hooks/use-theme';
import { accountLabel } from '@/lib/accounts';

/**
 * Lançamentos — "cadê aquele lançamento, e o que entrou e saiu neste mês?".
 *
 * Mudanças estruturais em relação à versão anterior: busca no header nativo, navegador de mês
 * compartilhado (`MonthPicker`), lista agrupada por dia com cabeçalho sticky, UM destaque
 * (era uma por linha, vinte glass na mesma tela) e totais vindos de `transactions_summary` —
 * `reduce` no cliente passa a mentir assim que a lista for paginada.
 */


const SOURCE_LABEL: Record<Transaction['source'], string> = {
  whatsapp: 'via WhatsApp',
  app: '',
  import: 'importado',
  recurring: 'recorrente',
};

const KIND_OPTIONS = [
  { value: 'all', label: 'Tudo' },
  { value: 'expense', label: 'Gastos' },
  { value: 'income', label: 'Receitas' },
  { value: 'transfer', label: 'Transf.' },
] as const satisfies readonly { value: TransactionKind | 'all'; label: string }[];

const STATUS_OPTIONS: { value: 'all' | 'pending' | 'cleared'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Previstos' },
  { value: 'cleared', label: 'Efetivados' },
];

/** Rótulo da ORIGEM como filtro. `SOURCE_LABEL` é o subtítulo da linha e deixa `app` vazio. */
const SOURCE_FILTER: { value: TransactionSource; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'app', label: 'No app' },
  { value: 'import', label: 'Importado' },
  { value: 'recurring', label: 'Recorrente' },
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
  const scheme = useScheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    month?: string;
    kind?: string;
    category?: string;
    recurringId?: string;
    /** Id da conta/cartão, ou `none` para os lançamentos sem conta. */
    accountId?: string;
  }>();

  const [month, setMonth] = useState(() => params.month ?? currentMonth());
  const [kind, setKind] = useState<TransactionKind | 'all'>(
    params.kind === 'expense' || params.kind === 'income' || params.kind === 'transfer'
      ? params.kind
      : 'all'
  );
  const [status, setStatus] = useState<'all' | 'pending' | 'cleared'>('all');
  const [category, setCategory] = useState<string | undefined>(params.category);
  const [accountId, setAccountId] = useState<string | undefined>(params.accountId);
  const [source, setSource] = useState<TransactionSource | undefined>(undefined);
  const [search, setSearch] = useState('');
  // Busca-enquanto-digita sem uma requisição por tecla — agora ela vai ao banco.
  const term = useDebounced(search.trim(), 250);

  /**
   * Deep link para uma tela JÁ montada.
   *
   * Os filtros nascem de `useState(params.x)`, que só lê o valor na primeira renderização —
   * então `appproops:///finance/transactions?accountId=…` caía na instância aberta e o filtro
   * era ignorado em silêncio (visto no teste da Fase 2). `router.push` de dentro do app monta
   * tela nova e nunca passou por aqui; quem chega assim é notificação e link externo.
   *
   * Ajuste DURANTE a renderização, não em `useEffect`: é o padrão do próprio React para "estado
   * que precisa mudar quando a prop muda", e `setState` dentro de efeito é erro de lint aqui
   * (dispara renderização em cascata). Só aplica o que VEIO no link — parâmetro ausente não
   * desfaz escolha que o usuário fez na tela. `recurringId` fica de fora: é lido direto de
   * `params`, sem estado.
   */
  const link = `${params.month ?? ''}|${params.kind ?? ''}|${params.category ?? ''}|${params.accountId ?? ''}`;
  const [linkAplicado, setLinkAplicado] = useState(link);
  if (link !== linkAplicado) {
    setLinkAplicado(link);
    if (params.month) setMonth(params.month);
    if (params.kind === 'expense' || params.kind === 'income' || params.kind === 'transfer') {
      setKind(params.kind);
    }
    if (params.category) setCategory(params.category);
    if (params.accountId) setAccountId(params.accountId);
  }

  const range = useMonthRange(month);
  const list = useTransactions({
    month,
    kind: kind === 'all' ? undefined : kind,
    category,
    recurringId: params.recurringId,
    accountId: accountId === undefined ? undefined : accountId === NO_ACCOUNT ? null : accountId,
    status: status === 'all' ? undefined : status,
    source,
    q: term,
  });
  const summary = useTransactionsSummary(range.from, range.to);
  const accounts = useAccounts();
  // Um item basta para separar "nunca teve nada" de "este mês não teve nada".
  const anyEver = useRecentTransactions(1);
  const markPaid = useMarkPaid();
  const remove = useDeleteTransaction();

  const accountName = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts.data ?? []) map.set(a.id, accountLabel(a));
    return map;
  }, [accounts.data]);

  // Realizado, não total: `entrou`/`saiu` são verbos no passado e não podem contar previsto.
  // Mesmo defeito e mesma correção do Financeiro — ver o comentário em `(tabs)/finance/index.tsx`.
  const realizado = (kind: 'income' | 'expense') =>
    (summary.data ?? [])
      .filter((r) => r.kind === kind)
      .reduce((s, r) => s + Number(r.total_cents) - Number(r.pending_cents), 0);
  const income = realizado('income');
  const expense = realizado('expense');

  // `toSections` agrupa em varredura linear, então o dia que atravessa a fronteira de duas
  // páginas continua sendo uma seção só depois do `flat()`.
  const rows = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);
  const sections = useMemo(() => toSections(rows), [rows]);

  /** Id da conta filtrada; `undefined` na lista global e também em "Sem conta". */
  const contaFiltrada = accountId === undefined || accountId === NO_ACCOUNT ? undefined : accountId;

  /** Título da tela quando ela está filtrada por conta — não é o rótulo de uma conta. */
  const tituloDaConta =
    accountId === undefined
      ? undefined
      : accountId === NO_ACCOUNT
        ? 'Sem conta'
        : (accountName.get(accountId) ?? 'Extrato');

  const hasFilters =
    kind !== 'all' ||
    status !== 'all' ||
    Boolean(category) ||
    accountId !== undefined ||
    source !== undefined ||
    search.trim() !== '';
  const neverHadAnything = (anyEver.data ?? []).length === 0 && !anyEver.isLoading;

  // Estado vazio que oferece BOTÃO ("Ver fevereiro", "Limpar filtros") cai exatamente na faixa
  // do FAB, que é desenhado por cima e come metade do alvo — visto no simulador com
  // "Ver Fevereiro de 2025" cortado ao meio pelo "Lançar". Nesses dois estados o FAB sai: não há
  // lista para completar, e a oferta da tela é a do estado vazio. Ele fica no
  // `neverHadAnything`, cuja dica manda tocar justamente nele.
  const vazioComAcao =
    sections.length === 0 && !list.isLoading && !list.isError && !neverHadAnything;

  const clearFilters = () => {
    setKind('all');
    setStatus('all');
    setCategory(undefined);
    setAccountId(undefined);
    setSource(undefined);
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
      {/*
        A busca vive DENTRO do `ListHeaderComponent`, não ao lado da lista. Irmã do
        `SectionList` numa `Screen scroll={false}`, a pílula do Android ficava cravada no
        topo enquanto o extrato passava por baixo — a queixa de 09/09/2026, com foto. No
        iOS ela é `Stack.SearchBar`, que escreve opções por hook e devolve `null`: a
        posição na árvore não muda nada de lá.
      */}
      {/*
        Sem `gutter`: dentro do `ListHeaderComponent` quem já dá a calha lateral é o
        `contentContainerStyle` da lista (`styles.list`). Ele existia para IGUALAR o recuo da
        lista quando a busca era irmã dela — aqui ele DOBRARIA, e a pílula sairia mais estreita
        que o MonthPicker logo abaixo.
      */}
      <Search
        value={search}
        onChangeText={setSearch}
        hideWhenScrolling={false}
        placeholder="Buscar por descrição, lugar ou categoria"
        accessibilityLabel="Buscar lançamentos"
      />

      <MonthPicker month={month} onChange={setMonth} />

      {accountId !== undefined ? null : summary.isError ? (
        <ErrorCard onRetry={summary.refetch} />
      ) : summary.isLoading ? (
        <View style={styles.summarySkeleton}>
          <Skeleton width="40%" height={14} />
          <Skeleton width="65%" height={40} />
        </View>
      ) : (
        <Card style={styles.summary}>
          <HeroLabel>Sobra de {monthTitle(month)}</HeroLabel>
          <Money cents={income - expense} variant="money" tone={income - expense < 0 ? 'danger' : 'text'} />
          <View style={styles.summaryFacts}>
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              entrou {formatBRL(income)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              saiu {formatBRL(expense)}
            </ThemedText>
          </View>
        </Card>
      )}

      {/*
        **Um `Segmented` e uma fileira de chips, não dois `Segmented`.**

        Os dois filtros vinham empilhados, do mesmo tamanho e com a mesma forma — duas lajes
        idênticas em que nada dizia qual mandava em quê. É o mesmo defeito dos dois campos de
        texto que a aba Notas tinha, e a correção é a mesma: dar forma diferente a papéis
        diferentes.

        `kind` é o filtro PRIMÁRIO (é o que muda a resposta da tela: gastei ou recebi) e fica no
        segmentado, que é o controle de escolha única do sistema. `status` é um recorte
        secundário sobre o resultado, e recorte secundário é chip — a mesma gramática dos filtros
        de pasta e tag em Notas. De quebra, a fileira de chips ocupa metade da altura.
      */}
      <View style={styles.filters}>
        <Segmented options={KIND_OPTIONS} value={kind} onChange={setKind} />
        <View style={styles.statusChips}>
          {STATUS_OPTIONS.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={status === o.value}
              onPress={() => setStatus(o.value)}
            />
          ))}
        </View>
        {category ? (
          <Button
            label={`categoria: ${category}`}
            icon="xmark"
            size="sm"
            variant="secondary"
            onPress={() => setCategory(undefined)}
          />
        ) : null}
        {tituloDaConta ? (
          <Button
            label={`conta: ${tituloDaConta}`}
            icon="xmark"
            size="sm"
            variant="secondary"
            onPress={() => setAccountId(undefined)}
          />
        ) : null}
        {source ? (
          <Button
            label={`origem: ${SOURCE_FILTER.find((o) => o.value === source)?.label ?? source}`}
            icon="xmark"
            size="sm"
            variant="secondary"
            onPress={() => setSource(undefined)}
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
      <Screen
      floatingAction scroll={false} grouped>
        <Stack.Screen
          options={{ title: tituloDaConta ?? 'Lançamentos', headerLargeTitle: true }}
        />
        <HeaderMenu
          title="Mais opções"
          actions={[
            // Submenu, não uma fileira de chips: com oito contas cadastradas o corpo da tela
            // viraria filtro. É o mesmo desenho do "mudar de pasta" das notas.
            {
              label: 'Conta',
              icon: 'wallet.bifold',
              actions: [
                {
                  label: 'Todas',
                  selected: accountId === undefined,
                  onPress: () => setAccountId(undefined),
                },
                ...(accounts.data ?? []).map((a) => ({
                  label: accountLabel(a),
                  selected: accountId === a.id,
                  onPress: () => setAccountId(a.id),
                })),
                {
                  label: 'Sem conta',
                  selected: accountId === NO_ACCOUNT,
                  onPress: () => setAccountId(NO_ACCOUNT),
                },
              ],
            },
            {
              label: 'Origem',
              icon: 'arrow.triangle.branch',
              actions: [
                { label: 'Todas', selected: source === undefined, onPress: () => setSource(undefined) },
                ...SOURCE_FILTER.map((o) => ({
                  label: o.label,
                  selected: source === o.value,
                  onPress: () => setSource(o.value),
                })),
              ],
            },
            {
              label: 'Importar extrato',
              icon: 'square.and.arrow.down',
              onPress: () => router.push('/import'),
            },
            {
              label: 'Regras de categoria',
              icon: 'line.3.horizontal.decrease',
              onPress: () => router.push('/finance/rules'),
            },
          ]}
        />

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
          ListFooterComponent={list.isFetchingNextPage ? <SkeletonRow /> : null}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
          }}
          refreshing={(list.isRefetching && !list.isFetchingNextPage) || summary.isRefetching || accounts.isRefetching || anyEver.isRefetching}
          onRefresh={() => Promise.all([list.refetch(), summary.refetch(), accounts.refetch(), anyEver.refetch()])}
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
                ? dueInline(tx.kind, tx.due_at ? formatDateBR(tx.due_at) : null, {
                    onCard: tx.invoice_id !== null,
                  })
                : null,
              tx.installment_no ? `parcela ${tx.installment_no}` : null,
              // "na fatura de 10/09" já diz que é do cartão; a pílula solta viraria eco
              tx.invoice_id && tx.status !== 'pending' ? 'fatura' : null,
            ].filter(Boolean);
            // Transferência não tem sinal na lista global — ela não é entrada nem saída do
            // conjunto. No extrato de UMA conta ela tem: sai da conta de origem e ENTRA na de
            // destino. Sem isso o extrato do Nubank mostrava duas saídas de R$ 900,00 sem o "−",
            // e o extrato do cartão mostrava as mesmas duas como se também tivessem saído dele.
            const transferenciaRecebida =
              tx.kind === 'transfer' &&
              contaFiltrada !== undefined &&
              tx.counterparty_account_id === contaFiltrada;
            const assinado =
              tx.kind !== 'transfer' || (contaFiltrada !== undefined && tx.account_id !== null);
            const valor =
              tx.kind === 'expense' || (tx.kind === 'transfer' && assinado && !transferenciaRecebida)
                ? -tx.amount_cents
                : tx.amount_cents;

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
                <ItemLink
                  href={{ pathname: '/finance/[txId]', params: { txId: tx.id, month } }}
                  title={tx.description || tx.merchant || tx.category || 'Lançamento'}
                  /**
                   * ⚠️ **Dar baixa é AÇÃO DE ITEM, não botão na linha** (09/09/2026).
                   *
                   * A régua: *linha de lista mostra o registro e a ação mora no menu dela;
                   * card de painel mostra a decisão e a ação é o botão*. A Hoje é painel — três
                   * ou quatro coisas pedindo decisão — e continua com botão. Aqui é extrato:
                   * a maioria das linhas já está efetivada e não tem ação nenhuma.
                   *
                   * Um `<Button>` em `Row.trailing` empurrava o bloco além do `minWidth: 180`
                   * do título, o `flexWrap` jogava valor+botão para a linha de baixo, e só nas
                   * previstas — a linha previsto ficava com o dobro da altura da vizinha
                   * efetivada. Foi a queixa do dono do produto, duas vezes, e as tentativas de
                   * arrumar o `trailing` (coluna, depois linha) só trocaram a forma da quebra.
                   *
                   * `design.md §6` já dizia: *ação de item é context menu nativo*.
                   */
                  actions={[
                    ...(tx.status === 'pending'
                      ? [
                          {
                            label: settleLabel(tx.kind),
                            icon: 'checkmark.circle' as const,
                            onPress: () => pay(tx),
                          },
                        ]
                      : []),
                    {
                      label: 'Ver detalhe',
                      icon: 'doc.text.magnifyingglass',
                      onPress: () =>
                        router.push({ pathname: '/finance/[txId]', params: { txId: tx.id, month } }),
                    },
                    {
                      label: 'Editar',
                      icon: 'pencil',
                      onPress: () =>
                        router.push({
                          pathname: '/finance/transaction-form',
                          params: { id: tx.id, month },
                        }),
                    },
                    { label: 'Apagar', icon: 'trash', destructive: true, onPress: () => confirmDelete(tx) },
                  ]}>
                  {({ onLongPress }) => (
                    <Row
                      title={tx.description || tx.merchant || tx.category || 'Sem descrição'}
                      subtitle={[...badges, ...context].join(' · ')}
                      icon={categoryIcon(tx.category, tx.kind)}
                      accessibilityLabel={`${tx.description || tx.merchant || tx.category || 'Lançamento'}, ${formatBRL(tx.amount_cents)}, ${tx.kind === 'income' ? 'receita' : tx.kind === 'expense' ? 'despesa' : 'transferência'}, ${dayTitle(tx.occurred_at)}${tx.status === 'pending' ? ', previsto' : ''}`}
                      onLongPress={onLongPress}
                      trailing={
                        <Money
                          cents={valor}
                          variant="ticker"
                          tone={tx.kind === 'income' ? 'success' : 'text'}
                          signed={assinado}
                        />
                      }
                    />
                  )}
                </ItemLink>
              </Animated.View>
            );
          }}
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: theme.separator }]} />
          )}
        />
      </Screen>

      {vazioComAcao ? null : (
        <Button
          label="Lançar"
          icon="plus"
          onPress={() => router.push({ pathname: '/finance/transaction-form', params: { month } })}
          style={[
            styles.fab,
            { bottom: insets.bottom + Space.xxl, boxShadow: Elevation[scheme].floating },
          ]}
        />
      )}
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
  statusChips: { flexDirection: 'row', gap: Space.sm },
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
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Space.xxl,
  },
  fab: {
    position: 'absolute',
    right: Space.lg,
  },
});
