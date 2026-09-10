import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
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
import { CardStack, type StackedCard } from '@/components/finance/card-stack';
import { CURVED_BAR_CLEARANCE } from '@/components/ui/curved-tab-bar';
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
import { ProgressBar } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Elevation, Motion, Radius, Space, Type, tabular } from '@/design/tokens';
import {
  useAccounts,
  useMonthSummary,
  useBudgetsStatus,
  useDebts,
  useCardSummary,
  useCashFlowForecast,
  useCycle,
  useMonthRange,
  useDeleteTransaction,
  useMonthlyCashflow,
  useRecentTransactions,
  useTransactionsSummary,
  type Transaction,
} from '@/hooks/use-finance';
import { categoryIcon } from '@/design/category-icons';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import { isoToBR, monthBounds } from '@/lib/dates';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';
import { useTheme, useScheme } from '@/hooks/use-theme';

/**
 * Financeiro — responde "como está o meu mês?" e, no fundo, "posso gastar?".
 *
 * O topo é **projeção**, não saldo bruto: saldo bruto mente para quem tem fatura fechando.
 * Cada bloco tem query, loading e erro próprios — antes um `hasError` cobria cinco queries e
 * esquecia a de contas a pagar.
 *
 * ## A ordem dos blocos é uma decisão, não o acaso da implementação (03/09/2026)
 *
 * Ela vai de **o que exige ação** para **o que exige reflexão**:
 *
 * | # | bloco | por que aqui |
 * |---|---|---|
 * | 1 | saldo projetado | a pergunta que trouxe a pessoa |
 * | 2 | o mês inteiro | a página de mês: entradas, fixas, parcelas e para onde foi, num lugar só |
 * | 3 | e se…? | o mesmo fôlego do 2, para os meses SEGUINTES: a sobra que se carrega |
 * | 4 | atalhos | as quatro portas para o resto do domínio |
 * | 5 | passando do limite | alerta; só existe quando já dói |
 * | 6 | carteira | a fatura é a maior saída isolada do mês |
 * | 7 | últimos lançamentos | o que aconteceu desde ontem — a checagem diária |
 * | 8 | tendência mensal | o primeiro bloco de ANÁLISE |
 * | 9 | onde o dinheiro foi | análise mais funda, seis linhas |
 *
 * O bloco 2 entrou em 09/09/2026 e **não** virou um quinto tile do grid de atalhos: ali ele
 * leria como igual a "Contas", e não é — é a única porta que responde "para onde o dinheiro
 * foi" sem entrar em cinco telas.
 *
 * O bloco 3 subiu do último lugar em 10/09/2026. O argumento antigo ("ninguém abre o app para
 * simular") descrevia um simulador de compra; o bloco virou o saldo mês a mês com a sobra
 * CARREGADA de um mês para o outro, que é a pergunta que fazia o dono do produto voltar para a
 * planilha. Ele fica colado no bloco 2 porque os dois são a mesma leitura em fôlegos
 * diferentes — este mês, e daqui para frente.
 *
 * Antes, o simulador e as categorias vinham em 4º e 5º — uma ferramenta e um bloco de seis
 * barras empurravam a carteira e o extrato para baixo de duas rolagens. É o que os apps de banco
 * grandes fazem ao contrário: saldo, ações, **atividade recente**, e só então análise. Rever esta
 * tabela antes de inserir bloco novo no meio.
 */

const SOURCE_LABEL: Record<Transaction['source'], string> = {
  whatsapp: 'via WhatsApp',
  app: 'lançado no app',
  import: 'importado',
  recurring: 'recorrente',
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
        {/*
          Sem caixa em volta do ícone: o export põe o símbolo solto no canto. A caixa de 36px
          disputava peso com o rótulo e transformava quatro atalhos em quatro cards de ícone.
        */}
        <View style={styles.shortcutTop}>
          <Icon name={icon} size="md" color="text" />
          <Icon name="chevron.right" size="xs" color="textSecondary" />
        </View>
        <View style={styles.shortcutBottom}>
          <ThemedText type="headline">
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

/** A altura útil da barra. O `h-24` do export. */
const ALTURA_BARRA = 96;
/** A largura da barra. O `w-2.5` do export — traço fino, não bloco. */
const LARGURA_BARRA = 10;

/**
 * Barra da tendência mensal.
 *
 * Duas por mês (entrou e saiu) porque a pergunta é comparativa: a resposta é qual das duas é mais
 * alta. Por isso NÃO leva `success`/`danger` — cor semântica aqui seria decoração, e é a última
 * alavanca de cor que o app tem. O par é o mesmo de `invoices.tsx`: `tint` cheio contra
 * `backgroundElement`, mais a legenda em PALAVRA, que é o que funciona sem enxergar cor.
 */
/**
 * Uma barra do fluxo mensal, em DUAS partes.
 *
 * A base é o realizado; a tampa, meio transparente, é o previsto que ainda não aconteceu.
 * Até 09/09/2026 era uma barra só somando os dois — o mês corrente parecia fechado desde o
 * dia 1, e o dono do produto pediu que *"nos gráficos, tem que ter alguma coisa explicando a
 * diferença"*. Empilhar em vez de colorir mantém a comparação por CLARIDADE (§2b): a altura
 * total continua sendo o total, e o pedaço claro em cima diz o quanto dela é promessa.
 */
function CashBar({
  ratio,
  previsto,
  index,
  forte,
}: {
  ratio: number;
  previsto: number;
  index: number;
  forte: boolean;
}) {
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
  /**
   * A fração da barra que é previsto. `flex` e não altura fixa: assim ela acompanha a mola da
   * barra inteira em vez de precisar de uma segunda animação que dessincroniza.
   *
   * ⚠️ `Number.isFinite` não é paranoia: `Math.min(1, Math.max(0, NaN))` devolve `NaN`, e NaN
   * num estilo do RN some com a view SEM UM ÚNICO ERRO no log — é a mesma mecânica que já
   * apagou a carteira inteira (design.md §1). Uma coluna ausente numa fixture ou num cache
   * antigo basta para chegar aqui.
   */
  const bruta = ratio > 0 ? previsto / ratio : 0;
  const fracaoPrevista = Number.isFinite(bruta) ? Math.min(1, Math.max(0, bruta)) : 0;

  return (
    <Animated.View
      style={[
        styles.cashBar,
        animado,
        // O par do export: `primary` (a cor do texto) contra `surface-bright` (cinza claro).
        // Sem matiz nenhuma — o accent fica reservado para ação e estado, e a comparação entre
        // "entrou" e "saiu" se resolve por CLARIDADE, que é o que funciona sem enxergar cor.
        { backgroundColor: forte ? theme.text : theme.surfaceRaised },
      ]}>
      {fracaoPrevista > 0 ? (
        <View
          style={[
            styles.cashBarPrevisto,
            // `surface` é a cor do PRÓPRIO card: a tampa lê como o pedaço da barra que ainda não
            // foi preenchido, que é a convenção de "projetado" — e funciona nos dois temas, ao
            // contrário de um cinza fixo (no claro a barra é quase-preta, no escuro quase-branca).
            // O contorno é o que a separa do fundo quando a barra encosta na borda do card.
            { flex: fracaoPrevista, backgroundColor: theme.surface, borderColor: theme.separator },
          ]}
        />
      ) : null}
    </Animated.View>
  );
}

/**
 * Dias entre hoje e o fim do mês civil (mínimo 1).
 *
 * É só o PALPITE enquanto `cycle_now` não responde — quem manda é o ciclo do usuário, e quem
 * sabe onde ele fecha é o banco. Para quem não configurou nada os dois dão o mesmo número.
 */
function daysToMonthEnd(): number {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return Math.max(1, Math.ceil((last.getTime() - now.getTime()) / 86_400_000));
}

export default function FinanceScreen() {
  const theme = useTheme();
  const scheme = useScheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const cycle = useCycle();
  /**
   * ⚠️ O mês CORRENTE é o ciclo que contém hoje, não `date_trunc('month')`.
   *
   * Com fechamento no dia 10, o dia 15/09 já pertence ao ciclo chamado "outubro". Ancorado no
   * mês civil, o seletor abriria em setembro — um ciclo atrasado — durante 20 dias por mês, e
   * o painel diria "Sobrou em setembro" em cima de um número de outubro.
   *
   * `null` = "siga o ciclo". O mês exibido é DERIVADO, nunca sincronizado por efeito: o ciclo
   * chega depois da primeira renderização, e copiá-lo para dentro de um `useState` seria uma
   * renderização em cascata para dizer o que já dava para calcular.
   */
  const [mesEscolhido, setMonth] = useState<string | null>(null);
  const mesCorrente = cycle.data?.mes ?? currentMonth();
  const month = mesEscolhido ?? mesCorrente;

  // ⚠️ As bordas seguem o CICLO, não o mês civil. O painel acima soma a janela do ciclo; se a
  // linha "entrou · saiu" logo abaixo somasse 01 a 31, os dois números não fechariam — colados,
  // sem nada na tela explicando por quê.
  const range = useMonthRange(month);
  const previousMonth = useMemo(() => shiftMonth(month, -1), [month]);
  const previousRange = useMonthRange(previousMonth);
  const isCurrent = month === mesCorrente;
  const daysLeft = cycle.data?.diasAteOFim ?? daysToMonthEnd();

  const forecast = useCashFlowForecast(daysLeft);
  const summary = useTransactionsSummary(range.from, range.to);
  const previous = useTransactionsSummary(previousRange.from, previousRange.to);
  const budgets = useBudgetsStatus(month);
  const accounts = useAccounts();
  const debts = useDebts();
  const cards = useCardSummary();
  const [janelaCashflow, setJanelaCashflow] = useState('6');
  /** O cartão que a carteira está mostrando — rotula a saída logo abaixo dela. */
  const [cartaoFrente, setCartaoFrente] = useState<StackedCard | null>(null);

  /**
   * Memoizado: montado inline no JSX, o array nascia novo a cada render e a carteira inteira
   * remontava junto — inclusive o efeito que reporta o cartão da frente.
   */
  const cartoesDaCarteira = useMemo<StackedCard[]>(
    () =>
      (cards.data ?? []).map((c) => ({
        account_id: c.account_id,
        name: c.name,
        invoice_id: c.invoice_id,
        invoice_total_cents: Number(c.invoice_total_cents ?? 0),
        credit_limit_cents: c.credit_limit_cents == null ? null : Number(c.credit_limit_cents),
        available_limit_cents:
          c.available_limit_cents == null ? null : Number(c.available_limit_cents),
        closing_date: c.closing_date,
        due_date: c.due_date,
        overdue_count: Number(c.overdue_count ?? 0),
      })),
    [cards.data]
  );
  const cashflow = useMonthlyCashflow(Number(janelaCashflow));
  const mes = useMonthSummary(month);
  const recent = useRecentTransactions(5);
  const remove = useDeleteTransaction();

  /**
   * ⚠️ `total_cents - pending_cents`: o REALIZADO.
   *
   * Até 09/09/2026 isto somava `total_cents` e a faixa escrevia "entrou R$ 10.200,00" contando
   * o Pix que ainda não tinha chegado — verbo no passado em cima de dinheiro que não entrou.
   * `pending_cents` veio na `20260909160000` exatamente para esta subtração.
   */
  const totalOf = (rows: typeof summary.data, kind: 'expense' | 'income') =>
    (rows ?? [])
      .filter((r) => r.kind === kind)
      .reduce((s, r) => s + Number(r.total_cents) - Number(r.pending_cents), 0);
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
    (b) =>
      Number(b.limit_cents) > 0 &&
      (Number(b.spent_cents) + Number(b.committed_cents ?? 0)) / Number(b.limit_cents) >= 0.8
  );

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

  const abrirFatura = (card: StackedCard) =>
    card.invoice_id
      ? router.push({ pathname: '/finance/invoice/[id]', params: { id: card.invoice_id } })
      : router.push('/finance/cards');

  const openTransactions = (params: Record<string, string>) =>
    router.push({ pathname: '/finance/transactions', params: { month, ...params } });

  return (
    <View style={styles.root}>
      <Screen
      floatingAction
        grouped
        // Sem etiqueta: o seletor de mês fica logo abaixo e diria a mesma coisa duas vezes.
        topBar={<AppHeader title="Financeiro" />}
        onRefresh={() => Promise.all([forecast.refetch(), summary.refetch(), previous.refetch(), budgets.refetch(), accounts.refetch(), cards.refetch(), recent.refetch(), cashflow.refetch()])}
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
          /*
            O toque no card abre o MENU, não um destino. Antes ele ia direto para a Projeção e
            ninguém sabia que existia — `HeroPanel` não tinha chevron, press-in nem rótulo de
            acessibilidade —, então o "custo" do toque a mais está sendo cobrado de um caminho
            que na prática não existia.

            As quatro opções são as mesmas nas duas raízes de propósito: mesmo card, mesmo
            gesto, e menu que muda de forma conforme a tela é menu que se lê toda vez.
            Patrimônio e Metas ganham de quebra — eram três toques (Ver tudo → Gerenciar →
            item), sem atalho nenhum.
          */
          <HeroPanel
            label={
              isCurrent
                ? cycle.data
                  ? `Saldo projetado em ${isoToBR(cycle.data.ate)}`
                  : 'Saldo projetado'
                : `Sobrou em ${monthTitle(month)}`
            }
            value={
              <Money
                cents={leftover}
                variant="heroMoney"
                tone={leftover < 0 ? 'danger' : 'onHero'}
                concealable
              />
            }
            secondary={{
              icon: leftover < 0 ? 'chart.line.downtrend.xyaxis' : 'chart.line.uptrend.xyaxis',
              negative: leftover < 0,
              /*
                "previsto" sozinho não dizia de que LADO: `upcomingOut` é só saída. Com receita
                prevista visível no resto do app, a palavra virou ambígua — passou a "ainda sai".

                Quatro segmentos NÃO cabem: a `secondaryRow` é `flex-start` justamente porque
                quebra em três linhas com fonte grande (`hero-panel.tsx:213-215`), e a régua é
                384dp × 1,3. Quem quer o lado de entrada abre a Projeção, que agora tem a linha
                do `in_cents`.
              */
              text:
                isCurrent && upcomingOut > 0
                  ? `entrou ${formatBRL(income)} · saiu ${formatBRL(expense)} · ainda sai ${formatBRL(upcomingOut)}`
                  : `entrou ${formatBRL(income)} · saiu ${formatBRL(expense)}`,
            }}
            /*
              **Sem gráfico aqui.** O herói do Financeiro no export é só rótulo, valor e a faixa
              de comparação — quem tem sparkline é o da Hoje. Dois gráficos a uma rolagem de
              distância (este e a Tendência Mensal) também diziam a mesma coisa duas vezes, com
              recortes diferentes: um de 30 dias, outro de 6 meses.
            */
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
          onPress={() =>
            showItemActions('Mais opções', [
              { label: 'Projeção de caixa', icon: 'chart.line.uptrend.xyaxis', onPress: () => router.push('/finance/forecast') },
              { label: 'O mês inteiro', icon: 'calendar', onPress: () => router.push({ pathname: '/finance/month', params: { month } }) },
              { label: 'Patrimônio', icon: 'building.columns', onPress: () => router.push('/finance/net-worth') },
              { label: 'Metas', icon: 'target', onPress: () => router.push('/finance/goals') },
            ])
          }
          />
        )}

        {/*
        2. A porta para a página do mês. Segue o `MonthPicker` desta tela, então o número bate
        com o resto. Erro no resumo tira o número, nunca a porta.
      */}
      <Section>
        <Row
          title="O mês inteiro"
          subtitle="entradas, fixas, parcelas e para onde o dinheiro foi"
          icon="calendar"
          onPress={() => router.push({ pathname: '/finance/month', params: { month } })}
          trailing={
            mes.data ? (
              <Money
                cents={Number(mes.data.result_cents)}
                variant="ticker"
                tone={Number(mes.data.result_cents) < 0 ? 'danger' : 'success'}
              />
            ) : undefined
          }
        />
      </Section>


      {/*
        3. O par do bloco 2: este mês fechado, e então os PRÓXIMOS.

        Ela vivia por último, com o argumento de que "ninguém abre o app para simular". O
        argumento vale para um simulador de compra; deixou de valer quando o bloco passou a
        responder o saldo mês a mês CARREGANDO a sobra do anterior — que é a única tela do app
        que responde "quanto me resta para gastar", e a razão pela qual o dono do produto ainda
        mantinha a conta numa planilha. Ferramenta que ninguém procura fica no fim; a resposta
        que a pessoa veio buscar, não.

        Aqui ela não parte nada: 1 e 2 são o mês corrente, 4 em diante é o resto do domínio.
      */}
      <Section>
        <Row
          title="E se…?"
          subtitle="Saldo mês a mês, carregando a sobra — e suponha uma entrada ou saída"
          icon="questionmark.circle"
          onPress={() => router.push('/finance/forecast')}
        />
      </Section>

      {/* 4. Atalhos. Sempre visível: sem conta cadastrada não existe dado a mostrar. */}
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
            {/*
              Dívida e financiamento SÓ existiam atrás de "Ver tudo". Quem
              cadastrou um financiamento de R$ 58.800 — pelo app ou pelo agente —
              abria o Financeiro e não via uma palavra sobre ele; foi assim que
              um cadastro que DEU CERTO pareceu não ter acontecido.

              Aparece só quando existe, e o número é o que falta pagar: contagem
              que não muda decisão é enfeite, e saldo devedor muda.
            */}
            {debts.data?.length ? (
              <Shortcut
                title="Dívidas"
                icon="banknote"
                href="/finance/debts"
                count={formatBRL(
                  debts.data.reduce((soma, d) => soma + Number(d.remaining_cents), 0),
                )}
              />
            ) : null}
          </View>
        </View>

        {/* 5. Só o que já dói. Orçamento em 30% não é notícia — e alerta vem antes de análise. */}
        {budgets.isError ? (
          <ErrorCard onRetry={budgets.refetch} />
        ) : tight.length > 0 ? (
          <Section title="Passando do limite">
            {tight.map((b) => {
              const comprometido = Number(b.committed_cents ?? 0);
              // o aviso conta o comprometido; o número exibido continua sendo o gasto
              const pct = (Number(b.spent_cents) + comprometido) / Number(b.limit_cents);
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

        {/* 6. A carteira. A fatura é a maior saída isolada do mês. */}
        {cards.isError ? (
          <ErrorCard onRetry={cards.refetch} />
        ) : (cards.data ?? []).length > 0 ? (
          <View style={styles.block}>
            <SectionHead
              title="Cartões"
              action={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Ver todos os cartões"
                  hitSlop={12}
                  onPress={() => router.push('/finance/cards')}>
                  <ThemedText type="small" themeColor="tint">
                    Ver todos
                  </ThemedText>
                </Pressable>
              }
            />
            <CardStack
              cards={cartoesDaCarteira}
              onFrontChange={setCartaoFrente}
              onOpen={(card) => abrirFatura(card)}
            />

            {/*
              A saída DO CARTÃO, colada na carteira.

              Sem ela, a primeira coisa abaixo do cartão era "Últimos lançamentos" — e
              proximidade sugere posse: a lista parecia ser daquele cartão, sendo que ela é de
              tudo. Esta linha responde a pergunta que o cartão levanta ("e os gastos DELE?")
              no lugar onde ela nasce, e por isso a seção seguinte pode começar do zero.
            */}
            {cartaoFrente ? (
              <Section>
                <Row
                  title={`Fatura do ${cartaoFrente.name}`}
                  subtitle={
                    cartaoFrente.closing_date
                      ? `fecha ${formatDateBR(cartaoFrente.closing_date)}`
                      : 'sem fatura aberta'
                  }
                  icon="creditcard"
                  onPress={() => abrirFatura(cartaoFrente)}
                  trailing={
                    <Money cents={Number(cartaoFrente.invoice_total_cents ?? 0)} variant="ticker" />
                  }
                />
              </Section>
            ) : null}
          </View>
        ) : null}

        {/*
          7. O extrato recente — a confirmação do que a IA registrou.

          **Lista CHAPADA, sem cabeçalho de dia.** Ela era agrupada por `occurred_at` e ganhava um
          cabeçalho por data, mas a query ordena por `created_at` (a ordem em que as coisas foram
          REGISTRADAS, que é o que "últimos lançamentos" quer dizer e o que a Hoje precisa para
          provar que o WhatsApp funcionou). As duas coisas juntas produziam cabeçalhos fora de
          ordem — 04/09, depois 11/09, depois 02/09 — e uma tela que se contradiz sozinha.

          O export resolve do jeito certo: nenhuma cabeça de dia, a data vai na própria linha.
        */}
        {recent.isError ? (
          <ErrorCard onRetry={recent.refetch} />
        ) : recent.isLoading ? (
          <Section>
            <SkeletonRow />
            <SkeletonRow />
          </Section>
        ) : (recent.data ?? []).length > 0 ? (
          <View style={styles.block}>
            <View style={styles.blockHead}>
              <View style={styles.shrink}>
                <ThemedText type="smallBold">Últimos lançamentos</ThemedText>
                {/* O escopo, escrito. É a metade textual da correção — a outra é a linha da
                    fatura acima, que tira do cartão a expectativa de "isto é meu". */}
                <ThemedText type="caption" themeColor="textSecondary" style={Type.meta}>
                  TODAS AS CONTAS
                </ThemedText>
              </View>
              <Pressable accessibilityRole="button" hitSlop={12} onPress={() => openTransactions({})}>
                <ThemedText type="small" themeColor="tint">
                  Ver todos
                </ThemedText>
              </Pressable>
            </View>
            <Section>
              {(recent.data ?? []).map((tx) => (
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
                        icon={categoryIcon(tx.category, tx.kind)}
                        accessibilityLabel={`${tx.description || tx.category || 'lançamento'}, ${formatBRL(tx.amount_cents)}, ${tx.kind === 'income' ? 'receita' : tx.kind === 'expense' ? 'despesa' : 'transferência'}`}
                        onLongPress={onLongPress}
                        trailing={
                          /* Valor e data empilhados à direita — o cabeçalho de dia saiu daqui. */
                          <View style={styles.trailing}>
                            <Money
                              cents={tx.kind === 'expense' ? -tx.amount_cents : tx.amount_cents}
                              variant="ticker"
                              tone={tx.kind === 'income' ? 'success' : 'text'}
                              signed={tx.kind !== 'transfer'}
                            />
                            <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
                              {formatDateBR(tx.occurred_at)}
                            </ThemedText>
                          </View>
                        }
                      />
                    )}
                </ItemLink>
              ))}
            </Section>
          </View>
        ) : null}

        {/* 8. A tendência. Os outros blocos são todos do MÊS; este é o único que responde
            "e ao longo do tempo?". Sai de `monthly_cashflow`. */}
        {cashflow.isError ? (
          <ErrorCard onRetry={cashflow.refetch} />
        ) : cashflow.isLoading ? (
          <View style={styles.block}>
            <SectionHead title="Entrou e saiu" />
            <Skeleton height={140} radius={Radius.md} />
          </View>
        ) : meses.length > 1 ? (
          <View style={styles.block}>
            <Section>
              <View style={styles.cashflow}>
                {/*
                  O título mora DENTRO do card, com a legenda na mesma linha — é o desenho da
                  "Tendência Mensal". Como `SectionHead` por fora, o card ficava sem cabeça e a
                  legenda sobrava solta no rodapé, longe do que ela explica.
                */}
                <View style={styles.cashHead}>
                  <View style={styles.shrink}>
                    <ThemedText type="subtitle">Tendência mensal</ThemedText>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      {`fluxo de caixa dos últimos ${janelaCashflow} meses`}
                    </ThemedText>
                  </View>
                  <View style={styles.cashLegenda}>
                    <View style={styles.cashChave}>
                      <View style={[styles.cashSwatch, { backgroundColor: theme.text }]} />
                      <ThemedText type="caption" themeColor="textSecondary">
                        entrou
                      </ThemedText>
                    </View>
                    <View style={styles.cashChave}>
                      <View style={[styles.cashSwatch, { backgroundColor: theme.surfaceRaised }]} />
                      <ThemedText type="caption" themeColor="textSecondary">
                        saiu
                      </ThemedText>
                    </View>
                    <View style={styles.cashChave}>
                      <View
                        style={[
                          styles.cashSwatch,
                          { backgroundColor: theme.surface, borderColor: theme.separator, borderWidth: 1 },
                        ]}
                      />
                      <ThemedText type="caption" themeColor="textSecondary">
                        previsto
                      </ThemedText>
                    </View>
                  </View>
                </View>

                <Segmented
                  options={JANELAS_CASHFLOW}
                  value={janelaCashflow}
                  onChange={setJanelaCashflow}
                />

                <View style={styles.cashBars}>
                  {meses.map((m, index) => {
                    const entrou = Number(m.income_cents);
                    const saiu = Number(m.expense_cents);
                    const entrouPrevisto = Number(m.income_pending_cents);
                    const saiuPrevisto = Number(m.expense_pending_cents);
                    return (
                      <View
                        key={m.month}
                        style={styles.cashSlot}
                        accessible
                        accessibilityLabel={`${monthTitle(m.month.slice(0, 7))}: entrou ${formatBRL(entrou - entrouPrevisto)}, saiu ${formatBRL(saiu - saiuPrevisto)}${entrouPrevisto + saiuPrevisto > 0 ? `, previsto ${formatBRL(entrouPrevisto)} a receber e ${formatBRL(saiuPrevisto)} a pagar` : ''}`}>
                        <View style={styles.cashPair}>
                          <View style={styles.cashTrack}>
                            <CashBar
                              ratio={entrou / tetoCashflow}
                              previsto={entrouPrevisto / tetoCashflow}
                              index={index}
                              forte
                            />
                          </View>
                          <View style={styles.cashTrack}>
                            <CashBar
                              ratio={saiu / tetoCashflow}
                              previsto={saiuPrevisto / tetoCashflow}
                              index={index}
                              forte={false}
                            />
                          </View>
                        </View>
                        {/* `monthShort`, não `monthLabel`: "agosto de 2026" numa fatia de 40pt
                            quebrava uma letra por linha e o eixo virava sopa de letrinhas. */}
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                          style={styles.cashMes}>
                          {monthShort(m.month.slice(0, 7))}
                        </ThemedText>
                      </View>
                    );
                  })}
                </View>

                {/*
                  A conta que o gráfico não faz sozinho: o que sobrou no mês em foco.
                  Um gráfico de barras responde "como foi variando"; ninguém subtrai duas barras
                  de cabeça para saber se guardou dinheiro.
                */}
                {/*
                  A faixa que sangra até as bordas do card — o mesmo padrão do rodapé do painel de
                  destaque, e um dos dois elementos que o export repete de tela em tela. Ela
                  carrega a conta que o gráfico não faz sozinho: um gráfico de barras responde
                  "como foi variando", e ninguém subtrai duas barras de cabeça.
                */}
                <View style={[styles.cashRodape, { backgroundColor: theme.heroFooter }]}>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {`Sobrou em ${monthShort(meses[meses.length - 1].month.slice(0, 7))}`}
                  </ThemedText>
                  <Money
                    cents={
                      Number(meses[meses.length - 1].income_cents) -
                      Number(meses[meses.length - 1].expense_cents)
                    }
                    variant="ticker"
                    tone="auto"
                    signed
                  />
                </View>
              </View>
            </Section>
          </View>
        ) : null}

        {/* 9. Categoria sem comparação é número; com comparação é informação. */}
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
                            <ThemedText type="default" style={styles.categoryName}>
                              {row.category}
                            </ThemedText>
                            <Money cents={total} variant="ticker" />
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
        onPress={() => showItemActions('Lançar', [
          { label: 'Gasto ou receita', onPress: () => router.push({ pathname: '/finance/transaction-form', params: { month } }) },
          { label: 'Despesa ou receita recorrente', onPress: () => router.push({ pathname: '/finance/recurring', params: { create: '1' } }) },
          { label: 'Financiamento', onPress: () => router.push({ pathname: '/finance/debts', params: { create: 'financing' } }) },
        ])}
        style={[
          styles.fab,
          {
            // No Android o FAB tem que subir ACIMA da `CurvedTabBar`, não encostar nela: a barra
            // flutua e o FAB tem `elevation` maior, então qualquer sobreposição vira o botão
            // desenhado por cima da pílula. `CURVED_BAR_CLEARANCE` já embute o respiro.
            bottom:
              insets.bottom +
              (Platform.OS === 'android' ? CURVED_BAR_CLEARANCE : Space.xxl),
            boxShadow: Elevation[scheme].floating,
            zIndex: 11,
            elevation: 11,
          },
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
    // `h-24` do export: o atalho é um quadrado com o ícone em cima e o rótulo apoiado embaixo.
    height: 96,
    justifyContent: 'space-between',
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  shortcutTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shortcutBottom: {
    gap: Space.half,
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
  shrink: { flex: 1, minWidth: 0 },
  trailing: { alignItems: 'flex-end', gap: Space.half },
  cashHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Space.md },
  cashRodape: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    // Negativo nas laterais e embaixo: é assim que a faixa alcança a borda do card sem o card
    // precisar abrir mão do próprio respiro (`-mx-gutter-lg -mb-gutter-lg` do export).
    marginHorizontal: -Space.lg,
    marginBottom: -Space.lg,
    marginTop: Space.sm,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm + 2,
  },
  cashflow: {
    gap: Space.lg,
    padding: Space.lg,
    overflow: 'hidden',
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
    justifyContent: 'center',
    // Respiro INTERNO menor que o `gap` entre meses (`cashBars`): é o que faz as duas barras
    // lerem como um par, e não como doze barras soltas.
    gap: Space.xs,
  },
  cashTrack: {
    width: LARGURA_BARRA,
    height: ALTURA_BARRA,
    justifyContent: 'flex-end',
  },
  cashBarPrevisto: {
    width: '100%',
    borderTopLeftRadius: Radius.xs,
    borderTopRightRadius: Radius.xs,
    borderWidth: 1,
  },
  cashBar: {
    width: '100%',
    // A tampa do previsto vive DENTRO da barra e ocupa o topo — daí `flex-start`.
    justifyContent: 'flex-start',
    // Só o topo é arredondado (`rounded-t-sm`): a base da barra tem que assentar numa linha reta,
    // senão o eixo do gráfico fica ondulado.
    borderTopLeftRadius: Radius.xs,
    borderTopRightRadius: Radius.xs,
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
