import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { SymbolViewProps } from 'expo-symbols';

import { ErrorCard } from '@/components/error-card';
import {
  MonthPicker,
  currentMonth,
  monthLabel,
  monthShort,
  monthTitle,
  shiftMonth,
} from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { AppHeader } from '@/components/ui/app-header';
import { ItemLink } from '@/components/ui/item-link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { SectionHead } from '@/components/ui/section-head';
import { Segmented } from '@/components/ui/segmented';
import { HeroPanel } from '@/components/ui/hero-panel';
import { Screen } from '@/components/ui/screen';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar, Sparkline } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Elevation, Motion, Radius, Space, tabular } from '@/design/tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  useAccounts,
  useBudgetsStatus,
  useCardSummary,
  useCashFlowForecast,
  useDeleteTransaction,
  useMonthlyCashflow,
  useRecentTransactions,
  useTransactionsSummary,
  type Transaction,
} from '@/hooks/use-finance';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import { monthBounds } from '@/lib/dates';
import { confirmDestructive } from '@/lib/item-actions';
import { useTheme } from '@/hooks/use-theme';

/**
 * Financeiro — responde "como está o meu mês?" e, no fundo, "posso gastar?".
 *
 * O topo é **projeção**, não saldo bruto: saldo bruto mente para quem tem fatura fechando.
 * Os 13 links com emoji que terminavam a tela viraram quatro atalhos no topo + `/finance/manage`.
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

/**
 * Tile da faixa de atalhos. Vive aqui porque só esta tela usa (regra de `frontend.md`).
 *
 * Press-in com `scale` em worklet, como o `Button` — é um alvo quadrado com rótulo, não uma linha
 * de lista, então o feedback certo é escala e não highlight de fundo.
 */
interface ShortcutProps {
  title: string;
  count?: string;
  icon: SymbolViewProps['name'];
  href: Href;
}

function Shortcut({ title, count, icon, href }: ShortcutProps) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <Animated.View style={[styles.shortcut, animated]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}${count ? `, ${count}` : ''}`}
        style={[
          styles.shortcutPress,
          {
            backgroundColor: theme.surface,
            borderColor: theme.separator,
          },
        ]}
        onPressIn={() => scale.set(withTiming(Motion.pressScale, { duration: Motion.duration.fast }))}
        onPressOut={() => scale.set(withTiming(1, { duration: Motion.duration.fast }))}
        onPress={() => {
          Haptics.selectionAsync();
          router.push(href);
        }}>
        <View style={styles.shortcutTop}>
          <View style={[styles.shortcutIcon, { backgroundColor: theme.accentSoft }]}>
            <Icon name={icon} size="md" color="tint" />
          </View>
          <Icon name="chevron.right" size="sm" color="textSecondary" />
        </View>
        <View style={styles.shortcutBottom}>
          <ThemedText type="headline" numberOfLines={1}>
            {title}
          </ThemedText>
          {count ? (
            /* Mono: contagem é DADO, e o segundo tipo do sistema é o que carimba dado. */
            <ThemedText type="code" themeColor="textSecondary" style={tabular}>
              {count}
            </ThemedText>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Janela da tendência. NÃO segue o `MonthPicker`: `monthly_cashflow` ancora no mês corrente e
 * anda para trás, então o rótulo diz "últimos N meses" em vez de fingir acompanhar o seletor.
 */
const JANELAS_CASHFLOW = [
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
];

const ALTURA_BARRA = 72;

/**
 * Barra da tendência mensal.
 *
 * Duas por mês (entrou e saiu) porque a pergunta é comparativa: a resposta é qual das duas é mais
 * alta. Por isso NÃO leva `success`/`danger` — cor semântica aqui seria decoração, e é a última
 * alavanca de cor que o app tem. O par é o mesmo de `invoices.tsx`: `tint` cheio contra
 * `backgroundElement`, mais a legenda em PALAVRA, que é o que funciona sem enxergar cor.
 */
function CashBar({ ratio, index, forte }: { ratio: number; index: number; forte: boolean }) {
  const theme = useTheme();
  const grow = useSharedValue(0);

  useEffect(() => {
    grow.set(withDelay(index * Motion.stagger.step, withSpring(ratio, Motion.spring.settle)));
  }, [grow, ratio, index]);

  const animado = useAnimatedStyle(() => ({
    // Piso de `Space.xs` só para valor que EXISTE — mês sem receita tem que desenhar nada.
    // Com o piso aplicado ao zero, todo mês sem entrada ganhava um traço, e um traço lê como
    // "entrou um pouquinho": é o mesmo "previsto R$ 0,00" que o painel já não escreve.
    height: ratio <= 0 ? 0 : Math.max(Space.xs, grow.get() * ALTURA_BARRA),
  }));

  return (
    <Animated.View
      style={[
        styles.cashBar,
        animado,
        // UMA cor, duas intensidades — a mesma solução do gráfico de faturas. Duas matizes aqui
        // gastariam `success`/`danger` como enfeite, e cor semântica é a última alavanca do app.
        { backgroundColor: theme.tint, opacity: forte ? 1 : 0.35 },
      ]}
    />
  );
}

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
  const accounts = useAccounts();
  const cards = useCardSummary();
  const [janelaCashflow, setJanelaCashflow] = useState('6');
  const cashflow = useMonthlyCashflow(Number(janelaCashflow));
  const recent = useRecentTransactions(5);
  const remove = useDeleteTransaction();

  const totalOf = (rows: typeof summary.data, kind: 'expense' | 'income') =>
    (rows ?? []).filter((r) => r.kind === kind).reduce((s, r) => s + Number(r.total_cents), 0);

  const income = totalOf(summary.data, 'income');
  const expense = totalOf(summary.data, 'expense');
  const previousExpense = totalOf(previous.data, 'expense');
  const diffExpense =
    previous.isSuccess && previousExpense > 0
      ? Math.round(((expense - previousExpense) / previousExpense) * 100)
      : null;
  const upcomingOut = (forecast.data ?? []).reduce((s, d) => s + Number(d.out_cents), 0);
  const projected = forecast.data?.at(-1)?.balance_cents ?? 0;
  const leftover = isCurrent ? Number(projected) : income - expense;
  const series = (forecast.data ?? []).map((d) => Number(d.balance_cents));
  /** Amplitude relativa da série — abaixo de 1% a linha é horizontal e não informa nada. */
  const varia =
    series.length > 1 &&
    (Math.max(...series) - Math.min(...series)) / Math.max(...series.map(Math.abs), 1) > 0.01;

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

  // O corte do futuro é feito DUAS vezes de propósito. A `0048` fecha a janela no banco, mas o
  // Postgres roda em UTC: às 22h de Brasília o `current_date` do servidor já virou o dia seguinte,
  // e no fim do mês isso deixa passar um balde do mês QUE VEM — com barra e tudo, num gráfico
  // cujo título é sobre o passado. Mesma defesa que `invoices.tsx` usa, pelo mesmo motivo, com a
  // data LOCAL do usuário.
  const mesAtual = localISODate().slice(0, 7);
  const meses = (cashflow.data ?? []).filter((m) => m.month.slice(0, 7) <= mesAtual);
  // A escala é COMUM às duas barras: escalas separadas fariam "entrou" e "saiu" parecerem iguais
  // num mês em que um é o dobro do outro — que é exatamente a leitura que o bloco existe para dar.
  const tetoCashflow = Math.max(
    ...meses.map((m) => Math.max(Number(m.income_cents), Number(m.expense_cents))),
    1
  );

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
        topBar={<AppHeader />}
        onRefresh={() => {
          forecast.refetch();
          summary.refetch();
          previous.refetch();
          budgets.refetch();
          accounts.refetch();
          cards.refetch();
          recent.refetch();
        }}
        refreshing={summary.isRefetching}>
        {/*
          O painel deixou de sangrar até as bordas e virou CARD FLUTUANTE (design Stitch,
          03/09/2026). Com o `AppHeader` no topo, a faixa de tinta colada embaixo dele empilhava
          duas superfícies escuras sem costura entre elas; o card resolve por contorno e respiro,
          que é como o desenho faz.
        */}
        {/*
          A fileira que ESCOPA a tela: o mês à esquerda, o estado à direita. Ficava dentro do
          painel, e ali um controle no topo de um card lia como parte do número — além de
          empurrar o rótulo para baixo e desalinhar o painel do resto das telas.
        */}
        <View style={styles.escopo}>
          <MonthPicker month={month} onChange={setMonth} />
        </View>

        {heroLoading ? (
          <View style={styles.heroSkeleton}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="70%" height={46} />
          </View>
        ) : heroError ? (
          <ErrorCard
            onRetry={() => {
              summary.refetch();
              forecast.refetch();
            }}
          />
        ) : (
          <HeroPanel
            label={isCurrent ? 'Sobra até o fim do mês' : `Sobrou em ${monthTitle(month)}`}
            value={
              <Money
                cents={leftover}
                variant="heroMoney"
                tone={leftover < 0 ? 'danger' : 'onHero'}
                concealable
              />
            }
            secondary={[
              `entrou ${formatBRL(income)}`,
              `saiu ${formatBRL(expense)}`,
              // "previsto R$ 0,00" não é informação, é um campo vazio ocupando a linha —
              // mesmo princípio do bloco sem dado que não aparece.
              isCurrent && upcomingOut > 0 ? `previsto ${formatBRL(upcomingOut)}` : null,
            ]
              .filter(Boolean)
              .join('  ·  ')}
            chart={
              // Mesmo critério da Hoje: série que não varia desenha uma reta, e reta no meio
              // do painel lê como divisor, não como gráfico.
              isCurrent && series.length > 2 && varia ? (
                <Sparkline values={series} width={width - Space.lg * 2 - Space.gutter * 2} showZero />
              ) : undefined
            }
            trend={
              diffExpense !== null
                ? {
                    value: `${diffExpense > 0 ? '+' : ''}${diffExpense}% gastos`,
                    positive: diffExpense <= 0,
                    label: `vs ${monthLabel(previousMonth)}`,
                  }
                : undefined
            }
            concealable
            onPress={() => router.push('/finance/forecast')}
          />
        )}

        {/* Bloco 2 — atalhos. Fica sempre visível: sem conta cadastrada não existe dado a mostrar. */}
        <View style={styles.block}>
          <SectionHead
            title="Gerenciar"
            action={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Ver tudo que dá para gerenciar"
                hitSlop={12}
                onPress={() => router.push('/finance/manage')}>
                <ThemedText type="small" themeColor="tint">
                  Ver tudo
                </ThemedText>
              </Pressable>
            }
          />
          <View style={styles.shortcuts}>
            <Shortcut
              title="Lançamentos"
              icon="list.bullet"
              href="/finance/transactions"
              count={summary.data ? `${(summary.data ?? []).length} itens` : undefined}
            />
            <Shortcut
              title="Contas"
              icon="wallet.pass"
              href="/finance/accounts"
              count={
                accounts.data
                  ? `${accounts.data.length} ${accounts.data.length === 1 ? 'conta' : 'contas'}`
                  : undefined
              }
            />
            <Shortcut
              title="Cartões"
              icon="creditcard"
              href="/finance/cards"
              count={
                cards.data
                  ? `${cards.data.length} ${cards.data.length === 1 ? 'ativo' : 'ativos'}`
                  : undefined
              }
            />
            <Shortcut
              title="Orçamentos"
              icon="chart.pie"
              href="/finance/budgets"
              count={
                budgets.data
                  ? `${budgets.data.length} ${budgets.data.length === 1 ? 'teto' : 'tetos'}`
                  : undefined
              }
            />
          </View>
        </View>

        {/* Bloco 3 — o simulador estava enterrado dentro da projeção. */}
        <Section>
          <Row
            title="Posso comprar isso?"
            subtitle="Simula o parcelado em cima da projeção"
            icon="cart"
            onPress={() => router.push('/finance/forecast')}
          />
        </Section>

        {/* Bloco 4 — categoria sem comparação é número; com comparação é informação. */}
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
                          {/* `data`, não `tint`: a barra aqui é comparação entre categorias,
                              não estado a resolver. Ver o docblock do ProgressBar. */}
                          <ProgressBar value={total} max={maxCategory} tone="data" />
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

        {/* Bloco 4b — a tendência. Os outros blocos são todos do MÊS; este é o único que
            responde "e ao longo do tempo?". Sai de `monthly_cashflow`, que existe desde a 0012
            com hook pronto e nenhuma tela lendo. */}
        {cashflow.isError ? (
          <ErrorCard onRetry={cashflow.refetch} />
        ) : cashflow.isLoading ? (
          <View style={styles.block}>
            <SectionHead title="Entrou e saiu" />
            <Skeleton height={140} radius={Radius.md} />
          </View>
        ) : meses.length > 1 ? (
          <View style={styles.block}>
            <SectionHead title="Entrou e saiu" />
            <Section>
              <View style={styles.cashflow}>
                <Segmented
                  options={JANELAS_CASHFLOW}
                  value={janelaCashflow}
                  onChange={setJanelaCashflow}
                />

                <View style={styles.cashBars}>
                  {meses.map((m, index) => {
                    const entrou = Number(m.income_cents);
                    const saiu = Number(m.expense_cents);
                    return (
                      <View
                        key={m.month}
                        style={styles.cashSlot}
                        accessible
                        accessibilityLabel={`${monthTitle(m.month.slice(0, 7))}: entrou ${formatBRL(entrou)}, saiu ${formatBRL(saiu)}`}>
                        <View style={styles.cashPair}>
                          <View style={styles.cashTrack}>
                            <CashBar ratio={entrou / tetoCashflow} index={index} forte />
                          </View>
                          <View style={styles.cashTrack}>
                            <CashBar ratio={saiu / tetoCashflow} index={index} forte={false} />
                          </View>
                        </View>
                        {/* `monthShort`, não `monthLabel`: "agosto de 2026" numa fatia de 40pt
                            quebrava uma letra por linha e o eixo virava sopa de letrinhas. */}
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                          numberOfLines={1}
                          style={styles.cashMes}>
                          {monthShort(m.month.slice(0, 7))}
                        </ThemedText>
                      </View>
                    );
                  })}
                </View>

                {/* Legenda em PALAVRA: a diferença entre as duas barras não pode depender de
                    enxergar cor. */}
                <View style={styles.cashLegenda}>
                  <View style={styles.cashChave}>
                    <View style={[styles.cashSwatch, { backgroundColor: theme.tint }]} />
                    <ThemedText type="small" themeColor="textSecondary">
                      entrou
                    </ThemedText>
                  </View>
                  <View style={styles.cashChave}>
                    <View
                      style={[styles.cashSwatch, { backgroundColor: theme.tint, opacity: 0.35 }]}
                    />
                    <ThemedText type="small" themeColor="textSecondary">
                      saiu
                    </ThemedText>
                  </View>
                </View>
              </View>
            </Section>
          </View>
        ) : null}

        {/* Bloco 5 — só o que já dói. Orçamento em 30% não é notícia. */}
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

        {/* Bloco 6 — cartões. */}
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

        {/* Bloco 7 — confirmação do que a IA registrou, agrupada por dia. */}
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
                  <ItemLink
                    key={tx.id}
                    href={{
                      pathname: '/finance/[txId]',
                      params: { txId: tx.id, month: tx.occurred_at.slice(0, 7) },
                    }}
                    title={tx.description || tx.merchant || tx.category || 'Lançamento'}
                    actions={[
                      {
                        label: 'Ver detalhe',
                        icon: 'doc.text.magnifyingglass',
                        onPress: () =>
                          router.push({
                            pathname: '/finance/[txId]',
                            params: { txId: tx.id, month: tx.occurred_at.slice(0, 7) },
                          }),
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
                      {
                        label: 'Apagar',
                        icon: 'trash',
                        destructive: true,
                        onPress: () => confirmDelete(tx),
                      },
                    ]}>
                    {({ onLongPress }) => (
                      <Row
                        title={tx.description || tx.merchant || tx.category || 'Sem descrição'}
                        subtitle={[tx.category, SOURCE_LABEL[tx.source]].filter(Boolean).join(' · ')}
                        icon={KIND_ICON[tx.kind]}
                        accessibilityLabel={`${tx.description || tx.category || 'lançamento'}, ${formatBRL(tx.amount_cents)}, ${tx.kind === 'income' ? 'receita' : tx.kind === 'expense' ? 'despesa' : 'transferência'}`}
                        onLongPress={onLongPress}
                        trailing={
                          <Money
                            cents={tx.kind === 'expense' ? -tx.amount_cents : tx.amount_cents}
                            variant="headline"
                            tone={tx.kind === 'income' ? 'success' : 'text'}
                            signed={tx.kind !== 'transfer'}
                          />
                        }
                      />
                    )}
                  </ItemLink>
                ))}
              </Section>
            ))}
          </View>
        ) : null}

        {isEmpty ? (
          <EmptyState
            title="Ainda não tem movimento"
            hint={'Manda “gastei 45 no mercado” no WhatsApp —\nou toca no + para lançar aqui'}
          />
        ) : null}
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
  escopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  shortcuts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: Space.sm,
  },
  shortcut: {
    width: '48.5%',
  },
  shortcutPress: {
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    gap: Space.md,
  },
  shortcutTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shortcutIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  shortcutBottom: {
    gap: Space.xs,
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
  cashflow: {
    gap: Space.lg,
    padding: Space.lg,
  },
  cashBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Space.md,
  },
  cashSlot: {
    flex: 1,
    gap: Space.xs,
  },
  cashPair: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    // Respiro INTERNO menor que o `gap` entre meses (`cashBars`): é o que faz as duas barras
    // lerem como um par, e não como doze barras soltas.
    gap: Space.xs,
  },
  cashTrack: {
    flex: 1,
    height: ALTURA_BARRA,
    justifyContent: 'flex-end',
  },
  cashBar: {
    width: '100%',
    borderRadius: Radius.xs,
    borderCurve: 'continuous',
  },
  cashMes: {
    textAlign: 'center',
  },
  cashLegenda: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
  },
  cashChave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  cashSwatch: {
    width: 10,
    height: 10,
    // Ponto redondo: `Radius.xs` (8) é o menor raio da escala e num quadrado de 10 já viraria
    // quase círculo — então é círculo de propósito, não um raio fora da régua.
    borderRadius: Radius.pill,
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
