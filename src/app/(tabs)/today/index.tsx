import { useMemo } from 'react';
import { router } from 'expo-router';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ErrorCard } from '@/components/error-card';
import { AppHeader, useAppHeaderHeight } from '@/components/ui/app-header';
import { CURVED_BAR_SPACE } from '@/components/ui/curved-tab-bar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { HeroPanel } from '@/components/ui/hero-panel';
import { SectionHead } from '@/components/ui/section-head';
import { Skeleton } from '@/components/ui/skeleton';
import { ProgressBar, Sparkline } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Radius, Space, tabular, Type } from '@/design/tokens';
import {
  useBudgetsStatus,
  useCashFlowForecast,
  useMarkPaid,
  useRecentTransactions,
  useUpcomingBills,
} from '@/hooks/use-finance';
import { categoryIcon } from '@/design/category-icons';
import { formatBRL, formatDateBR, localISODate, useTodayReminders } from '@/hooks/use-items';
import { useProfile } from '@/hooks/use-profile';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { greetingBR } from '@/lib/dates';
import { showItemActions } from '@/lib/item-actions';
import { settleLabel } from '@/lib/settle-labels';
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
  const headerHeight = useAppHeaderHeight();
  const { width } = useWindowDimensions();

  const { daysLeft, monthEndDay } = useMemo(() => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      daysLeft: Math.max(1, last.getDate() - now.getDate()),
      monthEndDay: last.getDate(),
    };
  }, []);

  const { session } = useSession();
  const profile = useProfile(session?.user?.id);
  /** Só o primeiro nome: "Bom dia, Gabriel Almeida Dias" é um crachá, não um cumprimento. */
  const firstName = profile.data?.display_name?.trim().split(/\s+/)[0];

  const forecast = useCashFlowForecast(daysLeft);
  const bills = useUpcomingBills(7);
  const reminders = useTodayReminders();
  const budgets = useBudgetsStatus();
  const recent = useRecentTransactions(5);
  const markPaid = useMarkPaid();

  const series = (forecast.data ?? []).map((d) => Number(d.balance_cents));
  const leftover = series.at(-1) ?? 0;
  /**
   * Os dois números que o card passou a mostrar lado a lado, a pedido do dono do produto.
   *
   * `series[0]` é o dia 0 da projeção, e o dia 0 é `private.cash_total` — que filtra
   * `status='cleared'`. Ou seja: é o dinheiro que ele TEM, sem o Pix que não chegou. O
   * "a receber" é a soma de `in_cents` do resto do mês, que é justamente o que está fora
   * do primeiro número e dentro do último.
   */
  const tenhoHoje = series[0] ?? 0;
  const aReceberNoMes = (forecast.data ?? []).reduce((t, d) => t + Number(d.in_cents), 0);

  /**
   * `upcoming_bills` passou a devolver RECEITA prevista (`kind: 'income'`, migration
   * 20260909150000). Ela tem seção própria: o cabeçalho desta aqui diz "ATRASADO / ATENÇÃO",
   * que é vocabulário de dívida — um Pix que não chegou não é culpa de ninguém e não gera juros.
   */
  const contas = (bills.data ?? []).filter((b) => b.kind !== 'income');
  const overdue = contas.filter((b) => b.overdue);
  const dueSoon = contas.filter((b) => !b.overdue);
  const aReceber = (bills.data ?? []).filter((b) => b.kind === 'income');
  const todayReminders = reminders.data ?? [];
  // Gasto + comprometido: o aviso existe para o que AINDA dá para evitar. Ver a régua em
  // `budgets.tsx` e a `20260909180000`.
  const tight = (budgets.data ?? []).filter(
    (b) =>
      Number(b.limit_cents) > 0 &&
      (Number(b.spent_cents) + Number(b.committed_cents ?? 0)) / Number(b.limit_cents) >= TIGHT
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
      <ScrollView
        alwaysBounceVertical
        refreshControl={<RefreshControl
          progressViewOffset={headerHeight}
          refreshing={forecast.isRefetching || bills.isRefetching || reminders.isRefetching || budgets.isRefetching || recent.isRefetching || profile.isRefetching}
          onRefresh={() => Promise.all([forecast.refetch(), bills.refetch(), reminders.refetch(), budgets.refetch(), recent.refetch(), profile.refetch()])}
        />}
        contentContainerStyle={[
          styles.scroll,
          {
            // A faixa de marca é sobreposta (ela desfoca o que passa por baixo) e a barra do
            // Android é absoluta: nenhuma das duas reserva o próprio espaço.
            paddingTop: headerHeight + Space.md,
            paddingBottom:
              insets.bottom +
              Space.xxxl +
              (Platform.OS === 'android' ? CURVED_BAR_SPACE : Space.xxl),
          },
        ]}
        showsVerticalScrollIndicator={false}>
        {/*
          0. A saudação. Sem nome preenchido ela NÃO aparece — nem como "Bom dia," sozinho, nem
          como um espaço reservado: quem entrou por Phone OTP nunca informou nome, e um
          cumprimento pela metade é pior que nenhum. Em `subtitle` porque a display da tela já é
          o valor do painel logo abaixo (§3, uma por tela).
        */}
        {firstName ? (
          <ThemedText type="subtitle">{`${greetingBR()}, ${firstName}`}</ThemedText>
        ) : null}

        {/*
          1. O painel de destaque. É o `HeroPanel` compartilhado, não uma cópia local: esta tela
          reimplementava o card inteiro à mão, e por isso não ganhou o gradiente, o brilho e o
          alfinete do gráfico quando o primitivo ganhou.
        */}
        {forecast.isLoading ? (
          <View style={styles.heroSkeleton}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="70%" height={38} />
          </View>
        ) : forecast.isError ? (
          <ErrorCard onRetry={() => forecast.refetch()} />
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
            label="Sobra até o fim do mês"
            concealable
            value={
              <Money
                cents={leftover}
                variant="heroMoney"
                tone={leftover < 0 ? 'onHeroDanger' : 'onHero'}
                concealable
              />
            }
            secondary={{
              icon: leftover < 0 ? 'chart.line.downtrend.xyaxis' : 'chart.line.uptrend.xyaxis',
              negative: leftover < 0,
              text: `${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'} até virar o mês · Projeção ${
                leftover < 0 ? 'negativa' : 'positiva'
              }`,
            }}
            chart={
              series.length > 1 ? (
                <>
                  {/*
                    O eixo do desenho: onde a série começa, o que ela projeta, onde ela termina.
                    Sem os extremos o gráfico é uma curva sem escala — bonita e muda.
                  */}
                  <View style={styles.legend}>
                    <ThemedText type="caption" themeColor="onHeroMuted">
                      Hoje
                    </ThemedText>
                    <ThemedText
                      type="caption"
                      themeColor={leftover < 0 ? 'onHeroDanger' : 'onHeroSuccess'}>
                      {`${formatBRL(leftover)} projetado`}
                    </ThemedText>
                    <ThemedText type="caption" themeColor="onHeroMuted">
                      {`Dia ${monthEndDay}`}
                    </ThemedText>
                  </View>
                  <Sparkline values={series} width={chartWidth} height={48} />
                </>
              ) : undefined
            }
          footer={
            aReceberNoMes > 0 ? (
              <View style={styles.heroFooter}>
                <View style={styles.heroFooterPart}>
                  <ThemedText type="caption" themeColor="onHeroMuted" style={Type.meta}>
                    TENHO HOJE
                  </ThemedText>
                  <Money cents={tenhoHoje} variant="subhead" tone="onHero" concealable />
                </View>
                <View style={styles.heroFooterPart}>
                  <ThemedText type="caption" themeColor="onHeroMuted" style={Type.meta}>
                    A RECEBER
                  </ThemedText>
                  <Money cents={aReceberNoMes} variant="subhead" tone="onHeroSuccess" concealable />
                </View>
              </View>
            ) : undefined
          }
          onPress={() =>
            showItemActions('Mais opções', [
              { label: 'Projeção de caixa', icon: 'chart.line.uptrend.xyaxis', onPress: () => router.push('/finance/forecast') },
              { label: 'O mês inteiro', icon: 'calendar', onPress: () => router.push('/finance/month') },
              { label: 'Patrimônio', icon: 'building.columns', onPress: () => router.push('/finance/net-worth') },
              { label: 'Metas', icon: 'target', onPress: () => router.push('/finance/goals') },
            ])
          }
          />
        )}

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
            <SectionHead title="Atrasado / atenção" inset={false} />
            <ErrorCard onRetry={() => bills.refetch()} />
          </View>
        ) : overdue.length > 0 ? (
          <View style={styles.section}>
            <SectionHead
              title="Atrasado / atenção"
              inset={false}
              action={
                <ThemedText type="caption" themeColor="textSecondary">
                  {`${overdue.length} ${overdue.length === 1 ? 'pendência' : 'pendências'}`}
                </ThemedText>
              }
            />
            {overdue.map((b) => (
              /*
                A linha ABRE o lançamento. O botão dá baixa, que é a ação de 90% dos
                dias; mas quando a conta veio diferente do previsto ("a luz veio 180"),
                dar baixa grava o valor errado — e até 09/09/2026 esta tela não tinha
                caminho nenhum para corrigir antes de pagar. Fatura e dívida já tinham
                destino próprio pelo botão; só o lançamento avulso ficava sem.
              */
              <Pressable
                key={b.ref_id}
                accessibilityRole={b.kind === 'transaction' ? 'button' : undefined}
                accessibilityLabel={b.kind === 'transaction' ? `Abrir ${b.title}` : undefined}
                disabled={b.kind !== 'transaction'}
                onPress={() => router.push({ pathname: '/finance/[txId]', params: { txId: b.ref_id } })}
                style={({ pressed }) => [
                  styles.card,
                  styles.billCard,
                  {
                    backgroundColor: pressed ? theme.backgroundSelected : theme.surface,
                    borderColor: theme.cardBorder,
                  },
                ]}>
                <View style={styles.billInfo}>
                  {/*
                    Título e pílula na MESMA linha, como no export — o título encolhe e trunca,
                    a pílula não. A versão anterior empurrava a pílula para a linha do valor e
                    ali as duas juntas estouravam a largura e QUEBRAVAM, que foi a queixa de
                    "tem uns que pulam para a linha de baixo".
                  */}
                  <View style={styles.billTitleRow}>
                    <ThemedText type="small" style={styles.billTitle}>
                      {b.title}
                    </ThemedText>
                    <View style={[styles.duePill, { backgroundColor: theme.dangerSoft }]}>
                      <ThemedText type="caption" themeColor="danger">
                        {`venceu ${formatDateBR(b.due_date)}`}
                      </ThemedText>
                    </View>
                  </View>
                  <Money cents={Number(b.amount_cents)} variant="ticker" tone="danger" />
                </View>

                {/*
                  `debt` é a prestação de um financiamento, e `ref_id` é o id da
                  DÍVIDA, não de um lançamento — dar baixa de lançamento nele não
                  acharia nada. Vai para a dívida, igual a fatura vai para a fatura.
                */}
                <Button
                  label={
                    b.kind === 'invoice'
                      ? 'Pagar fatura'
                      : b.kind === 'debt'
                        ? 'Ver dívida'
                        : settleLabel(b.kind === 'income' ? 'income' : 'expense')
                  }
                  icon={b.kind === 'debt' ? 'chevron.right' : 'checkmark'}
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    if (b.kind === 'invoice') {
                      router.push({ pathname: '/finance/invoice/[id]', params: { id: b.ref_id } });
                    } else if (b.kind === 'debt') {
                      router.push('/finance/debts');
                    } else {
                      pay(b.ref_id, b.title);
                    }
                  }}
                />
              </Pressable>
            ))}
          </View>
        ) : null}

        {/*
          3a. O que VENCE — o que ainda não venceu, dentro dos 7 dias da consulta.

          ⚠️ **Esta seção sumiu em 02/09/2026** (`e8aab38`, o redesenho do Stitch) e o resto da
          tela continuou contando com ela: `dueSoon` soma no contador "Vencendo" e no badge da
          aba, e entra em `nothing`, que é o que decide se o `EmptyState` aparece. Com uma conta
          a vencer e mais nada, a Hoje ficava com "Vencendo 1" e um VAZIO embaixo — nem seção,
          nem estado vazio. Foi o que apareceu no aparelho do dono do produto em 09/09/2026.

          O título é o mesmo da Projeção ("O que vence"), que nunca perdeu a dela: as duas telas
          leem `upcoming_bills` e chamar a mesma coisa por dois nomes é o começo de divergirem.

          A pílula aqui é NEUTRA, e é o ponto da seção existir separada: o que vence daqui a
          cinco dias não é problema nem aviso. `danger` é de "Atrasado / atenção" e `warning` é
          de receita que não caiu — gastar qualquer um dos dois aqui queima a única alavanca de
          cor do app (design.md §2b).
        */}
        {dueSoon.length > 0 ? (
          <View style={styles.section}>
            <SectionHead
              title="O que vence"
              inset={false}
              action={
                <ThemedText type="caption" themeColor="textSecondary">
                  {`${dueSoon.length} ${dueSoon.length === 1 ? 'conta' : 'contas'}`}
                </ThemedText>
              }
            />
            {dueSoon.map((b) => (
              <Pressable
                key={b.ref_id}
                accessibilityRole={b.kind === 'transaction' ? 'button' : undefined}
                accessibilityLabel={b.kind === 'transaction' ? `Abrir ${b.title}` : undefined}
                disabled={b.kind !== 'transaction'}
                onPress={() => router.push({ pathname: '/finance/[txId]', params: { txId: b.ref_id } })}
                style={({ pressed }) => [
                  styles.card,
                  styles.billCard,
                  {
                    backgroundColor: pressed ? theme.backgroundSelected : theme.surface,
                    borderColor: theme.cardBorder,
                  },
                ]}>
                <View style={styles.billInfo}>
                  <View style={styles.billTitleRow}>
                    <ThemedText type="small" style={styles.billTitle}>
                      {b.title}
                    </ThemedText>
                    <View style={[styles.duePill, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText type="caption" themeColor="textSecondary">
                        {`vence ${formatDateBR(b.due_date)}`}
                      </ThemedText>
                    </View>
                  </View>
                  <Money cents={Number(b.amount_cents)} variant="ticker" />
                </View>
                <Button
                  label={
                    b.kind === 'invoice'
                      ? 'Pagar fatura'
                      : b.kind === 'debt'
                        ? 'Ver dívida'
                        : settleLabel('expense')
                  }
                  icon={b.kind === 'debt' ? 'chevron.right' : 'checkmark'}
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    if (b.kind === 'invoice') {
                      router.push({ pathname: '/finance/invoice/[id]', params: { id: b.ref_id } });
                    } else if (b.kind === 'debt') {
                      router.push('/finance/debts');
                    } else {
                      pay(b.ref_id, b.title);
                    }
                  }}
                />
              </Pressable>
            ))}
          </View>
        ) : null}

        {/*
          3b. O que ENTRA. Seção própria, e não uma linha na de cima: o cabeçalho de lá diz
          "Atrasado / atenção", que é vocabulário de dívida. Um Pix que não chegou não é culpa
          do usuário e não gera juros — por isso a pílula aqui é `warning`, não `danger`. Gastar
          `danger` num aviso queima a única alavanca de cor do app (design.md §2b).

          O contador da aba (`overdue.length + dueSoon.length`) continua SÓ de despesa: badge é
          contagem real, e salário previsto dentro de "Vencendo" seria o contador mentindo.
        */}
        {aReceber.length > 0 ? (
          <View style={styles.section}>
            <SectionHead
              title="O que entra"
              inset={false}
              action={
                <ThemedText type="caption" themeColor="textSecondary">
                  {`${aReceber.length} a receber`}
                </ThemedText>
              }
            />
            {aReceber.map((b) => (
              <Pressable
                key={b.ref_id}
                accessibilityRole="button"
                accessibilityLabel={`Abrir ${b.title}`}
                onPress={() => router.push({ pathname: '/finance/[txId]', params: { txId: b.ref_id } })}
                style={({ pressed }) => [
                  styles.card,
                  styles.billCard,
                  {
                    backgroundColor: pressed ? theme.backgroundSelected : theme.surface,
                    borderColor: theme.cardBorder,
                  },
                ]}>
                <View style={styles.billInfo}>
                  <View style={styles.billTitleRow}>
                    <ThemedText type="small" style={styles.billTitle}>
                      {b.title}
                    </ThemedText>
                    <View style={[styles.duePill, { backgroundColor: theme.warningSoft }]}>
                      <ThemedText type="caption" themeColor="warning">
                        {b.overdue
                          ? `não caiu ${formatDateBR(b.due_date)}`
                          : `chega ${formatDateBR(b.due_date)}`}
                      </ThemedText>
                    </View>
                  </View>
                  <Money cents={Number(b.amount_cents)} variant="ticker" tone="success" />
                </View>
                <Button
                  label={settleLabel('income')}
                  icon="checkmark"
                  size="sm"
                  variant="secondary"
                  onPress={() => pay(b.ref_id, b.title)}
                />
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* 4. Os lembretes de hoje, agrupados numa superfície só, como no desenho. */}
        {reminders.isError ? (
          <View style={styles.section}>
            <SectionHead title="Lembretes de hoje" inset={false} />
            <ErrorCard onRetry={() => reminders.refetch()} />
          </View>
        ) : todayReminders.length > 0 ? (
          <View style={styles.section}>
            <SectionHead
              title="Lembretes de hoje"
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
                      <ThemedText type="small">
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
            <SectionHead title="Passando do orçamento" inset={false} />
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
                      <Icon name={categoryIcon(b.category)} size="sm" color="text" />
                    </View>
                    <View style={styles.shrink}>
                      <ThemedText type="headline">
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
                  <ThemedText type="small" style={styles.quote}>
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

      {/* Depois do scroll na árvore: a faixa precisa desenhar POR CIMA para o desfoque existir. */}
      <AppHeader title="Hoje" />
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
        <ThemedText type="caption" themeColor="textSecondary">
          {label}
        </ThemedText>
        {/*
          A contagem carrega a cor que o ponto carregava. Um ponto ao lado de um número é o
          mesmo dado dito duas vezes — e o número é a metade que se lê.
        */}
        <ThemedText type="headline" themeColor={value > 0 ? tone : 'text'} style={tabular}>
          {value}
        </ThemedText>
      </View>
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

  heroSkeleton: { gap: Space.md, paddingVertical: Space.md },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Space.xs,
  },

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
  /**
   * A pílula é uma `View` de largura de conteúdo e não cede. Com o título em `flex: 1` ele
   * absorvia 100% do aperto: numa tela de 384dp com a fonte do sistema em 1,3× "Fatura Nubank
   * Cartão" virava **"Fatu…"**, e em 336dp virava **"."**. O nome do que venceu é a informação
   * da linha; a data é o complemento.
   *
   * ⚠️ **`flexShrink: 0` no título é o que faz o `flexWrap` funcionar.** Medido no emulador: com
   * `flexShrink: 1` o Yoga prefere ENCOLHER a quebrar, então a linha continuava numa linha só e
   * o título continuava sumindo — a mesma tela, o mesmo bug, agora com `flexWrap` ligado sem
   * efeito nenhum. Sem encolher, ele ocupa a linha inteira e a pílula desce sozinha.
   *
   * Isso não repete a queixa antiga ("tem uns que pulam para a linha de baixo"): lá a pílula caía
   * na linha do VALOR e as duas colidiam. Aqui ela quebra dentro da própria linha do título, e só
   * quando não cabe — na largura normal as duas continuam lado a lado, como no export.
   */
  billTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Space.sm },
  billTitle: { flexShrink: 0, maxWidth: '100%' },
  duePill: {
    flexShrink: 0,
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
  heroFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Space.lg,
  },
  heroFooterPart: {
    gap: Space.half,
  },
});
