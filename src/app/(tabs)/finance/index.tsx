import { router } from 'expo-router';
import { Fragment, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { ErrorCard } from '@/components/error-card';
import { FinanceTabletCanvas } from '@/components/finance/finance-tablet-canvas';
import { BudgetRings } from '@/components/finance/budget-rings';
import { CardStack, type StackedCard } from '@/components/finance/card-stack';
import { monthLabel, monthTitle, shiftMonth } from '@/components/finance/month-picker';
import { useMonthRuler } from '@/components/finance/month-ruler';
import { PeriodBar } from '@/components/finance/period-bar';
import { SpendingDonut, type CategoriaDoMes } from '@/components/finance/spending-donut';
import { TrendCard } from '@/components/finance/trend-card';
import { ThemedText } from '@/components/themed-text';
import { AppHeader } from '@/components/ui/app-header';
import { BlockHeader } from '@/components/ui/block-header';
import { useBRL } from '@/components/ui/conceal';
import { CountUpMoney } from '@/components/ui/count-up-money';
import { EmptyState } from '@/components/ui/empty-state';
import { ExtendedFab } from '@/components/ui/extended-fab';
import { HeroPanel } from '@/components/ui/hero-panel';
import { ItemLink } from '@/components/ui/item-link';
import { LedgerRow } from '@/components/ui/ledger-row';
import { Money } from '@/components/ui/money';
import { RingGauge } from '@/components/ui/ring-gauge';
import { Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Dica } from '@/components/ui/dica';
import { ScrubChart } from '@/components/ui/scrub-chart';
import { Skeleton, SkeletonCards, SkeletonChart, SkeletonHero, SkeletonList, SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar, Sparkline } from '@/components/ui/sparkline';
import { Tile, TileGrid, TileRow } from '@/components/ui/tile';
import { useToast } from '@/components/ui/toast';
import { categoryIcon } from '@/design/category-icons';
import { chartWidthForPane } from '@/design/adaptive-window';
import { Radius, Space } from '@/design/tokens';
import { useAgentActivity } from '@/hooks/use-agent-activity';
import { usarDica } from '@/hooks/use-dicas';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import {
  useAccounts,
  useBudgetsStatus,
  useCardSummary,
  useCashFlowForecast,
  useCycleMonth,
  useCycleSeries,
  useDebts,
  useDeleteTransaction,
  useMonthRange,
  useMonthlyCashflow,
  useRecentTransactions,
  useTransactionsSummary,
  type Transaction,
} from '@/hooks/use-finance';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { orcamentosApertados } from '@/lib/budget-tight';
import { cartaoDaPilha } from '@/lib/card-status';
import { describeCycle, describeRealizado } from '@/lib/cycle-label';
import { isoToBR, mesmoMes } from '@/lib/dates';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';

/**
 * Financeiro — "como o meu ciclo fecha", na estrutura de conversa organizada (spec 2026-09-17).
 *
 * | # | bloco | por quê |
 * |---|---|---|
 * | 1 | período | escopa a tela inteira |
 * | 2 | herói + curva arrastável | a pergunta que trouxe a pessoa |
 * | 3 | Entra \| Sai | a mesma série do herói, pelos dois lados |
 * | 4 | Cartões | a fatura é a maior saída isolada (pilha, voo e Carteira INTOCADOS) |
 * | 5 | mosaico | as portas do domínio |
 * | 6 | passando do limite | alerta, só quando dói |
 * | 7 | últimos lançamentos | a checagem diária, com a fala que os criou |
 * | 8 | para onde foi | análise, por data da compra |
 * | 9 | tendência | ao longo do tempo |
 *
 * Nenhum destino saiu (Regra 0 da spec): Projeção virou ladrilho, "Ver tudo" virou ladrilho,
 * "O que entra/sai" viraram os ladrilhos Entra/Sai.
 */

const SOURCE_LABEL: Record<Transaction['source'], string> = {
  whatsapp: 'via WhatsApp',
  app: '',
  import: 'importado',
  recurring: 'recorrente',
};

/**
 * Dias até o fim do mês civil (mínimo 1) — só o PALPITE enquanto `cycle_now` não responde.
 */
function daysToMonthEnd(): number {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return Math.max(1, Math.ceil((last.getTime() - now.getTime()) / 86_400_000));
}

export default function FinanceScreen() {
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const brl = useBRL();
  const toast = useToast();
  const regua = useMonthRuler();
  const cycle = regua.cycle;
  /**
   * `null` = "siga o ciclo". O mês corrente é o ciclo que contém hoje, não o mês civil (com
   * fechamento no dia 10, o dia 15/09 já é o ciclo "outubro").
   */
  const [mesEscolhido, setMonth] = useState<string | null>(null);
  const mesCorrente = useCycleMonth(regua.view);
  const month = mesEscolhido ?? mesCorrente;

  const range = useMonthRange(month, regua.view);
  const previousMonth = useMemo(() => shiftMonth(month, -1), [month]);
  // Na MESMA régua do mês exibido, senão o "vs mês anterior" compara dois tipos de período.
  const previousRange = useMonthRange(previousMonth, regua.view);
  const isCurrent = month === mesCorrente;
  const [heroPaneWidth, setHeroPaneWidth] = useState(0);
  const daysLeft = cycle.data?.diasAteOFim ?? daysToMonthEnd();

  const forecast = useCashFlowForecast(daysLeft);
  const summary = useTransactionsSummary(range.from, range.to, range.pronto);
  const previous = useTransactionsSummary(previousRange.from, previousRange.to, previousRange.pronto);
  const budgets = useBudgetsStatus(month, regua.view);
  const accounts = useAccounts();
  const debts = useDebts();
  const cards = useCardSummary();
  const [janelaCashflow, setJanelaCashflow] = useState('6');
  const cashflow = useMonthlyCashflow(Number(janelaCashflow));
  const recent = useRecentTransactions(5);
  const atividade = useAgentActivity(6);
  const remove = useDeleteTransaction();

  /** Memoizado: um array novo a cada render remontava a carteira inteira. */
  const cartoesDaCarteira = useMemo<StackedCard[]>(() => (cards.data ?? []).map(cartaoDaPilha), [cards.data]);

  /*
    ⚠️ O herói lê a linha do tempo (`cycle_series`), a fonte única que o detalhe do ciclo soma
    linha a linha — e `describeCycle` decide como o ciclo é DESCRITO.
  */
  const serie = useCycleSeries(shiftMonth(month, -1), month, regua.view);
  const ciclo = serie.data?.find((c) => mesmoMes(c.mes, month)) ?? null;
  const cicloAnterior = serie.data?.find((c) => !mesmoMes(c.mes, month)) ?? null;
  const descricao = ciclo
    ? describeCycle(ciclo, monthTitle(month).replace(/ de \d{4}$/, '').toLowerCase())
    : null;
  const cicloRuim = descricao?.ruim ?? false;
  const sub = describeRealizado(ciclo, brl);
  const variacaoSaida =
    ciclo && cicloAnterior && Number(cicloAnterior.saiu) > 0
      ? Math.round(((Number(ciclo.saiu) - Number(cicloAnterior.saiu)) / Number(cicloAnterior.saiu)) * 100)
      : null;

  /* `useMemo` não é micro-otimização: o `Sparkline` memoiza o desenho pela identidade da série. */
  const series = useMemo(() => (forecast.data ?? []).map((d) => Number(d.balance_cents)), [forecast.data]);
  const rotulos = useMemo(() => (forecast.data ?? []).map((d) => isoToBR(d.day).slice(0, 5)), [forecast.data]);
  const chartWidth = chartWidthForPane(heroPaneWidth, Space.gutter);
  const measureHeroPane = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    setHeroPaneWidth((previous) => previous === measured ? previous : measured);
  };
  const fimDoCiclo = ciclo?.fim ?? cycle.data?.ate ?? null;

  /** A citação de cada lançamento que veio de uma fala (mesma chave da Hoje: sem consulta a mais). */
  const citacoes = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const l of atividade.data ?? []) {
      const texto = l.origin_text?.trim();
      if (l.result_id && texto && l.record?.kind === 'transaction') mapa.set(l.result_id, texto);
    }
    return mapa;
  }, [atividade.data]);

  const categories = useMemo(() => {
    const rows = (summary.data ?? []).filter((r) => r.kind === 'expense');
    return [...rows].sort((a, b) => Number(b.total_cents) - Number(a.total_cents));
  }, [summary.data]);
  const previousByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of previous.data ?? []) if (r.kind === 'expense') map.set(r.category, Number(r.total_cents));
    return map;
  }, [previous.data]);
  /*
    Numerador e denominador da MESMA coluna (`finance.md`): o percentual divide pela soma das
    linhas mostradas — foi o divisor "realizado" que escreveu "0% do mês" em todas.
  */
  const itensDaRosca = useMemo<CategoriaDoMes[]>(
    () =>
      categories.map((row) => {
        const total = Number(row.total_cents);
        const before = previousByCategory.get(row.category) ?? 0;
        const delta = previous.isSuccess && before > 0 ? Math.round(((total - before) / before) * 100) : null;
        const comparacao = !previous.isSuccess
          ? null
          : delta === null
            ? `não teve em ${monthLabel(previousMonth)}`
            : delta === 0
              ? `igual a ${monthLabel(previousMonth)}`
              : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}% vs ${monthLabel(previousMonth)}`;
        return {
          categoria: row.category,
          total,
          comparacao,
          tom: delta !== null && delta >= 10 ? 'warning' : delta !== null && delta <= -10 ? 'success' : 'textSecondary',
        };
      }),
    [categories, previousByCategory, previous.isSuccess, previousMonth]
  );

  const apertados = useMemo(() => orcamentosApertados(budgets.data ?? []), [budgets.data]);
  const maisApertado = apertados.reduce<number>((m, o) => Math.max(m, o.fracaoGasta), 0);

  // O corte do futuro com a data LOCAL: às 22h o `current_date` do servidor já virou o dia.
  const mesAtual = localISODate().slice(0, 7);
  const meses = (cashflow.data ?? []).filter((m) => m.month.slice(0, 7) <= mesAtual);

  /*
    O PORTÃO DA TELA — as bordas entram como CONSULTA (`range`), e os DOIS ranges entram: sem o
    anterior, o "vs setembro" chegaria depois da primeira pintura. Ver `tela-pronta.ts`.
  */
  const pronta = useTelaPronta(
    forecast, summary, previous, budgets, accounts, debts, cards, cashflow, recent, serie,
    cycle, range, previousRange, atividade,
  );

  const cicloFalhou = cycle.isError && !cycle.data;
  const bordasChegando = !range.pronto && !range.isError;
  const heroLoading = bordasChegando || summary.isLoading || (isCurrent && forecast.isLoading);
  const heroError = cicloFalhou || range.isError || summary.isError || (isCurrent && forecast.isError);
  const isEmpty =
    summary.isSuccess && recent.isSuccess && (summary.data ?? []).length === 0 && (recent.data ?? []).length === 0;

  /** `refetch` ignora `enabled`: o resumo só é refeito com as bordas definitivas. */
  const refazerPeriodo = () =>
    Promise.all([
      ...(cicloFalhou ? [cycle.refetch()] : []),
      ...(range.isError ? [range.refetch()] : []),
      ...(previousRange.isError ? [previousRange.refetch()] : []),
      ...(range.pronto ? [summary.refetch()] : []),
      ...(previousRange.pronto ? [previous.refetch()] : []),
    ]);

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

  const abrirFatura = (card: StackedCard) =>
    card.invoice_id
      ? router.push({ pathname: '/finance/invoice/[id]', params: { id: card.invoice_id } })
      : router.push('/finance/cards');

  const openTransactions = (params: Record<string, string>) =>
    router.push({ pathname: '/finance/transactions', params: { month, ...params } });
  const abrirCiclo = (tipo: 'tudo' | 'entra' | 'sai') =>
    router.push({ pathname: '/finance/cycle', params: { month, view: regua.view, tipo } });

  const lancar = () =>
    showItemActions('Lançar', [
      { label: 'Gasto ou receita', onPress: () => router.push({ pathname: '/finance/transaction-form', params: { month } }) },
      { label: 'Recorrente', onPress: () => router.push({ pathname: '/finance/recurring', params: { create: '1' } }) },
      { label: 'Financiamento', onPress: () => router.push({ pathname: '/finance/debts', params: { create: 'financing' } }) },
    ]);

  if (!pronta) {
    return (
      <Screen wide={tablet} grouped topBar={<AppHeader title="Financeiro" />}>
        <Skeleton width="55%" height={26} />
        <SkeletonHero />
        <View style={styles.linhaEsqueleto}>
          <Skeleton width="48%" height={112} radius={Radius.md} />
          <Skeleton width="48%" height={112} radius={Radius.md} />
        </View>
        <SkeletonCards />
        <SkeletonList linhas={3} />
        <SkeletonChart />
      </Screen>
    );
  }

  const entrou = Number(ciclo?.entrou ?? 0);
  const saiu = Number(ciclo?.saiu ?? 0);
  const entrouRealizado = Number(ciclo?.entrou_realizado ?? 0);
  const saiuRealizado = Number(ciclo?.saiu_realizado ?? 0);
  const debtsTotal = (debts.data ?? []).reduce((soma, d) => soma + Number(d.remaining_cents), 0);

  /** A curva do herói — e a dica dela, que só existe com ela na tela. */
  const temCurva = isCurrent && series.length > 1 && chartWidth > 0;

  const cycleBlock = (
    <>
      <PeriodBar month={month} onChangeMonth={setMonth} ruler={regua} variant="bare" />
      <View onLayout={measureHeroPane} style={styles.comDica}>
        {heroError ? (
          <ErrorCard onRetry={() => {
            void refazerPeriodo();
            void forecast.refetch();
          }} />
        ) : (
          <HeroPanel
            surface="live"
            label={heroLoading ? 'Atualizando período' : descricao?.label ?? 'Saldo projetado'}
            value={heroLoading
              ? <Skeleton width="70%" height={46} tone="hero" />
              : <CountUpMoney cents={descricao?.cents ?? 0} variant="heroMoney" tone={cicloRuim ? 'onHeroDanger' : 'onHero'} />}
            footer={!heroLoading && descricao?.rodape ? (
              <View style={styles.heroRodape}>
                <ThemedText type="footnote" themeColor="onHeroMuted">{descricao.rodape.label}</ThemedText>
                <Money cents={descricao.rodape.cents} variant="footnote" tone="onHero" concealable />
              </View>
            ) : undefined}
            secondary={!heroLoading && variacaoSaida !== null ? {
              icon: variacaoSaida > 0 ? 'arrow.up.right' : 'arrow.down.right',
              negative: variacaoSaida > 0,
              text: `${variacaoSaida > 0 ? '+' : ''}${variacaoSaida}% de gastos vs ${monthLabel(previousMonth)}`,
            } : undefined}
            chart={heroLoading ? (
              <Skeleton height={88} radius={Radius.sm} tone="hero" />
            ) : temCurva ? (
              <ScrubChart
                values={series}
                labels={rotulos}
                width={chartWidth}
                formatValue={brl}
                legenda={
                  <>
                    <ThemedText type="caption" themeColor="onHeroMuted">Hoje</ThemedText>
                    <ThemedText type="caption" themeColor={cicloRuim ? 'onHeroDanger' : 'onHeroSuccess'}>
                      {`${brl(descricao?.cents ?? 0)} projetado`}
                    </ThemedText>
                    <ThemedText type="caption" themeColor="onHeroMuted">
                      {fimDoCiclo ? isoToBR(fimDoCiclo).slice(0, 5) : ''}
                    </ThemedText>
                  </>
                }
              />
            ) : undefined}
            concealable
            onPress={heroLoading ? undefined : () => {
              usarDica('fin-painel');
              showItemActions('Mais opções', [
              { label: 'Ver o que fecha o ciclo', icon: 'list.bullet', onPress: () => abrirCiclo('tudo') },
              { label: 'O que entra', icon: 'arrow.down.circle', onPress: () => abrirCiclo('entra') },
              { label: 'O que sai', icon: 'arrow.up.circle', onPress: () => abrirCiclo('sai') },
              { label: 'Projeção', icon: 'chart.line.uptrend.xyaxis', onPress: () => router.push('/finance/forecast') },
              { label: 'Patrimônio', icon: 'building.columns', onPress: () => router.push('/finance/net-worth') },
              { label: 'Metas', icon: 'target', onPress: () => router.push('/finance/goals') },
              ]);
            }}
          />
        )}
        {/* Só com a curva na tela: a dica ensina o gesto DELA. */}
        {!heroError && !heroLoading && temCurva ? (
          <Dica id="fin-grafico" tela="financeiro" />
        ) : null}
        {!heroError && !heroLoading ? <Dica id="fin-painel" tela="financeiro" /> : null}
      </View>
    </>
  );

  const actionsBlock = (
    <>
      <TileRow>
        <Tile
          valorGrande
          icon="arrow.down.left"
          label="Entra"
          value={ciclo ? <Money cents={entrou} variant="title2" tone="success" /> : undefined}
          caption={sub.entra || undefined}
          footer={entrou > 0 ? <ProgressBar value={entrouRealizado} max={entrou} tone="strong" /> : undefined}
          onPress={() => abrirCiclo('entra')}
        />
        <Tile
          valorGrande
          icon="arrow.up.right"
          label="Sai"
          value={ciclo ? <Money cents={saiu} variant="title2" /> : undefined}
          caption={sub.sai || undefined}
          footer={saiu > 0 ? <ProgressBar value={saiuRealizado} max={saiu} tone="strong" /> : undefined}
          onPress={() => abrirCiclo('sai')}
        />
      </TileRow>
      {cards.isError ? (
        <ErrorCard onRetry={cards.refetch} />
      ) : (cards.data ?? []).length > 0 ? (
        <View style={styles.bloco}>
          <BlockHeader
            title="Cartões"
            count={cards.data!.length}
            action={{ label: 'Ver todos', accessibilityLabel: 'Ver todos os cartões', onPress: () => router.push('/finance/cards') }}
          />
          <CardStack cards={cartoesDaCarteira} onOpen={abrirFatura} />
          <Dica id="fin-pilha" tela="financeiro" />
        </View>
      ) : null}
      <View style={styles.bloco}>
        <BlockHeader title="Atalhos" />
        <TileGrid>
          <Tile
            layout="half"
            icon="list.bullet"
            label="Lançamentos"
            value={<ThemedText type="headline">{monthTitle(month).replace(/ de \d{4}$/, '')}</ThemedText>}
            onPress={() => router.push({ pathname: '/finance/transactions', params: { month, view: regua.view } })}
          />
          <Tile
            layout="half"
            icon="chart.line.uptrend.xyaxis"
            label="Projeção"
            value={<ThemedText type="headline">Mês a mês</ThemedText>}
            visual={isCurrent && series.length > 1 ? <Sparkline values={series} width={64} height={28} /> : undefined}
            onPress={() => router.push('/finance/forecast')}
          />
          <Tile
            layout="half"
            icon="wallet.pass"
            label="Contas"
            value={accounts.data ? (
              <ThemedText type="headline">
                {`${accounts.data.length} ${accounts.data.length === 1 ? 'conta' : 'contas'}`}
              </ThemedText>
            ) : undefined}
            onPress={() => router.push('/finance/accounts')}
          />
          <Tile
            layout="half"
            icon="chart.pie"
            label="Orçamentos"
            value={budgets.data ? (
              <ThemedText type="headline">
                {`${budgets.data.length} ${budgets.data.length === 1 ? 'limite' : 'limites'}`}
              </ThemedText>
            ) : undefined}
            visual={apertados.length > 0 ? (
              <RingGauge
                value={maisApertado}
                size={28}
                stroke={4}
                tone={apertados.some((o) => o.estourou) ? 'danger' : 'warning'}
                accessibilityLabel={`Orçamento mais apertado em ${Math.round(maisApertado * 100)}%`}
              />
            ) : undefined}
            onPress={() => router.push('/finance/budgets')}
          />
          {debts.data?.length ? (
            <Tile
              layout="half"
              icon="banknote"
              label="Dívidas"
              value={<Money cents={debtsTotal} variant="headline" />}
              onPress={() => router.push('/finance/debts')}
            />
          ) : null}
          <Tile
            layout={debts.data?.length ? 'half' : 'wide'}
            icon="ellipsis.circle"
            label="Gerenciar"
            accessibilityLabel="Ver tudo que dá para gerenciar"
            onPress={() => router.push('/finance/manage')}
          />
        </TileGrid>
      </View>
      {budgets.isError ? (
        <ErrorCard onRetry={budgets.refetch} />
      ) : apertados.length > 0 ? (
        <View style={styles.bloco}>
          <BlockHeader title="Passando do limite" count={apertados.length} />
          <BudgetRings itens={apertados} onPress={() => router.push('/finance/budgets')} />
        </View>
      ) : null}
    </>
  );

  const ledgerBlock = (
    <>
      {recent.isError ? (
        <ErrorCard onRetry={recent.refetch} />
      ) : recent.isLoading ? (
        <Section>
          <SkeletonRow />
          <SkeletonRow />
        </Section>
      ) : (recent.data ?? []).length > 0 ? (
        <View style={styles.bloco}>
          {/* Lista CHAPADA, do mais recente para o mais antigo pela data do lançamento (`occurred_at`,
              `created_at` desempata) — são só cinco, cabeçalho de dia seria mais ruído que ajuda. */}
          <BlockHeader title="Últimos lançamentos" action={{ label: 'Ver todos', onPress: () => openTransactions({}) }} />
          <Section>
            {(recent.data ?? []).map((tx) => {
              const titulo = tx.description || tx.merchant || tx.category || 'Sem descrição';
              const destino = { pathname: '/finance/[txId]' as const, params: { txId: tx.id, month: tx.occurred_at.slice(0, 7) } };
              return (
                <ItemLink
                  key={tx.id}
                  href={destino}
                  title={titulo}
                  actions={[
                    { label: 'Ver detalhe', icon: 'doc.text.magnifyingglass', arrasto: 'fora', onPress: () => router.push(destino) },
                    {
                      label: 'Editar',
                      icon: 'pencil',
                      arrasto: 'direita',
                      onPress: () => router.push({ pathname: '/finance/transaction-form', params: { id: tx.id, month } }),
                    },
                    { label: 'Apagar', icon: 'trash', destructive: true, arrasto: 'esquerda', onPress: () => confirmDelete(tx) },
                  ]}>
                  {({ onLongPress }) => (
                    <LedgerRow
                      title={titulo}
                      subtitle={[tx.category, SOURCE_LABEL[tx.source]].filter(Boolean).join(' · ') || undefined}
                      icon={categoryIcon(tx.category, tx.kind)}
                      cents={tx.kind === 'expense' ? -tx.amount_cents : tx.amount_cents}
                      signed={tx.kind !== 'transfer'}
                      tone={tx.kind === 'income' ? 'success' : 'text'}
                      date={formatDateBR(tx.occurred_at)}
                      quote={citacoes.get(tx.id) ?? null}
                      onLongPress={onLongPress}
                      accessibilityLabel={`${titulo}, ${formatBRL(tx.amount_cents)}, ${tx.kind === 'income' ? 'receita' : tx.kind === 'expense' ? 'despesa' : 'transferência'}`}
                    />
                  )}
                </ItemLink>
              );
            })}
          </Section>
        </View>
      ) : null}
    </>
  );

  const breakdownBlock = (
    <>
      {/* Por DATA DA COMPRA (o herói é por data do pagamento): a pílula diz a lente. */}
      {summary.isError ? null : itensDaRosca.length > 0 ? (
        <View style={styles.bloco}>
          <BlockHeader title="Para onde foi" tag="por data da compra" />
          <SpendingDonut
            itens={itensDaRosca}
            onOpenCategory={(category) => openTransactions({ category })}
            onOpenAll={() => openTransactions({ kind: 'expense' })}
          />
        </View>
      ) : null}

      {cashflow.isError ? (
        <ErrorCard onRetry={cashflow.refetch} />
      ) : cashflow.isLoading || meses.length > 1 ? (
        <View style={styles.bloco}>
          <BlockHeader title="Tendência" />
          <TrendCard meses={meses} janela={janelaCashflow} onJanela={setJanelaCashflow} loading={cashflow.isLoading} />
        </View>
      ) : null}

      {isEmpty ? (
        <EmptyState
          title="Ainda não tem movimento"
          hint={'Manda “gastei 45 no mercado” no WhatsApp —\nou toca no + para lançar aqui'}
        />
      ) : null}
    </>
  );

  return (
    <Screen
      floatingAction
      stagger
      wide={tablet}
      grouped
      topBar={<AppHeader title="Financeiro" />}
      overlay={<ExtendedFab label="Lançar" icon="plus" onPress={lancar} />}
      onRefresh={() =>
        Promise.all([
          refazerPeriodo(),
          forecast.refetch(),
          budgets.refetch(),
          accounts.refetch(),
          cards.refetch(),
          recent.refetch(),
          cashflow.refetch(),
          atividade.refetch(),
        ])
      }>
      {tablet ? (
        <FinanceTabletCanvas
          cycle={cycleBlock}
          actions={actionsBlock}
          ledger={ledgerBlock}
          breakdown={breakdownBlock}
        />
      ) : (
        [
          <Fragment key="cycle">{cycleBlock}</Fragment>,
          <Fragment key="actions">{actionsBlock}</Fragment>,
          <Fragment key="ledger">{ledgerBlock}</Fragment>,
          <Fragment key="breakdown">{breakdownBlock}</Fragment>,
        ]
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bloco: { gap: Space.md },
  /** A dica encosta no que ela explica — mais perto que o `gap` entre blocos. */
  comDica: { gap: Space.sm },
  heroRodape: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Space.sm,
  },
  linhaEsqueleto: { flexDirection: 'row', justifyContent: 'space-between' },
});
