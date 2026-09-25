import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, SectionList, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { categoryIcon } from '@/design/category-icons';
import { ErrorCard } from '@/components/error-card';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { monthTitle, shiftMonth } from '@/components/finance/month-picker';
import { useMonthRuler } from '@/components/finance/month-ruler';
import { PeriodBar } from '@/components/finance/period-bar';
import { ThemedText } from '@/components/themed-text';
import { HeaderMenu } from '@/components/ui/header-actions';
import { ItemLink } from '@/components/ui/item-link';
import { Search } from '@/components/ui/search';
import { PeriodSummaryCard } from '@/components/finance/period-summary-card';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/finance/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Card } from '@/components/ui/card';
import { Dica } from '@/components/ui/dica';
import { useBRL } from '@/components/ui/conceal';
import { Money } from '@/components/ui/money';
import { Row } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { fecharDeslizavelAberto } from '@/components/ui/deslizavel';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonChart, SkeletonList, SkeletonRow } from '@/components/ui/skeleton';
import { useSubirAcimaDoToast, useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { Elevation, Motion, Radius, Space } from '@/design/tokens';
import {
  NO_ACCOUNT,
  useAccountBalances,
  useAccounts,
  useDeleteTransaction,
  useDesfazerBaixa,
  useMarkPaid,
  useRecentTransactions,
  useMonthRange,
  useTransactions,
  useCycleSeries,
  useCycleMonth,
  useTransactionsSummary,
  type Transaction,
  type TransactionKind,
  type TransactionSource,
} from '@/hooks/use-finance';
import { usarDica } from '@/hooks/use-dicas';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import { mesmoMes } from '@/lib/dates';
import { confirmDestructive } from '@/lib/item-actions';
import { rotuloDaCompra } from '@/lib/data-da-compra';
import { dueInline, estadoDaLinha, settleDone, settleLabel } from '@/lib/settle-labels';
import { useDebounced } from '@/hooks/use-debounced';
import { useTheme, useScheme } from '@/hooks/use-theme';
import { accountLabel, saldoDaConta } from '@/lib/accounts';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { tabletPaneWidths } from '@/design/adaptive-window';

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
  const fabBase = insets.bottom + Space.xxl;
  const subirFab = useSubirAcimaDoToast(fabBase);
  const { width, windowClass } = useAdaptiveWindow();
  // A barra de filtros precisa caber AO LADO do livro-caixa. No intervalo 840–950dp a janela
  // já é expanded, mas os dois painéis ainda não têm largura útil depois do respiro editorial.
  // Nesse caso a lista nativa completa continua sendo a composição correta.
  const wideWorkspace = windowClass === 'expanded' &&
    tabletPaneWidths(Math.min(width, 1200) - Space.lg * 2).twoPane;
  const params = useLocalSearchParams<{
    month?: string;
    kind?: string;
    category?: string;
    recurringId?: string;
    /** Id da conta/cartão, ou `none` para os lançamentos sem conta. */
    accountId?: string;
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
  const [category, setCategory] = useState<string | undefined>(params.category);
  const [accountId, setAccountId] = useState<string | undefined>(params.accountId);
  const [source, setSource] = useState<TransactionSource | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [puxando, setPuxando] = useState(false);
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
  const link = `${params.month ?? ''}|${params.kind ?? ''}|${params.category ?? ''}|${params.accountId ?? ''}`;
  const [linkAplicado, setLinkAplicado] = useState(link);
  if (link !== linkAplicado) {
    setLinkAplicado(link);
    if (params.month) setMesEscolhido(params.month);
    if (params.kind === 'expense' || params.kind === 'income' || params.kind === 'transfer') {
      setKind(params.kind);
    }
    if (params.category) setCategory(params.category);
    if (params.accountId) setAccountId(params.accountId);
  }

  // Abrir o extrato de uma conta é o que a dica das contas ensina (`conta-extrato`).
  useEffect(() => {
    if (accountId && accountId !== NO_ACCOUNT) usarDica('conta-extrato');
  }, [accountId]);

  const regua = useMonthRuler();
  const mesCorrente = useCycleMonth(regua.view);
  const month = mesEscolhido ?? mesCorrente;
  const setMonth = setMesEscolhido;
  const range = useMonthRange(month, regua.view);
  const list = useTransactions({
    /*
      ⚠️ **As MESMAS bordas do resumo, não `month`.** O hook recortava o mês civil por conta
      própria, então o botão `Mês | Ciclo` logo acima não mexia na lista: com fechamento no dia
      10 ela mostrava 01/10–31/10 embaixo de um card que falava de 11/09–10/10.
    */
    from: range.from,
    to: range.to,
    pronto: range.pronto,
    kind: kind === 'all' ? undefined : kind,
    category,
    recurringId: params.recurringId,
    accountId: accountId === undefined ? undefined : accountId === NO_ACCOUNT ? null : accountId,
    status: status === 'all' ? undefined : status,
    source,
    q: term,
  });
  const summary = useTransactionsSummary(range.from, range.to, range.pronto);
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
    return { entrou, saiu, entrouPrevisto, saiuPrevisto, linhas };
  }, [summary.data]);

  const accounts = useAccounts();
  const saldos = useAccountBalances();
  // O saldo respeita o "esconder valores" (`useBRL`), como na tela Contas.
  const brl = useBRL();
  // Um item basta para separar "nunca teve nada" de "este mês não teve nada".
  const anyEver = useRecentTransactions(1);
  const markPaid = useMarkPaid();
  const desfazer = useDesfazerBaixa();
  const desfazerBaixa = (id: string) =>
    desfazer.mutate({ id }, { onError: () => toast({ message: 'Não deu para desfazer. Tenta de novo.', tone: 'error' }) });
  const remove = useDeleteTransaction();

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
  const pronta = useTelaPronta(summary, serieCiclo, accounts, anyEver, list, regua.cycle, range);

  /** O ciclo corrente não veio: o mês exibido seria o palpite civil, com o nome errado. */
  const cicloFalhou = regua.cycle.isError && !regua.cycle.data;
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
      ...(range.pronto ? [summary.refetch(), list.refetch()] : []),
    ]);

  // `toSections` agrupa em varredura linear, então o dia que atravessa a fronteira de duas
  // páginas continua sendo uma seção só depois do `flat()`.
  const rows = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);
  const sections = useMemo(() => toSections(rows), [rows]);

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
  const listaRecortada = hasFilters || Boolean(params.recurringId);
  /*
    ⚠️ **`!anyEver.isError` junto.** Com a query falhando, `data` é undefined, `?? []` vira lista
    vazia e quem tem anos de histórico recebia "Nenhum lançamento ainda" com a dica de
    onboarding do WhatsApp — perdendo o "Nada em outubro / Ver setembro", que é o estado certo.
  */
  const neverHadAnything =
    (anyEver.data ?? []).length === 0 && !anyEver.isLoading && !anyEver.isError;

  // Estado vazio que oferece BOTÃO ("Ver fevereiro", "Limpar filtros") cai exatamente na faixa
  // do FAB, que é desenhado por cima e come metade do alvo — visto no simulador com
  // "Ver Fevereiro de 2025" cortado ao meio pelo "Lançar". Nesses dois estados o FAB sai: não há
  // lista para completar, e a oferta da tela é a do estado vazio. Ele fica no
  // `neverHadAnything`, cuja dica manda tocar justamente nele.
  /*
    ⚠️ **`isPending`, não `isLoading`.** A lista fica `enabled: false` até `useMonthRange`
    resolver a janela, e nesse intervalo `isLoading` (que é `isPending && isFetching`) é FALSO
    com zero linhas — ou seja, a tela anunciaria "Nada em outubro" antes de ter perguntado.
  */
  const vazioComAcao =
    sections.length === 0 && !list.isPending && !list.isError && !neverHadAnything;
  /** Não há o que resumir — inclui o mês sem movimento e o "nunca teve nada". */
  const listaVazia = sections.length === 0 && !list.isPending;

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
        onSuccess: () =>
          toast({
            message: `${tx.description}: ${settleDone(tx.kind)}.`,
            tone: 'success',
            action: { label: 'Desfazer', onPress: () => desfazerBaixa(tx.id) },
          }),
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

      <PeriodBar month={month} onChangeMonth={setMonth} ruler={regua} />

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
      {/* Aponta para a primeira linha: só com linhas, e só onde a lista vem logo abaixo. */}
      {sections.length > 0 && !wideWorkspace ? <Dica id="lista-arrasto" tela="lancamentos" bico="baixo" /> : null}
    </View>
  );

  /*
    ⚠️ **A falha do período vem ANTES de `list.isPending`.** Sem bordas a lista não liga, e uma
    consulta desligada fica `isPending` para sempre — o ramo de cima desenharia três linhas de
    esqueleto indefinidamente, mesmo com o portão da tela já aberto.
  */
  const empty = periodoFalhou ? (
    <ErrorCard onRetry={() => { void refazerPeriodo(); }} />
  ) : list.isPending ? (
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

  /*
    ⚠️ **Sem `View` em volta do `<Screen>`, e isso NÃO é estilo.** Esta é uma tela EMPURRADA
    (`scroll={false}`, sem `topBar`), e nesse caso `Screen` devolve um Fragment de propósito: o
    iOS procura o scroll da interação do large title andando pelos PRIMEIROS subviews a partir da
    raiz, e a busca é rasa. Com uma `View` no meio ele não acha o `SectionList`,
    `prefersLargeTitles` fica ligado e o título nunca colapsa — fica cravado enquanto o conteúdo
    rola por baixo. É a queixa "o título tá descendo junto com a tela", que custou 23 arquivos em
    11/09/2026, e `screen.tsx` documenta a armadilha na própria linha que devolve o Fragment.

    O FAB continua irmão da lista; o fundo vem do `contentStyle` que o `Screen` escreve no
    navegador, que é de onde ele sempre deveria ter vindo.
  */
  if (!pronta) {
    return (
      <Screen grouped>
        <SkeletonChart altura={96} />
        <SkeletonList linhas={4} />
      </Screen>
    );
  }

  const menu = (
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
              label: 'Regras',
              icon: 'line.3.horizontal.decrease',
              onPress: () => router.push('/finance/rules'),
            },
          ]}
    />
  );

  const ledgerList = (
    <SectionList<Transaction, DaySection>
          // Rolar fecha o card arrastado que estiver aberto (Deslizavel).
          onScrollBeginDrag={fecharDeslizavelAberto}
          sections={sections}
          keyExtractor={(tx) => tx.id}
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
            if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage();
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
             * em que cai, a linha acrescenta "compra de 14/09". A fatura continua no detalhe
             * ("Entra na fatura de …"). Conta a pagar fora do cartão mantém "vence …": ali o
             * vencimento É a data daquela conta.
             */
            const tituloDaLinha = tx.description || tx.merchant || tx.category || 'Sem descrição';
            const badges = [
              // "parcela 2" some quando o título já diz "(2/10)" — a mesma informação duas vezes.
              tx.installment_no && !/\(\d+\/\d+\)$/.test(tituloDaLinha) ? `parcela ${tx.installment_no}` : null,
              rotuloDaCompra(tx),
              emAberto && tx.invoice_id === null
                ? dueInline(tx.kind, tx.due_at ? formatDateBR(tx.due_at).slice(0, 5) : null).replace(/^previsto( · )?/, '')
                : null,
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
              // O nome da conta não parte ao meio ("Nubank / Cartão"): espaço inseparável nele.
              tx.account_id ? accountName.get(tx.account_id)?.replace(/ /g, '\u00A0') : null,
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
                            arrasto: 'direita' as const,
                            desfaz: true,
                            onPress: () => pay(tx),
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
                      /**
                       * ⚠️ **Em parcela, "Editar" abre a COMPRA, não a linha** — a mesma régua de
                       * `finance/[txId].tsx`. As duas telas respondiam coisas diferentes para a
                       * mesma palavra, e o valor da parcela é do contrato desde 15/09/2026.
                       */
                      label: 'Editar',
                      icon: 'pencil',
                      // Pendente, a direita é o "Paguei"; efetivado, é o Editar.
                      arrasto: tx.status === 'pending' ? undefined : ('direita' as const),
                      onPress: () =>
                        tx.installment_plan_id
                          ? router.push({
                              pathname: '/finance/installments',
                              params: { edit: tx.installment_plan_id },
                            })
                          : router.push({
                              pathname: '/finance/transaction-form',
                              params: { id: tx.id, month },
                            }),
                    },
                    { label: 'Apagar', icon: 'trash', destructive: true, arrasto: 'esquerda', onPress: () => confirmDelete(tx) },
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
                      icon={categoryIcon(tx.category, tx.kind)}
                      accessibilityLabel={`${tx.description || tx.merchant || tx.category || 'Lançamento'}, ${formatBRL(tx.amount_cents)}, ${tx.kind === 'income' ? 'receita' : tx.kind === 'expense' ? 'despesa' : 'transferência'}, ${dayTitle(tx.occurred_at)}${estado ? `, ${estado}` : ''}`}
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

  const fab = vazioComAcao ? null : (
    // Com um toast no ar o FAB sobe: o "Desfazer" do toast ficava debaixo dele (24/09/2026).
    <Animated.View style={[styles.fab, { bottom: fabBase }, subirFab]}>
      <Button
        label="Lançar"
        icon="plus"
        onPress={() => router.push({ pathname: '/finance/transaction-form', params: { month } })}
        style={{ boxShadow: Elevation[scheme].floating }}
      />
    </Animated.View>
  );

  /*
    A janela ampla separa apenas a apresentação: a mesma SectionList continua dona da
    virtualização, paginação, refresh e ações. O wrapper só dá ao FAB uma coluna de referência;
    em compacto/médio `ledger` é a SectionList literal para preservar o large title nativo.
  */
  const ledger = wideWorkspace ? (
    <View style={styles.ledgerPane}>
      {ledgerList}
      {fab}
    </View>
  ) : ledgerList;

  return (
    <Screen
      floatingAction={!wideWorkspace}
      scroll={false}
      grouped
      wide={wideWorkspace}
      search={wideWorkspace ? undefined : busca}>
      <Stack.Screen
        options={{ title: tituloDaConta ?? 'Lançamentos' }}
      />
      {menu}
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
      {!wideWorkspace ? fab : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
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

  filters: {
    gap: Space.sm,
  },
  // `flexWrap` porque os rótulos passaram a ser frases ("Ainda vai acontecer"): cabem numa
  // linha a 384dp e descem para a segunda com fonte grande, em vez de sair pela borda.
  statusChips: { flexDirection: 'row', gap: Space.sm, flexWrap: 'wrap' },
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
  saldoConta: { gap: Space.xs },
  saldoLinha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: Space.sm },
});
