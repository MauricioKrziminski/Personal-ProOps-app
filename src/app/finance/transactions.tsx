import { Stack, router, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorCard } from '@/components/error-card';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { MonthPicker, monthTitle, shiftMonth } from '@/components/finance/month-picker';
import { useMonthRuler } from '@/components/finance/month-ruler';
import { PeriodBar } from '@/components/finance/period-bar';
import { LinhaPrevista, useAcoesDaPrevista } from '@/components/finance/expected-ledger-lines';
import { ThemedText } from '@/components/themed-text';
import { Forte } from '@/components/ui/forte';
import { HeaderActions } from '@/components/ui/header-actions';
import { ItemLink } from '@/components/ui/item-link';
import { Search } from '@/components/ui/search';
import { ListFilters } from '@/components/ui/list-filters';
import { listFilterCount, type ListFiltersValue } from '@/lib/list-filters';
import { MudancaSuave } from '@/components/motion/presenca';
import { PeriodSummaryCard } from '@/components/finance/period-summary-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Card } from '@/components/ui/card';
import { Dica } from '@/components/ui/dica';
import { useBRL, useConceal } from '@/components/ui/conceal';
import { Money } from '@/components/ui/money';
import { Row } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { fecharDeslizavelAberto } from '@/components/ui/deslizavel';
import { Skeleton, SkeletonChart, SkeletonList, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { Radius, Space } from '@/design/tokens';
import {
  NO_ACCOUNT,
  useAccountBalances,
  useAccounts,
  useCategoriesUsed,
  useDeleteTransaction,
  useRecentTransactions,
  useRecurringTransactions,
  useMonthRange,
  useTransactions,
  useCycleSeries,
  useCycleMonth,
  useExpectedLedgerLines,
  useTransactionsSummary,
  type Transaction,
  type TransactionKind,
  type TransactionSource,
  useAparencia,
} from '@/hooks/use-finance';
import { useSubcategoryFilterOptions } from '@/hooks/use-category-details';
import { NO_CATEGORY } from '@/lib/spending-change';
import { parseSubcategoryFilter } from '@/lib/category-detail-breakdown';
import { subcategoryAfterParentChange } from '@/lib/subcategories';
import { usarDica } from '@/hooks/use-dicas';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import { isoToBR, mesmoMes } from '@/lib/dates';
import { financeErrorMessage } from '@/lib/finance-form';
import { confirmDestructive } from '@/lib/item-actions';
import { useApagarComAlcance } from '@/hooks/use-apagar-com-alcance';
import { alvoDoLancamento } from '@/lib/apagar-com-alcance';
import { rotuloDaCompra } from '@/lib/data-da-compra';
import { parcelaDoContratoPaga, previstoDaLinha } from '@/lib/previsto';
import { dueInline, estadoDaLinha, settleLabel } from '@/lib/settle-labels';
import { filterExpectedLines, mesclarPrevistas, previstasNaTela, type ItemDoExtrato } from '@/lib/ledger-expected';
import { useConfirmarBaixa } from '@/components/finance/confirmar-baixa';
import { useDebounced } from '@/hooks/use-debounced';
import { useTheme } from '@/hooks/use-theme';
import { accountLabel, accountSelectOptions, saldoDaConta } from '@/lib/accounts';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { tabletPaneWidths } from '@/design/adaptive-window';
import { hrefDoLancamento, hrefDoLancar } from '@/lib/lancar';
import { paramsDaCopia, podeDuplicar } from '@/lib/duplicar';
import { normalizePaymentMethodFilters, parsePaymentMethodFilters, PAYMENT_METHOD_FILTER_OPTIONS, type PaymentMethodFilter } from '@/lib/payment-method-filters';
import {
  normalizeExpensePatternFilters, normalizeExpenseNecessityFilters,
  parseExpensePatternFilters, parseExpenseNecessityFilters,
  EXPENSE_PATTERN_FILTER_OPTIONS, EXPENSE_NECESSITY_FILTER_OPTIONS,
  type ExpensePatternFilter, type ExpenseNecessityFilter,
} from '@/lib/expense-classification-filters';

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
  { value: 'transfer', label: 'Transferências' },
] as const satisfies readonly { value: TransactionKind | 'all'; label: string }[];

/**
 * ⚠️ **O filtro é da DATA, a mesma régua da pílula** (`filtroDoEstado`, 24/09/2026). Era do
 * `status`, e compra de cartão fica `pending` até a fatura ser paga: a compra de ontem nunca
 * aparecia em "Concluído" (o wardogs). "Concluído" = já aconteceu; "Em aberto" = previsto,
 * atrasado ou receita que não caiu.
 */
const STATUS_OPTIONS: { value: 'all' | 'pending' | 'cleared'; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'pending', label: 'Em aberto' },
  { value: 'cleared', label: 'Concluído' },
];

/** Rótulo da ORIGEM como filtro. `SOURCE_LABEL` é o subtítulo da linha e deixa `app` vazio. */
const SOURCE_FILTER: { value: TransactionSource; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'app', label: 'No app' },
  { value: 'import', label: 'Importado' },
  { value: 'recurring', label: 'Recorrente' },
];

/** O lançamento gravado ou a ocorrência que só existe na regra, no dia dela. */
type Item = ItemDoExtrato<Transaction>;

interface DaySection {
  title: string;
  /** Só nas ocorrências de uma série: o rótulo que abre o grupo ("A seguir", "Anteriores"). */
  grupo?: string;
  /** Receitas − despesas do dia (transferência não conta). */
  net: number;
  data: Item[];
}

const dataDoItem = (item: Item) => item.tx?.occurred_at ?? item.prevista!.due_date;

/**
 * A ocorrência de uma recorrente tem a MESMA chave prevista e gravada (série + dia; o unique
 * `(recurring_id, occurred_at)` a garante). Com o id da linha, o toque trocava a chave: a linha
 * era desmontada e remontada com a entrada animada, e o dia ficava com um vão (28/09/2026, visto
 * quadro a quadro no simulador).
 */
const chaveDoItem = ({ tx, prevista }: Item) =>
  tx
    ? (tx.recurring_id ? `rec:${tx.recurring_id}:${tx.occurred_at}` : tx.id)
    : prevista!.origin === 'recurring'
      ? `rec:${prevista!.ref_id}:${prevista!.due_date}`
      : `${prevista!.origin}:${prevista!.ref_id}:${prevista!.due_date}`;

/** No mês/ciclo o ano já está na régua; intervalos livres precisam identificá-lo em cada dia. */
function dayTitle(iso: string, includeYear = false): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: includeYear ? '2-digit' : 'long',
    ...(includeYear ? { year: 'numeric' as const } : {}),
  });
}

function toSections(items: Item[], includeYear = false): DaySection[] {
  const sections: DaySection[] = [];
  let currentDay = '';
  for (const item of items) {
    const dia = dataDoItem(item);
    if (dia !== currentDay) {
      currentDay = dia;
      sections.push({ title: dayTitle(dia, includeYear), net: 0, data: [] });
    }
    const section = sections[sections.length - 1];
    section.data.push(item);
    const { kind, amount_cents } = item.tx ?? item.prevista!;
    if (kind === 'income') section.net += amount_cents;
    if (kind === 'expense') section.net -= amount_cents;
  }
  return sections;
}

/**
 * "Ver ocorrências" de uma série: contrato com passado e futuro (`frontend.md`, lista do mais
 * recente) — "A seguir" com a próxima primeiro, depois "Anteriores" com a mais recente primeiro.
 * Em ordem de data pura a tela abria em agosto do ano que vem (27/09/2026). O banco pagina do
 * futuro para o passado, então "A seguir" chega inteiro na primeira página e "Anteriores" cresce
 * com a rolagem.
 */
function toSeriesSections(items: Item[], hoje: string, includeYear = false): DaySection[] {
  // A atrasada em aberto (fora do cartão) é o que falta pagar: vai para o topo de "A seguir".
  // A prevista passada também falta — menos a estimada, que não prova que existiu.
  const falta = ({ tx, prevista }: Item) => tx
    ? tx.occurred_at >= hoje || (tx.status === 'pending' && !tx.invoice_id)
    : prevista!.due_date >= hoje || !prevista!.inferred_start;
  const aSeguir = toSections(items.filter(falta).reverse(), includeYear);
  const anteriores = toSections(items.filter((item) => !falta(item)), includeYear);
  if (aSeguir[0]) aSeguir[0].grupo = 'A seguir';
  if (anteriores[0]) anteriores[0].grupo = 'Anteriores';
  return [...aSeguir, ...anteriores];
}

/** Janela exata do link: as duas bordas ISO válidas e em ordem, senão ignora (cai no mês). */
function janelaDoLink(from?: string, to?: string): { from?: string; to?: string } {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  return from && to && iso.test(from) && iso.test(to) && from <= to ? { from, to } : {};
}

/**
 * A linha de um lançamento gravado. É COMPONENTE (e `memo`) para o `SectionList` não refazer a árvore
 * de cada linha a cada render da tela (digitar na busca, o "puxar para atualizar", a baixa de outra
 * linha): as props são escalares e `tx` é a referência que o TanStack compartilha entre refetches,
 * então só a linha que mudou renderiza. SEM entrada animada: lista que a pessoa está lendo não se
 * move por estética (design §5), e a animação refazia a cada "Ver mais".
 */
const LinhaDoExtrato = memo(function LinhaDoExtrato({
  tx, primeira, ultima, month, hoje, contaFiltrada, nomeDaConta, periodoLivre, onPagar, onApagar,
}: {
  tx: Transaction;
  primeira: boolean;
  ultima: boolean;
  month: string;
  hoje: string;
  contaFiltrada: string | undefined;
  nomeDaConta: string | undefined;
  periodoLivre: boolean;
  onPagar: (tx: Transaction) => void;
  onApagar: (tx: Transaction) => void;
}) {
  const theme = useTheme();
  const aparencia = useAparencia();
  const brl = useBRL();
  const host = [
    styles.rowHost,
    { backgroundColor: theme.surface },
    primeira && styles.groupTop,
    ultima && styles.groupBottom,
  ];
  /*
    ⚠️ **"previsto" saiu da frase cinza e virou PÍLULA.** Ele vinha emendado em
    `previsto · vence 08/10/2026 · assinaturas · Nubank · Cartão · recorrente`, com o
    mesmo peso do nome do cartão — seis palavras cinzas em que só a primeira diz se
    aquilo aconteceu. Quem abre o app pela primeira vez não tem como saber qual olhar.

    ⚠️ **E o que ela diz sai da DATA, não do `status`** (`estadoDaLinha`, 20/09/2026).
    Com `status === 'pending'` toda compra de cartão do mês aparecia como "previsto",
    inclusive a de ontem — a queixa foi literal. A ação de dar baixa, logo abaixo,
    continua sendo do `status`: o dinheiro dela ainda não saiu.
  */
  const estado = estadoDaLinha(tx, hoje);
  const emAberto = tx.status === 'pending';
  /**
   * ⚠️ **A linha diz a data da COMPRA, nunca o vencimento da fatura** (24/09/2026,
   * decisão do dono do produto: *"Mostre sempre a data do lançamento"*). Escrever
   * "na fatura de 10/10" numa compra de cartão fazia o vencimento ler como a data do
   * lançamento. A data é a do cabeçalho do dia; na parcela 2 em diante, que mora no mês
   * em que cai, a linha acrescenta "compra em 14/09". A fatura continua no detalhe
   * ("Entra na fatura de …"). Conta a pagar fora do cartão mantém "vence …": ali o
   * vencimento É a data daquela conta.
   */
  const tituloDaLinha = tx.description || tx.merchant || tx.category || 'Sem descrição';
  const previsto =
    previstoDaLinha(tx) ??
    (tx.debts?.calculation_mode ? parcelaDoContratoPaga(tx, tx.debts.calculation_mode !== 'fixed_installments') : null);
  const badges = [
    // "parcela 2" some quando o título já diz "(2/10)" — a mesma informação duas vezes.
    tx.installment_no && !/\(\d+\/\d+\)$/.test(tituloDaLinha) ? `parcela ${tx.installment_no}` : null,
    rotuloDaCompra(tx),
    emAberto && tx.invoice_id === null
      ? dueInline(tx.kind, tx.due_at ? formatDateBR(tx.due_at).slice(0, 5) : null).replace(/^previsto( · )?/, '')
      : null,
    // Paga com outro valor (07/10/2026): o valor da linha é o pago; o previsto vem aqui, curto.
    previsto === null ? null : `previsto ${brl(previsto)}`,
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
    tx.subcategories?.name ?? (tx.subcategory_id ? 'Detalhe a conferir' : null),
    // O nome da conta não parte ao meio ("Nubank / Cartão"): espaço inseparável nele.
    nomeDaConta?.replace(/ /g, '\u00A0') ?? null,
    SOURCE_LABEL[tx.source],
  ].filter(Boolean);

  return (
    <View style={host}>
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
                  arrasto: 'direita' as const,
                  onPress: () => onPagar(tx),
                },
              ]
            : []),
          {
            label: 'Ver detalhe',
            icon: 'doc.text.magnifyingglass',
            arrasto: 'fora' as const,
            onPress: () =>
              router.push({ pathname: '/finance/[txId]', params: { txId: tx.id, month } }),
          },
          {
            label: 'Editar',
            icon: 'pencil',
            // Pendente, a direita é o "Paguei"; efetivado, é o Editar.
            arrasto: tx.status === 'pending' ? undefined : ('direita' as const),
            onPress: () => router.push(hrefDoLancamento(tx, { month })),
          },
          ...(podeDuplicar(tx) ? [{
            label: 'Duplicar',
            icon: 'plus.square.on.square' as const,
            onPress: () => router.push(hrefDoLancar('uma', paramsDaCopia(tx, isoToBR(localISODate())).params)),
          }] : []),
          { label: 'Apagar', icon: 'trash', destructive: true, arrasto: 'esquerda', onPress: () => onApagar(tx) },
        ]}>
        {({ onLongPress }) => (
          <Row
            title={tituloDaLinha}
            inlineValue
            /*
              ⚠️ `atrasado` leva `danger`. `design.md §2`: vermelho é semântica — "erro
              e atraso" —, e é a última alavanca de cor que este app tem. Atraso em
              cinza-neutro ao lado de um número é o estado que mais pede ação lido como
              o que menos pede.
            */
            badge={
              estado
                ? {
                    label: estado,
                    tone:
                      estado === 'atrasado' ? 'danger'
                      : estado === 'não caiu' ? 'warning'
                      : undefined,
                  }
                : undefined
            }
            subtitle={[...badges, ...context].join(' · ')}
            icon={aparencia(tx.category, tx.kind).icon}
            tinta={aparencia(tx.category, tx.kind).cor}
            accessibilityLabel={`${tx.description || tx.merchant || tx.category || 'Lançamento'}, ${brl(tx.amount_cents)}, ${tx.kind === 'income' ? 'receita' : tx.kind === 'expense' ? 'despesa' : 'transferência'}, ${dayTitle(tx.occurred_at, periodoLivre)}${tx.subcategories?.name ? `, ${tx.subcategories.name}` : ''}${estado ? `, ${estado}` : ''}`}
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
    </View>
  );
});

/** Separador entre linhas: componente de módulo, para o `SectionList` não receber um novo a cada render. */
function Separador() {
  const theme = useTheme();
  return <View style={[styles.separator, { backgroundColor: theme.separator }]} />;
}

export default function TransactionsScreen() {
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width, windowClass } = useAdaptiveWindow();
  // A barra de filtros precisa caber AO LADO do livro-caixa. No intervalo 840–950dp a janela
  // já é expanded, mas os dois painéis ainda não têm largura útil depois do respiro editorial.
  // Nesse caso a lista nativa completa continua sendo a composição correta.
  const wideWorkspace = windowClass === 'expanded' &&
    tabletPaneWidths(Math.min(width, 1200) - Space.lg * 2).twoPane;
  const params = useLocalSearchParams<{
    month?: string;
    /** Janela EXATA (ISO), como a tela de origem a resolveu — vale no lugar de `month`. */
    from?: string;
    to?: string;
    /** `gasto` = a lente de "Por que mudou?": sem principal adiado nem pagamento de fatura. */
    lente?: string;
    kind?: string;
    category?: string;
    recurringId?: string;
    /** Id da conta/cartão, ou `none` para os lançamentos sem conta. */
    accountId?: string;
    subcategoryId?: string | string[];
    paymentMethods?: string | string[];
    expensePatterns?: string | string[];
    expenseNecessities?: string | string[];
  }>();

  /*
    ⚠️ **Guarda a ESCOLHA, não o mês.** Isto era `useState(() => params.month ?? currentMonth())`,
    e o inicializador preguiçoso roda UMA vez, na montagem, quando `cycle_now` ainda não
    respondeu — então a tela fixava o mês CIVIL e nunca se corrigia. Com fechamento no dia 10,
    entre os dias 11 e 30 ela abria um ciclo inteiro atrasada, mostrando o período que acabou de
    fechar como se fosse o que a pessoa está gastando agora.

    `null` quer dizer "o ciclo corrente, seja ele qual for"; quem escolhe um mês grava a escolha.
  */
  const [mesEscolhido, setMesEscolhido] = useState<string | null>(params.month ?? null);
  const [kind, setKind] = useState<TransactionKind | 'all'>(
    params.kind === 'expense' || params.kind === 'income' || params.kind === 'transfer'
      ? params.kind
      : 'all'
  );
  const [status, setStatus] = useState<'all' | 'pending' | 'cleared'>('all');
  const [lenteGasto, setLenteGasto] = useState(params.lente === 'gasto');
  const [category, setCategory] = useState<string | undefined>(params.category);
  const [accountId, setAccountId] = useState<string | undefined>(params.accountId);
  const [source, setSource] = useState<TransactionSource | undefined>(undefined);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodFilter[]>(() => parsePaymentMethodFilters(params.paymentMethods) ?? []);
  const [paymentLinkInvalid, setPaymentLinkInvalid] = useState(() => parsePaymentMethodFilters(params.paymentMethods) === null);
  const [expensePatterns, setExpensePatterns] = useState<ExpensePatternFilter[]>(() => parseExpensePatternFilters(params.expensePatterns) ?? []);
  const [expenseNecessities, setExpenseNecessities] = useState<ExpenseNecessityFilter[]>(() => parseExpenseNecessityFilters(params.expenseNecessities) ?? []);
  const [patternLinkInvalid, setPatternLinkInvalid] = useState(() => parseExpensePatternFilters(params.expensePatterns) === null);
  const [necessityLinkInvalid, setNecessityLinkInvalid] = useState(() => parseExpenseNecessityFilters(params.expenseNecessities) === null);
  const classificationLinkInvalid = patternLinkInvalid || necessityLinkInvalid;
  const [subcategoryId, setSubcategoryId] = useState<string | null | undefined>(() => parseSubcategoryFilter(params.subcategoryId).id);
  const hasDetailFilter = subcategoryId !== undefined;
  const [detailLinkInvalid, setDetailLinkInvalid] = useState(() => !parseSubcategoryFilter(params.subcategoryId).valid);
  const detailCatalog = useSubcategoryFilterOptions();
  const detailItems = detailCatalog.isSuccess && !detailCatalog.isError ? detailCatalog.data?.flatMap(state => state.items) ?? [] : [];
  const selectedDetail = typeof subcategoryId === 'string' ? detailItems.find(item => item.id === subcategoryId) : undefined;
  const detailPending = typeof subcategoryId === 'string' && detailCatalog.isPending;
  const detailUnavailable = typeof subcategoryId === 'string' && !detailPending && (!selectedDetail || detailCatalog.isError
    || subcategoryAfterParentChange(subcategoryId, selectedDetail.parent_category, category ?? selectedDetail.parent_category) === null);
  const filterLinkInvalid = paymentLinkInvalid || classificationLinkInvalid || detailLinkInvalid || detailUnavailable || detailPending;
  const [search, setSearch] = useState('');
  const [puxando, setPuxando] = useState(false);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [customDates, setCustomDates] = useState<{ from?: string; to?: string }>(() => janelaDoLink(params.from, params.to));
  const [minCents, setMinCents] = useState<number>();
  const [maxCents, setMaxCents] = useState<number>();
  // Busca-enquanto-digita sem uma requisição por tecla — agora ela vai ao banco.
  const term = useDebounced(search.trim(), 250);
  // Congelado na montagem: todas as linhas da lista são julgadas pelo MESMO "hoje". Lido por
  // linha, duas vizinhas poderiam cair em dias diferentes na virada da meia-noite.
  const [hoje] = useState(() => localISODate());

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
  const link = JSON.stringify([params.from, params.to, params.lente, params.month, params.kind, params.category, params.accountId, params.paymentMethods, params.expensePatterns, params.expenseNecessities, params.subcategoryId]);
  const [linkAplicado, setLinkAplicado] = useState(link);
  if (link !== linkAplicado) {
    setLinkAplicado(link);
    if (params.month) setMesEscolhido(params.month);
    if (params.from && params.to) setCustomDates(janelaDoLink(params.from, params.to));
    if (params.lente !== undefined) setLenteGasto(params.lente === 'gasto');
    if (params.kind === 'expense' || params.kind === 'income' || params.kind === 'transfer') {
      setKind(params.kind);
    }
    if (params.category) {
      setCategory(params.category);
      if (params.subcategoryId === undefined && typeof subcategoryId === 'string')
        setSubcategoryId(subcategoryAfterParentChange(subcategoryId, category ?? selectedDetail?.parent_category ?? null, params.category) ?? undefined);
    }
    if (params.subcategoryId !== undefined) {
      const parsed = parseSubcategoryFilter(params.subcategoryId);
      setDetailLinkInvalid(!parsed.valid); setSubcategoryId(parsed.id);
    }
    if (params.accountId) setAccountId(params.accountId);
    if (params.paymentMethods !== undefined) {
      const parsed = parsePaymentMethodFilters(params.paymentMethods);
      setPaymentLinkInvalid(parsed === null);
      if (parsed !== null) setPaymentMethods(parsed);
    }
    if (params.expensePatterns !== undefined) {
      const parsed = parseExpensePatternFilters(params.expensePatterns);
      setPatternLinkInvalid(parsed === null);
      if (parsed !== null) setExpensePatterns(parsed);
    }
    if (params.expenseNecessities !== undefined) {
      const parsed = parseExpenseNecessityFilters(params.expenseNecessities);
      setNecessityLinkInvalid(parsed === null);
      if (parsed !== null) setExpenseNecessities(parsed);
    }
  }

  // Abrir o extrato de uma conta é o que a dica das contas ensina (`conta-extrato`).
  useEffect(() => {
    if (accountId && accountId !== NO_ACCOUNT) usarDica('conta-extrato');
  }, [accountId]);

  // Nesta lista o nome “Julho” deve mostrar também os vencimentos de 31/07.
  // A pessoa ainda pode trocar para Ciclo nesta tela, sem afetar as demais.
  const regua = useMonthRuler('lancamentos', 'civil');
  // A série é percorrida por mês civil: o ciclo financeiro pode atravessar dois
  // meses e esconder justamente o vencimento que a pessoa está procurando.
  const view = params.recurringId ? 'civil' : regua.view;
  const mesCorrente = useCycleMonth(view);
  const month = mesEscolhido ?? mesCorrente;
  const setMonth = setMesEscolhido;
  const monthRange = useMonthRange(month, view);
  const customPeriod = Boolean(customDates.from || customDates.to);
  const openPeriod = customPeriod && !(customDates.from && customDates.to);
  const range = customPeriod ? { ...monthRange, from: customDates.from, to: customDates.to,
    pronto: true, isError: false, isPending: false, fetchStatus: 'idle' as const } : monthRange;
  const periodLabel = customDates.from && customDates.to
    ? `${formatDateBR(customDates.from)} a ${formatDateBR(customDates.to)}`
    : customDates.from ? `A partir de ${formatDateBR(customDates.from)}`
      : customDates.to ? `Até ${formatDateBR(customDates.to)}` : monthTitle(month);
  const periodDescription = openPeriod ? periodLabel.charAt(0).toLowerCase() + periodLabel.slice(1)
    : customPeriod ? `de ${periodLabel}` : `em ${periodLabel}`;
  const forecastsEnabled = range.pronto && !openPeriod && !filterLinkInvalid && !lenteGasto;
  const list = useTransactions({
    /*
      ⚠️ **As MESMAS bordas do resumo, não `month`.** O hook recortava o mês civil por conta
      própria, então o botão `Mês | Ciclo` logo acima não mexia na lista: com fechamento no dia
      10 ela mostrava 01/10–31/10 embaixo de um card que falava de 11/09–10/10.
    */
    from: range.from,
    to: range.to,
    pronto: range.pronto && !filterLinkInvalid,
    kind: kind === 'all' ? undefined : kind,
    category, subcategoryId, lenteGasto,
    recurringId: params.recurringId,
    accountId: accountId === undefined ? undefined : accountId === NO_ACCOUNT ? null : accountId,
    status: status === 'all' ? undefined : status,
    source,
    q: term,
    minCents, maxCents, paymentMethods, expensePatterns, expenseNecessities,
  });
  const expected = useExpectedLedgerLines(range.from, range.to, forecastsEnabled, params.recurringId);
  // O card global fica oculto em períodos personalizados; nenhuma RPC de total é necessária.
  const summary = useTransactionsSummary(range.from, range.to, range.pronto && !customPeriod && !filterLinkInvalid && !hasDetailFilter);
  /*
    ⚠️ **O card do topo soma a LISTA, e o ciclo virou o link do rodapé.** Ele já foi o contrário
    — lia `cycle_series` para bater com a home — e aí parou de bater com a lista logo abaixo
    dele: no ciclo de outubro dizia `saiu R$ 8.326,63` sobre uma lista de `R$ 3.842,78`. As duas
    leituras estão certas e respondem perguntas diferentes (data da compra × dia em que o
    dinheiro sai do caixa); o que não pode é a de OUTRA lente ocupar o topo desta.
  */
  const serieCiclo = useCycleSeries(month, month, regua.view);
  const ciclo = serieCiclo.data?.find((c) => mesmoMes(c.mes, month)) ?? null;
  /*
    Os totais do card saem de `transactions_summary`, que soma a MESMA janela da lista e exclui
    transferência (pagar fatura não é gasto novo: a compra já contou). Somar `rows` no cliente
    passaria a mentir na primeira página — a lista é paginada de 50 em 50.

    ⚠️ **A CONTAGEM sai daqui pelo mesmo motivo, e ela já esteve errada.** Era `rows.length`, ou
    seja, as linhas já baixadas: num período de 137 lançamentos o card escrevia
    "R$ 8.326,63 · 50 lançamentos", e o 50 virava 100 e 150 enquanto a pessoa rolava, com o valor
    parado do lado. Dinheiro do PERÍODO ao lado de contagem da PÁGINA é o mesmo defeito que este
    card foi reescrito para matar.

    `tx_count` conta na régua do dinheiro (competência, sem transferência) — que é o que o
    "por data da compra" ao lado promete. `rows.length` não batia com essa régua nem com a outra.
  */
  // "Paguei" confirma o valor numa folha curta antes da baixa (25/09/2026).
  const baixa = useConfirmarBaixa();
  const previstas = useAcoesDaPrevista({ month, pagar: baixa.abrir });
  // `toSections` agrupa em varredura linear, então o dia que atravessa a fronteira de duas
  // páginas continua sendo uma seção só depois do `flat()`.
  const rows = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);
  // Queries desligadas podem conservar cache e erro. O modo aberto exclui também esses dados.
  const expectedLines = useMemo(() => openPeriod || filterLinkInvalid || lenteGasto ? [] : filterExpectedLines(expected.data ?? [], {
    kind: kind === 'all' ? undefined : kind,
    status: status === 'all' ? undefined : status,
    category, subcategoryId,
    accountId: accountId === undefined ? undefined : accountId === NO_ACCOUNT ? null : accountId,
    source,
    recurringId: params.recurringId,
    q: term,
    minCents, maxCents, paymentMethods, expensePatterns, expenseNecessities,
  }), [openPeriod, filterLinkInvalid, lenteGasto, expected.data, kind, status, category, subcategoryId, accountId, source, params.recurringId, term, minCents, maxCents, paymentMethods, expensePatterns, expenseNecessities]);
  // Trocar de filtro durante a gravação não pode trazer uma ocorrência de outro recorte.
  const transitoFiltrado = useMemo(() => openPeriod || filterLinkInvalid || lenteGasto ? [] : filterExpectedLines(previstas.emTransito.filter(p =>
    (!range.from || p.due_date >= range.from) && (!range.to || p.due_date <= range.to)), {
      kind: kind === 'all' ? undefined : kind, status: status === 'all' ? undefined : status,
      category, subcategoryId, accountId: accountId === undefined ? undefined : accountId === NO_ACCOUNT ? null : accountId,
      source, recurringId: params.recurringId, q: term, minCents, maxCents, paymentMethods, expensePatterns, expenseNecessities,
    }), [openPeriod, filterLinkInvalid, lenteGasto, previstas.emTransito, range.from, range.to, kind, status, category, subcategoryId, accountId, source, params.recurringId, term, minCents, maxCents, paymentMethods, expensePatterns, expenseNecessities]);
  const previstasVisiveis = useMemo(
    () => previstasNaTela(expectedLines, transitoFiltrado, rows),
    [expectedLines, transitoFiltrado, rows]
  );
  const totais = useMemo(() => {
    let entrou = 0;
    let saiu = 0;
    let entrouPrevisto = 0;
    let saiuPrevisto = 0;
    let linhas = 0;
    for (const r of summary.data ?? []) {
      if (r.kind === 'income') {
        entrou += Number(r.total_cents);
        entrouPrevisto += Number(r.pending_cents);
      }
      if (r.kind === 'expense') {
        saiu += Number(r.total_cents);
        saiuPrevisto += Number(r.pending_cents);
      }
      linhas += Number(r.tx_count);
    }
    /*
      As previstas estão NA lista (misturadas por data), então entram no card — o total do topo
      soma exatamente as linhas de baixo. A que nasce paga (`status`) já aconteceu; o resto é previsto.
    */
    for (const p of previstasVisiveis) {
      // a mesma régua de `pending_cents` do resumo: o que ainda não saiu do caixa
      const emAberto = p.status === 'cleared' ? 0 : p.amount_cents;
      if (p.kind === 'income') { entrou += p.amount_cents; entrouPrevisto += emAberto; }
      else { saiu += p.amount_cents; saiuPrevisto += emAberto; }
      linhas += 1;
    }
    return { entrou, saiu, entrouPrevisto, saiuPrevisto, linhas };
  }, [summary.data, previstasVisiveis]);

  const accounts = useAccounts(undefined, true);
  const categories = useCategoriesUsed();
  // Só o extrato de UMA conta mostra saldo: sem conta filtrada não há por que ir ao banco.
  const saldos = useAccountBalances(accountId !== undefined && accountId !== NO_ACCOUNT);
  // O saldo respeita o "esconder valores" (`useBRL`), como na tela Contas.
  const brl = useBRL();
  const { concealed } = useConceal();
  // Um item basta para separar "nunca teve nada" de "este mês não teve nada".
  const anyEver = useRecentTransactions(1);
  const remove = useDeleteTransaction();
  const { apagar } = useApagarComAlcance();

  const accountName = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts.data ?? []) map.set(a.id, accountLabel(a));
    return map;
  }, [accounts.data]);

  /*
    O PORTÃO DA TELA (Fase 5) — 9 consultas, 5 portões antes disto.

    ⚠️ **`list` e `summary` nascem desligadas** (`pronto`) e mesmo assim entram aqui — porque o
    `range` está na mesma conjunção. Enquanto as bordas buscam, o range segura o portão; quando
    chegam, as duas ligam no mesmo render e passam a segurá-lo de verdade. É a composição que
    torna a lista parte da primeira pintura em vez de chegar depois dela.

    ⚠️ **O range entra como CONSULTA, não como `range.pronto`** (16/09/2026). O booleano ficava
    `false` para sempre quando o `cycle_range` falhava, e a tela parava no skeleton sem erro nem
    "Tentar de novo". Como consulta, ele libera quando falha, e a falha aparece no card e na
    lista. `regua.cycle` entra porque é ele que dá NOME ao mês. Ver `tela-pronta.ts`.
  */
  const pronta = useTelaPronta(accounts, anyEver, list,
    ...(openPeriod ? [] : [expected]),
    ...(customPeriod ? [] : [summary, serieCiclo, regua.cycle, range]));

  /** O ciclo corrente não veio: o mês exibido seria o palpite civil, com o nome errado. */
  const cicloFalhou = !customPeriod && regua.cycle.isError && !regua.cycle.data;
  /** Sem período utilizável: nem o resumo nem a lista têm como responder. */
  const periodoFalhou = cicloFalhou || range.isError;
  /**
   * Refaz o que o período precisa. `refetch` do TanStack ignora `enabled`, então resumo e lista
   * só são refeitos com as bordas definitivas — sem elas, refazer o range basta: a chave muda e
   * os dois ligam sozinhos.
   */
  const refazerPeriodo = () =>
    Promise.all([
      ...(cicloFalhou ? [regua.cycle.refetch()] : []),
      ...(range.isError ? [range.refetch()] : []),
      ...(range.pronto && !filterLinkInvalid ? [list.refetch()] : []),
      ...(range.pronto && !customPeriod && !filterLinkInvalid && !hasDetailFilter ? [summary.refetch()] : []),
      ...(forecastsEnabled ? [expected.refetch()] : []),
    ]);

  // Falhou a leitura dos lançamentos: a lista mostra o erro, nunca uma lista só de previstas.
  const itens = useMemo(
    () => (list.isError || filterLinkInvalid ? [] : mesclarPrevistas(rows, previstasVisiveis, Boolean(list.hasNextPage))),
    [rows, previstasVisiveis, list.hasNextPage, list.isError, filterLinkInvalid]
  );
  const sections = useMemo(
    () => (params.recurringId ? toSeriesSections(itens, hoje, customPeriod) : toSections(itens, customPeriod)),
    [itens, params.recurringId, hoje, customPeriod]
  );

  /** Id da conta filtrada; `undefined` na lista global e também em "Sem conta". */
  const contaFiltrada = accountId === undefined || accountId === NO_ACCOUNT ? undefined : accountId;
  const saldoFiltrado = contaFiltrada ? saldos.data?.find((x) => x.account_id === contaFiltrada) : undefined;
  const saldoDaContaFiltrada = saldoFiltrado
    ? (() => {
        const saldo = saldoDaConta(saldoFiltrado);
        return (
          <Card style={styles.saldoConta}>
            <View style={styles.saldoLinha}>
              <ThemedText type="small" themeColor="textSecondary">
                {saldo.rotulo}
              </ThemedText>
              <Money cents={saldo.cents} variant="headline" tone={saldo.cents < 0 ? 'danger' : 'text'} />
            </View>
            {saldo.previsto > 0 ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                {`${brl(saldo.previsto)} ${saldo.previstoTexto}`}
              </ThemedText>
            ) : null}
          </Card>
        );
      })()
    : null;

  /** Título da tela quando ela está filtrada por conta — não é o rótulo de uma conta. */
  // "Ver ocorrências" de uma recorrente: a série inteira, com o nome dela no título.
  // Só "Ver ocorrências" precisa do NOME da série: a lista inteira de séries não é lida na abertura comum.
  const series = useRecurringTransactions(Boolean(params.recurringId));
  const nomeDaSerie = params.recurringId
    ? (series.data?.find((r) => r.id === params.recurringId)?.description ?? 'Ocorrências')
    : undefined;
  const tituloDaConta =
    accountId === undefined
      ? undefined
      : accountId === NO_ACCOUNT
        ? 'Sem conta'
        : (accountName.get(accountId) ?? 'Extrato');

  // A mesma fonte governa a folha, a contagem e o resumo: não há filtros paralelos.
  const filterValue: ListFiltersValue = {
    q: search, ...customDates, minCents, maxCents, selections: {
      kind: kind === 'all' ? '' : kind, status: status === 'all' ? '' : status,
      category: category ?? '', ...(subcategoryId !== undefined ? { subcategoryId: subcategoryId === null ? 'none' : subcategoryId } : {}), accountId: accountId ?? '', source: source ?? '',
    },
    ...(paymentMethods.length || expensePatterns.length || expenseNecessities.length ? {
      multiSelections: {
        ...(paymentMethods.length ? { paymentMethods } : {}),
        ...(expensePatterns.length ? { expensePatterns } : {}),
        ...(expenseNecessities.length ? { expenseNecessities } : {}),
      },
    } : {}),
  };
  const filterCount = listFilterCount(filterValue);
  const hasFilters = filterCount > 0;
  const valueSummary = minCents !== undefined && maxCents !== undefined
    ? `${brl(minCents)} a ${brl(maxCents)}`
    : minCents !== undefined ? `A partir de ${brl(minCents)}`
      : maxCents !== undefined ? `Até ${brl(maxCents)}` : undefined;
  const selectedPaymentMethods = new Set(paymentMethods);
  const selectedPatterns = new Set(expensePatterns);
  const selectedNecessities = new Set(expenseNecessities);
  const filterDetails = [
    tituloDaConta,
    kind !== 'all' ? KIND_OPTIONS.find(o => o.value === kind)?.label : undefined,
    status !== 'all' ? STATUS_OPTIONS.find(o => o.value === status)?.label : undefined,
    category === NO_CATEGORY ? 'Sem categoria' : category,
    lenteGasto ? 'Gastos lançados por data, sem fatura adiada' : undefined,
    subcategoryId === null ? 'Sem detalhe' : subcategoryId !== undefined ? selectedDetail ? `${selectedDetail.parent_category} · ${selectedDetail.name}` : 'Detalhe a conferir' : undefined,
    source ? SOURCE_FILTER.find(o => o.value === source)?.label : undefined,
    paymentMethods.length ? PAYMENT_METHOD_FILTER_OPTIONS.filter(o => selectedPaymentMethods.has(o.id)).map(o => o.label).join(', ') : undefined,
    expensePatterns.length ? `Previsibilidade dos gastos: ${EXPENSE_PATTERN_FILTER_OPTIONS.filter(o => selectedPatterns.has(o.id)).map(o => o.label).join(', ')}` : undefined,
    expenseNecessities.length ? `Necessidade dos gastos: ${EXPENSE_NECESSITY_FILTER_OPTIONS.filter(o => selectedNecessities.has(o.id)).map(o => o.label).join(', ')}` : undefined,
    valueSummary, search.trim() ? `Busca: ${search.trim()}` : undefined,
  ].filter(Boolean);
  const fullFilterSummary = filterDetails.join(' · ');
  // Resumir critérios é diferente de cortar rótulos: nomes completos continuam quebrando linha.
  const filterSummary = [...filterDetails.slice(0, 2),
    ...(filterDetails.length > 2 ? [`mais ${filterDetails.length - 2}`] : [])].join(' · ');

  /**
   * A lista está mostrando MENOS que o período inteiro?
   *
   * ⚠️ **Não é `hasFilters`, e a diferença é o `recurringId`.** Ele chega por ROTA ("ver
   * ocorrências" de uma recorrente), é lido direto de `params` e `clearFilters` não tem como
   * limpá-lo — por isso ele fica fora de `hasFilters`, que governa o "Limpar filtros" do estado
   * vazio. Mas ele recorta a lista igual a qualquer filtro: sem esta linha o card somava o
   * período inteiro em cima de uma ocorrência só, escrevendo "GASTEI EM OUTUBRO R$ 3.842,78 ·
   * 1 lançamento" sobre uma linha de R$ 88,85. É o mesmo defeito que o card acabou de perder.
   */
  const listaRecortada = hasFilters || lenteGasto || Boolean(params.recurringId) || filterLinkInvalid;
  /*
    ⚠️ **`!anyEver.isError` junto.** Com a query falhando, `data` é undefined, `?? []` vira lista
    vazia e quem tem anos de histórico recebia "Nenhum lançamento ainda" com a dica de
    onboarding do WhatsApp — perdendo o "Nada em outubro / Ver setembro", que é o estado certo.
  */
  const neverHadAnything =
    (anyEver.data ?? []).length === 0 && !anyEver.isLoading && !anyEver.isError;

  /** Não há o que resumir — inclui o mês sem movimento e o "nunca teve nada". */
  const listaVazia = sections.length === 0 && !list.isPending;

  const clearFilters = () => {
    setKind('all');
    setStatus('all'); setLenteGasto(false);
    setCategory(undefined); setSubcategoryId(undefined); setDetailLinkInvalid(false);
    setAccountId(undefined);
    setSource(undefined);
    setPaymentMethods([]); setPaymentLinkInvalid(false);
    setExpensePatterns([]); setExpenseNecessities([]);
    setPatternLinkInvalid(false); setNecessityLinkInvalid(false);
    setSearch('');
    setCustomDates({}); setMinCents(undefined); setMaxCents(undefined);
  };
  const applyFilters = (value: ListFiltersValue) => {
    const nextPaymentMethods = normalizePaymentMethodFilters(value.multiSelections?.paymentMethods);
    const nextPatterns = normalizeExpensePatternFilters(value.multiSelections?.expensePatterns);
    const nextNecessities = normalizeExpenseNecessityFilters(value.multiSelections?.expenseNecessities);
    setPaymentMethods(nextPaymentMethods);
    setExpensePatterns(nextPatterns); setExpenseNecessities(nextNecessities);
    setPaymentLinkInvalid(false);
    setPatternLinkInvalid(false); setNecessityLinkInvalid(false);
    setSearch(value.q ?? ''); setCustomDates({ from: value.from, to: value.to });
    setMinCents(value.minCents); setMaxCents(value.maxCents);
    setKind((value.selections?.kind || 'all') as typeof kind);
    setStatus((value.selections?.status || 'all') as typeof status);
    const nextCategory = value.selections?.category || undefined;
    const parsedDetail = parseSubcategoryFilter(value.selections?.subcategoryId || undefined);
    const nextDetail = typeof parsedDetail.id === 'string' ? detailItems.find(item => item.id === parsedDetail.id) : undefined;
    // Changing the parent clears an inherited choice. A new explicit identity must still
    // exist in this catalog and belong to its selected parent before reads can run.
    const inherited = parsedDetail.id === subcategoryId && typeof subcategoryId === 'string';
    const parentChanged = inherited && subcategoryAfterParentChange(subcategoryId,
      category ?? selectedDetail?.parent_category ?? null, nextCategory ?? selectedDetail?.parent_category ?? null) === null;
    setSubcategoryId(parentChanged ? undefined : parsedDetail.id);
    setDetailLinkInvalid(!parsedDetail.valid || (!parentChanged && typeof parsedDetail.id === 'string' &&
      (!nextDetail || subcategoryAfterParentChange(parsedDetail.id, nextDetail.parent_category, nextCategory ?? nextDetail.parent_category) === null)));
    setCategory(nextCategory);
    setAccountId(value.selections?.accountId || undefined);
    setSource((value.selections?.source || undefined) as typeof source);
  };

  const pay = (tx: Transaction) => baixa.abrir(tx.id);

  /** Destrutivo = action sheet nativo. `onLongPress` + `Alert` é proibido nesta tela. */
  const confirmDelete = (tx: Transaction) => {
    const alvo = alvoDoLancamento(tx, tx.description || tx.merchant || tx.category || 'Lançamento');
    if (alvo) return apagar(alvo);
    const what = `${formatBRL(tx.amount_cents)}${tx.category ? ` em ${tx.category}` : ''}`;
    confirmDestructive(
      'Apagar este lançamento?',
      'Apagar',
      () =>
        remove.mutate(tx.id, {
          onSuccess: () => toast({ message: `Apaguei ${what}.`, tone: 'success' }),
          onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para apagar. Tenta de novo.'), tone: 'error' }),
        }),
      `${what}. Isso não volta.`
    );
  };

  /*
    Identidade ESTÁVEL para a linha memoizada (`LinhaDoExtrato`): `pay` e `confirmDelete` nascem de
    novo a cada render, e passá-los direto desfazia o `memo` de toda linha. O ref guarda a versão
    atual (atualizada depois do commit — o toque só acontece depois dele).
  */
  const acoesDaLinha = useRef({ pagar: pay, apagar: confirmDelete });
  useEffect(() => { acoesDaLinha.current = { pagar: pay, apagar: confirmDelete }; });
  const pagarLinha = useCallback((tx: Transaction) => acoesDaLinha.current.pagar(tx), []);
  const apagarLinha = useCallback((tx: Transaction) => acoesDaLinha.current.apagar(tx), []);

  /*
    A busca é FIXA (pedido do dono do produto, 19/09/2026): no telefone ela vai para o slot
    `search` do `Screen` — barra nativa no iOS, faixa acima da lista no Android — e o extrato rola
    por baixo dela. No iPad ela continua no painel lateral, junto dos outros filtros, que já não
    rola com a lista.
  */
  const busca = (
    <Search
      value={search}
      onChangeText={setSearch}
      placeholder="Buscar lançamentos"
      accessibilityLabel="Buscar lançamentos"
    />
  );

  const header = (
    <View style={styles.header}>
      {wideWorkspace ? busca : null}

      {/* O extrato de UMA conta começa pelo saldo dela (24/09/2026): só dizia os totais do
          período, e "quanto tem nessa conta?" não tinha resposta em tela nenhuma. A régua é a
          da tela Contas (`saldoDaConta`). */}
      {saldoDaContaFiltrada}

      {customPeriod ? null : params.recurringId
        ? <MonthPicker month={month} onChange={setMonth} />
        : <PeriodBar month={month} onChangeMonth={setMonth} ruler={regua} />}
      <View style={styles.filterOverview}>
        <View style={styles.filterRow}>
          <View style={styles.filterText}>
            {/* Ocultar valores remonta o texto: dinheiro aberto não permanece na camada de saída. */}
            <MudancaSuave key={String(concealed)} valor={customPeriod ? periodLabel : filterSummary}>
              <ThemedText type={customPeriod ? 'smallBold' : 'small'}
                themeColor={customPeriod ? 'text' : 'textSecondary'}
                accessibilityLabel={customPeriod ? `Período: ${periodLabel}` : fullFilterSummary || 'Todos os lançamentos'}>
                {customPeriod ? periodLabel : filterSummary || 'Todos os lançamentos'}
              </ThemedText>
            </MudancaSuave>
          </View>
          <Button label={filterCount ? `Filtros · ${filterCount}` : 'Filtros'}
            icon="line.3.horizontal.decrease" variant={hasFilters ? 'primary' : 'secondary'} size="sm"
            onPress={() => setFiltersVisible(true)} />
        </View>
        {customPeriod && filterSummary ? <MudancaSuave key={String(concealed)} valor={filterSummary}>
          <ThemedText type="small" themeColor="textSecondary" accessibilityLabel={fullFilterSummary}>
            {filterSummary}
          </ThemedText>
        </MudancaSuave> : null}
      </View>

      {openPeriod ? <ThemedText type="footnote" themeColor="textSecondary">
        Lançamentos registrados. Escolha as duas datas para incluir previsões.
      </ThemedText> : null}
      {expensePatterns.length || expenseNecessities.length ? <ThemedText type="footnote" themeColor="textSecondary">
        Classificação filtra apenas gastos de consumo, sem pagamentos de fatura.
      </ThemedText> : null}

      {/*
        ⚠️ **Com filtro ativo o card SOME.** Ele soma o período inteiro; a lista filtrada soma
        menos. Deixá-lo ali recriaria, com outra cara, o mesmo defeito que ele acabou de perder:
        um total no topo que não é o total do que está embaixo.

        ⚠️ **A falha de `serieCiclo` não derruba o card.** O conteúdo dele é o resumo; o ciclo é
        só o link do rodapé, e `ciclo={null}` o omite. Estados separados por seção, §7.
      */}
      {/*
        ⚠️ **Zeros em cima de um empty state é a outra metade da mesma regra** (§1): *"card de
        destaque que SOMA uma lista some quando a soma não informa nada — com a lista vazia
        (zeros em cima de um empty state)... foi o caso de Cartões"*. Num mês sem movimento o
        `ListHeaderComponent` desenhava `R$ 0,00 · 0 lançamentos` e duas barras vazias logo acima
        de "Nada em outubro". Custo aceito: o link do ciclo também some no mês vazio, que é o que
        a regra manda.
      */}
      {listaRecortada || listaVazia ? null : periodoFalhou || summary.isError ? (
        <ErrorCard onRetry={() => { void refazerPeriodo(); }} />
      ) : /*
          ⚠️ **`!range.pronto` junto.** Enquanto `cycle_range` não responde, `useMonthRange`
          devolve o palpite CIVIL — e o resumo, que não espera, voltaria com o total da janela
          errada por cima de uma lista ainda vazia ("R$ 3.718,64 · 0 lançamentos"). O card só
          aparece quando os dois falam da mesma janela.
        */
        summary.isPending || !range.pronto ? (
        /*
          A FORMA do conteúdo final (§7), não duas barrinhas: o card tem ~230px e o esqueleto
          tinha ~66px, então a lista inteira saltava ~165px quando o resumo chegava — e ela é o
          `ListHeaderComponent`, então saltava tudo junto. É o mesmo padrão do card de tendência
          do Financeiro e do pager da Fatura.

          284 é a soma dos tokens COM as duas linhas de "já aconteceu" (16 + 14 + 8 + 38 + 8 +
          18 + 8 + 104 + 16 + 54). Era 230, medido antes do split, e voltou a saltar ~54px — o
          mês corrente, que é o que abre, sempre tem previsto.
        */
        <Skeleton height={284} radius={Radius.md} />
      ) : (
        <PeriodSummaryCard
          entrou={totais.entrou}
          saiu={totais.saiu}
          entrouPrevisto={totais.entrouPrevisto}
          saiuPrevisto={totais.saiuPrevisto}
          ciclo={ciclo}
          nomeDoMes={monthTitle(month).replace(/ de \d{4}$/, '').toLowerCase()}
          lancamentos={totais.linhas}
          onAbrirCiclo={() =>
            router.push({
              pathname: '/finance/cycle',
              params: { month, view: regua.view, tipo: 'tudo' },
            })
          }
        />
      )}

      {/* As previstas moram na lista, no dia delas; a falha da leitura delas aparece aqui. */}
      {forecastsEnabled && expected.isError ? <ErrorCard onRetry={expected.refetch} /> : null}
      {/* Aponta para a primeira linha: só com linhas, e só onde a lista vem logo abaixo. */}
      {sections.length > 0 && !wideWorkspace ? <Dica id="lista-arrasto" tela="lancamentos" bico="baixo" /> : null}
    </View>
  );

  /*
    ⚠️ **A falha do período vem ANTES de `list.isPending`.** Sem bordas a lista não liga, e uma
    consulta desligada fica `isPending` para sempre — o ramo de cima desenharia três linhas de
    esqueleto indefinidamente, mesmo com o portão da tela já aberto.
  */
  const empty = typeof subcategoryId === 'string' && detailCatalog.isError ? (
    <ErrorCard message="Não consegui conferir este detalhe" onRetry={() => { void detailCatalog.refetch(); }} />
  ) : detailLinkInvalid || detailUnavailable ? (
    <EmptyState compacto icon="line.3.horizontal.decrease" title={detailLinkInvalid ? "Detalhe inválido no link" : "Não consegui conferir este detalhe"}
      hint="Abra os filtros para escolher um detalhe disponível nesta categoria."
      action={{ label: 'Ajustar filtros', onPress: () => setFiltersVisible(true) }} />
  ) : detailPending ? (
    <SkeletonRow />
  ) : classificationLinkInvalid ? (
    <EmptyState compacto icon="line.3.horizontal.decrease" title="Classificação de gasto inválida no link"
      hint="Abra os filtros para ajustar a seleção."
      action={{ label: 'Ajustar filtros', onPress: () => setFiltersVisible(true) }} />
  ) : paymentLinkInvalid ? (
    <EmptyState compacto icon="line.3.horizontal.decrease" title="Forma de pagamento inválida no link"
      hint="Abra os filtros para escolher as formas de pagamento."
      action={{ label: 'Ajustar filtros', onPress: () => setFiltersVisible(true) }} />
  ) : periodoFalhou ? (
    <ErrorCard onRetry={() => { void refazerPeriodo(); }} />
  ) : list.isError ? (
    <ErrorCard onRetry={list.refetch} />
  ) : list.isPending ? (
    <View>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </View>
  // The expected-query error already appears in the header. A successful
  // projection must never conceal a failed read of recorded transactions.
  ) : forecastsEnabled && expected.isError ? null : params.recurringId && !hasFilters ? (
    // Série recém-criada ou com o calendário refeito: o agendador gera as ocorrências em até um
    // minuto, e a lista se atualiza sozinha quando elas chegam.
    <EmptyState compacto icon="repeat" title="Esta recorrente ainda não tem ocorrências" />
  ) : hasFilters ? (
    <EmptyState compacto
      icon="line.3.horizontal.decrease"
      title={
        search.trim()
          ? <>Nenhum lançamento com <Forte>{search.trim()}</Forte> {periodDescription}</>
          : `Nenhum lançamento com esse filtro ${periodDescription}`
      }
      action={{ label: 'Limpar filtros', onPress: clearFilters }}
    />
  ) : neverHadAnything ? (
    <EmptyState
      icon="tray"
      title="Nenhum lançamento ainda"
      hint={'Manda *gastei 45 no mercado* no WhatsApp —\nou toca no + para lançar aqui'}
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

  /*
    ⚠️ **Sem `View` em volta do `<Screen>`, e isso NÃO é estilo.** Esta é uma tela EMPURRADA
    (`scroll={false}`, sem `topBar`), e nesse caso `Screen` devolve um Fragment de propósito: o
    iOS procura o scroll da interação do large title andando pelos PRIMEIROS subviews a partir da
    raiz, e a busca é rasa. Com uma `View` no meio ele não acha o `SectionList`,
    `prefersLargeTitles` fica ligado e o título nunca colapsa — fica cravado enquanto o conteúdo
    rola por baixo. É a queixa "o título tá descendo junto com a tela", que custou 23 arquivos em
    11/09/2026, e `screen.tsx` documenta a armadilha na própria linha que devolve o Fragment.

    O fundo vem do `contentStyle` que o `Screen` escreve no navegador. A ação
    Lançar fica no header nativo: um botão flutuante cobria o valor e a data
    das recorrências quando o cartão caía no fim da primeira janela visível.
  */
  if (!pronta) {
    return (
      <Screen grouped>
        <SkeletonChart altura={96} />
        <SkeletonList linhas={4} />
      </Screen>
    );
  }

  const contaDoFiltro = contaFiltrada ? accounts.data?.find((a) => a.id === contaFiltrada) : undefined;
  const abrirLancamento = () => router.push(hrefDoLancar('uma', { month, ...(contaDoFiltro ? { conta: contaDoFiltro.id } : {}) }));
  const menu = (
    <HeaderActions
          actions={params.recurringId ? [] : [{ label: 'Lançar', icon: 'plus', onPress: abrirLancamento }]}
          menu={{ title: 'Mais opções', actions: [
            // Olhando UMA conta, ela se edita daqui, e o extrato importado já vai para ela (25/09/2026).
            ...(contaDoFiltro
              ? [
                  {
                    label: contaDoFiltro.type === 'credit_card' ? 'Editar cartão' : 'Editar conta',
                    icon: 'pencil' as const,
                    onPress: () => router.push(`/finance/accounts?edit=${contaDoFiltro.id}`),
                  },
                ]
              : []),
            {
              label: 'Importar extrato',
              icon: 'square.and.arrow.down',
              onPress: () =>
                router.push(contaDoFiltro ? { pathname: '/import', params: { conta: contaDoFiltro.id } } : '/import'),
            },
            {
              label: 'Regras',
              icon: 'line.3.horizontal.decrease',
              onPress: () => router.push('/finance/rules'),
            },
          ] }}
    />
  );

  const ledgerList = (
    <SectionList<Item, DaySection>
          keyboardShouldPersistTaps="handled"
          // Rolar fecha o card arrastado que estiver aberto (Deslizavel).
          onScrollBeginDrag={fecharDeslizavelAberto}
          sections={sections}
          keyExtractor={chaveDoItem}
          style={styles.listHost}
          contentInsetAdjustmentBehavior="automatic"
          stickySectionHeadersEnabled
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Space.xxxl * 2 }]}
          ListHeaderComponent={wideWorkspace ? null : header}
          ListEmptyComponent={empty}
          ListFooterComponent={list.isFetchingNextPage ? <SkeletonRow /> : null}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (!filterLinkInvalid && list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
          }}
          // O indicador é do GESTO (§6 do design), não do `isRefetching`.
          refreshing={puxando}
          onRefresh={() => {
            setPuxando(true);
            void Promise.all([refazerPeriodo(), accounts.refetch(), anyEver.refetch()]).finally(() =>
              setPuxando(false)
            );
          }}
          renderSectionHeader={({ section }) => (
            <View style={{ backgroundColor: theme.groupedBackground }}>
            {section.grupo ? (
              <ThemedText type="headline" accessibilityRole="header" style={styles.grupoDaSerie}>
                {section.grupo}
              </ThemedText>
            ) : null}
            <View style={[styles.dayHeader, { backgroundColor: theme.groupedBackground }]}>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                accessibilityRole="header"
                style={styles.dayTitle}>
                {section.title}
              </ThemedText>
              <View style={styles.dayNet}>
                <Money cents={section.net} variant="footnote" tone="textSecondary" signed />
              </View>
            </View>
            </View>
          )}
          renderItem={({ item, index, section }) => {
            const host = [
              styles.rowHost,
              { backgroundColor: theme.surface },
              index === 0 && styles.groupTop,
              index === section.data.length - 1 && styles.groupBottom,
            ];
            if (item.prevista) {
              const line = item.prevista;
              return (
                <View style={host}>
                  <LinhaPrevista
                    line={line}
                    hoje={hoje}
                    conta={line.kind === 'transfer' && line.account_id && line.counterparty_account_id
                      ? `${accountName.get(line.account_id) ?? ''} → ${accountName.get(line.counterparty_account_id) ?? ''}`
                      : line.account_id ? accountName.get(line.account_id) : undefined}
                    acoes={previstas.acoes(line)}
                    onAbrir={() => { void previstas.abrir(line); }}
                  />
                </View>
              );
            }
            return (
              <LinhaDoExtrato
                tx={item.tx}
                primeira={index === 0}
                ultima={index === section.data.length - 1}
                month={month}
                hoje={hoje}
                contaFiltrada={contaFiltrada}
                nomeDaConta={item.tx.account_id ? accountName.get(item.tx.account_id) : undefined}
                periodoLivre={customPeriod}
                onPagar={pagarLinha}
                onApagar={apagarLinha}
              />
            );
          }}
          ItemSeparatorComponent={Separador}
        />
  );

  const controls = (
    <ScrollView
      style={styles.controlsScroll}
      contentContainerStyle={styles.controlsContent}
      // O painel lateral do iPad também corre sob o header translúcido (`app/_layout.tsx`).
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled">
      {header}
    </ScrollView>
  );

  /*
    A janela ampla separa apenas a apresentação: a mesma SectionList continua dona da
    virtualização, paginação, refresh e ações. O wrapper limita a largura da lista;
    em compacto/médio `ledger` é a SectionList literal para preservar o large title nativo.
  */
  const ledger = wideWorkspace ? (
    <View style={styles.ledgerPane}>
      {ledgerList}
    </View>
  ) : ledgerList;

  return (
    <Screen
      scroll={false}
      grouped
      wide={wideWorkspace}
      search={wideWorkspace ? undefined : busca}>
      <Stack.Screen
        options={{ title: nomeDaSerie ?? tituloDaConta ?? 'Lançamentos' }}
      />
      {menu}
      <ListFilters visible={filtersVisible} onClose={() => setFiltersVisible(false)} onApply={applyFilters}
        value={filterValue} showValues dateLabels={{ from: 'Lançamento a partir de', to: 'Lançamento até' }}
        resetDatesLabel={view === 'cycle' ? 'Voltar ao ciclo' : 'Voltar ao mês'}
        multiSelects={[
          { key: 'paymentMethods', label: 'Formas de pagamento', options: PAYMENT_METHOD_FILTER_OPTIONS },
          { key: 'expensePatterns', label: 'Previsibilidade dos gastos', options: EXPENSE_PATTERN_FILTER_OPTIONS },
          { key: 'expenseNecessities', label: 'Necessidade dos gastos', options: EXPENSE_NECESSITY_FILTER_OPTIONS },
        ]}
        selects={[
          { key: 'kind', label: 'Tipo', options: KIND_OPTIONS.filter(o => o.value !== 'all').map(o => ({ id: o.value, label: o.label })) },
          { key: 'status', label: 'Situação', options: STATUS_OPTIONS.filter(o => o.value !== 'all').map(o => ({ id: o.value, label: o.label })) },
          { key: 'category', label: 'Categoria', options: (categories.data ?? []).map(c => ({ id: c.category, label: c.category })) },
          { key: 'subcategoryId', label: 'Detalhe', options: [{ id: 'none', label: 'Sem detalhe' },
            ...detailItems.map(item => ({ id: item.id, label: `${item.parent_category} · ${item.name}` }))] },
          { key: 'accountId', label: 'Conta ou cartão', options: accountSelectOptions(accounts.data ?? [], 'Sem conta', 'none') },
          { key: 'source', label: 'Origem', options: SOURCE_FILTER.map(o => ({ id: o.value, label: o.label })) },
        ]} />
      {wideWorkspace ? (
        <View style={styles.wideCanvas}>
          <AdaptivePanes
            main={ledger}
            support={controls}
            singlePane="main-only"
            singlePaneContent={<View style={styles.singlePane}>{controls}{ledger}</View>}
            fill
            testID="transactions-tablet-workspace"
          />
        </View>
      ) : (
        ledger
      )}
      {baixa.folha}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterOverview: { gap: Space.sm },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.md },
  filterText: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 180 },
  listHost: {
    flex: 1,
  },
  list: {
    paddingHorizontal: Space.lg,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  ledgerPane: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
    width: '100%',
  },
  wideCanvas: {
    flex: 1,
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
  },
  singlePane: {
    flex: 1,
    minWidth: 0,
  },
  controlsScroll: {
    flex: 1,
  },
  controlsContent: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxxl,
  },
  header: {
    gap: Space.lg,
    paddingTop: Space.md,
    paddingBottom: Space.lg,
  },
  // Sem uso: o esqueleto virou um bloco único com a altura do card.

  dayHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    // O dia fica a `Space.md` dos lançamentos dele e mais longe do grupo de cima — com `sm` nos
    // dois lados ele ficava no meio, sem dizer a qual grupo pertence (§2, 25/09/2026).
    paddingTop: Space.lg,
    paddingBottom: Space.md,
  },
  dayTitle: {
    letterSpacing: 0.2,
    // Data inteira precisa de espaço útil; o total ocupa a próxima linha em fonte ampliada.
    minWidth: 180,
    flexGrow: 1,
  },
  dayNet: { marginLeft: 'auto' },
  grupoDaSerie: { paddingTop: Space.lg },
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
  saldoConta: { gap: Space.xs },
  saldoLinha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: Space.sm },
});
