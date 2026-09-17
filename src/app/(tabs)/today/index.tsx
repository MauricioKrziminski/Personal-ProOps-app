import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import { ErrorCard } from '@/components/error-card';
import { AgendaItem } from '@/components/feed/agenda-item';
import { AgentPrompt } from '@/components/feed/agent-prompt';
import { ConversationFeed } from '@/components/feed/conversation-feed';
import { ReminderTimeline } from '@/components/feed/reminder-timeline';
import { SetupChecklist } from '@/components/feed/setup-checklist';
import { BudgetRings } from '@/components/finance/budget-rings';
import { ThemedText } from '@/components/themed-text';
import { AppHeader } from '@/components/ui/app-header';
import { BlockHeader } from '@/components/ui/block-header';
import { useBRL } from '@/components/ui/conceal';
import { CountUpMoney } from '@/components/ui/count-up-money';
import { DayRail } from '@/components/ui/day-rail';
import { HeroPanel } from '@/components/ui/hero-panel';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { RunwayBar } from '@/components/ui/runway-bar';
import { Screen } from '@/components/ui/screen';
import { Skeleton, SkeletonHero, SkeletonList } from '@/components/ui/skeleton';
import { Tile, TileRow } from '@/components/ui/tile';
import { useToast } from '@/components/ui/toast';
import type { ThemeColor } from '@/constants/theme';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import { useAgentActivity } from '@/hooks/use-agent-activity';
import { useBoolPref } from '@/hooks/use-bool-pref';
import {
  useBudgetsStatus,
  useCycle,
  useMarkPaid,
  useSpendable,
  useSpendablePath,
  useUpcomingBills,
  useUpcomingCardCharges,
} from '@/hooks/use-finance';
import { localISODate, useTodayReminders } from '@/hooks/use-items';
import { useProfile } from '@/hooks/use-profile';
import { useSession } from '@/hooks/use-session';
import { useSetupProgress } from '@/hooks/use-setup-progress';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { paresDaConversa } from '@/lib/activity-feed';
import { orcamentosApertados } from '@/lib/budget-tight';
import { diaCurtoBR, diasAte, greetingBR, isoToBR, rotuloDoDia } from '@/lib/dates';
import { showItemActions } from '@/lib/item-actions';
import { montarPista } from '@/lib/runway';
import { settleDone, settleLabel } from '@/lib/settle-labels';
import { agendaDoDia, iconeDoItem, metaDoItem, type ItemDaAgenda } from '@/lib/today-sections';

/**
 * A Hoje — "Conversa organizada" (spec 2026-09-17).
 *
 * Duas vozes: o app fala nos blocos com o selo da marca (o livre, Agora, Próximos dias) e a
 * pessoa fala na Conversa (Fase 2). A ordem continua sendo de URGÊNCIA: o que dá para gastar,
 * o que exige ação hoje, e só então o que vem.
 *
 * O herói NÃO repete o Financeiro: aqui é "quanto dá para gastar até entrar dinheiro de novo"
 * (`caixa − comprometido_ate_entrada`); lá é "como o ciclo fecha". A identidade que amarra os
 * dois está em `supabase/tests/da_para_gastar.sql`.
 */

/** Uma instância só: `LinearTransition` recriado a cada render remonta a animação. */
const linear = LinearTransition.duration(Motion.duration.base);

/** Bloco que some sem dar tranco no resto (§5: mudança de estado). A entrada é do `Screen`. */
function Bloco({ children }: { children: React.ReactNode }) {
  return (
    <Animated.View style={styles.bloco} layout={linear} exiting={FadeOut.duration(Motion.duration.exit)}>
      {children}
    </Animated.View>
  );
}

/** O número de um contador: cor só quando conta alguma coisa; `null` = a consulta falhou. */
function Contagem({ valor, tom }: { valor: number | null; tom: ThemeColor }) {
  return (
    <ThemedText
      type="subtitle"
      themeColor={valor === null ? 'textSecondary' : valor > 0 ? tom : 'text'}
      style={tabular}>
      {valor ?? '—'}
    </ThemedText>
  );
}

export default function TodayScreen() {
  // Dinheiro no meio de frase obedece ao "esconder saldo" — `Money` não cabe em texto corrido.
  const brl = useBRL();
  const toast = useToast();
  const hoje = localISODate();
  const [agora] = useState(() => Date.now());

  const { session } = useSession();
  const profile = useProfile(session?.user?.id);
  /** Só o primeiro nome: "Bom dia, Gabriel Almeida Dias" é um crachá, não um cumprimento. */
  const primeiroNome = profile.data?.display_name?.trim().split(/\s+/)[0];

  const cycle = useCycle();
  const gasto = useSpendable();
  const bills = useUpcomingBills(7);
  // Limitado de propósito: a Hoje não é o extrato do cartão. A lista inteira mora na fatura.
  const noCartao = useUpcomingCardCharges(6);
  const reminders = useTodayReminders();
  const budgets = useBudgetsStatus();
  const setup = useSetupProgress();
  const [passosEscondidos, esconderPassos] = useBoolPref(`hoje:passos-escondidos:${session?.user?.id ?? ''}`);
  const markPaid = useMarkPaid();
  const atividade = useAgentActivity(6);
  const caminho = useSpendablePath();
  const pares = useMemo(() => paresDaConversa(atividade.data ?? [], hoje), [atividade.data, hoje]);

  const caixa = Number(gasto.data?.caixa ?? 0);
  const comprometido = Number(gasto.data?.comprometido_ate_entrada ?? 0);
  const comprometidoNoCiclo = Number(gasto.data?.comprometido_no_ciclo ?? 0);
  const proximaEntrada = gasto.data?.proxima_entrada ?? null;
  const livre = caixa - comprometido;
  /** Até quando o "livre" vale: a próxima entrada, ou o fim do ciclo se não houver nenhuma. */
  const ateQuando = proximaEntrada ?? cycle.data?.ate ?? null;
  const diasLivres = Math.max(1, ateQuando ? diasAte(ateQuando, hoje) : (cycle.data?.diasAteOFim ?? 1));

  /* A Pista lê a MESMA lista que forma o "livre" (`spendable_path`); se a soma não bater, sem entalhes. */
  const pista = useMemo(
    () => montarPista(caixa, comprometido, caminho.data ?? [], hoje, ateQuando ?? hoje),
    [caixa, comprometido, caminho.data, hoje, ateQuando]
  );
  const agenda = useMemo(
    () => agendaDoDia(bills.data ?? [], noCartao.data ?? [], hoje),
    [bills.data, noCartao.data, hoje]
  );
  const atrasados = agenda.agora.filter((i) => i.atrasado);
  const doDia = agenda.agora.filter((i) => !i.atrasado);
  /** O contador "Vencendo" e o badge são SÓ de despesa (receita prevista não vence). */
  const contas = (bills.data ?? []).filter((b) => b.kind !== 'income');
  const lembretes = reminders.data ?? [];
  const apertados = useMemo(() => orcamentosApertados(budgets.data ?? []), [budgets.data]);

  /*
    A segunda linha do herói é o VEREDITO DO DIA: obrigação (devo alguma coisa?) ganha de
    permissão (posso gastar?). "Por dia" some abaixo de R$ 1,00 — um número ridículo no lugar
    mais nobre da tela ensina a pessoa a não ler a linha.
  */
  const atrasadoCents = atrasados.filter((i) => i.kind !== 'income').reduce((s, i) => s + i.cents, 0);
  const venceHojeCents = doDia.filter((i) => i.kind !== 'income').reduce((s, i) => s + i.cents, 0);
  const porDia = livre > 0 ? Math.floor(livre / diasLivres) : 0;
  const dias = `${diasLivres} ${diasLivres === 1 ? 'dia' : 'dias'}`;
  const veredito: { icon: React.ComponentProps<typeof Icon>['name']; negative: boolean; text: string } =
    atrasadoCents > 0
      ? { icon: 'exclamationmark.triangle', negative: true, text: `${brl(atrasadoCents)} atrasado` }
      : venceHojeCents > 0
        ? { icon: 'clock', negative: true, text: `${brl(venceHojeCents)} vence hoje` }
        : porDia >= 100
          ? { icon: 'calendar', negative: false, text: `≈ ${brl(porDia)} por dia · ${dias}` }
          : { icon: 'checkmark.circle', negative: false, text: `Nada vence hoje · ${dias} até entrar` };

  const mostrarPassos = setup.pronto && !passosEscondidos && setup.passos.some((p) => !p.feito);
  const diaCalmo =
    bills.isSuccess &&
    reminders.isSuccess &&
    agenda.agora.length === 0 &&
    agenda.proximos.length === 0 &&
    lembretes.length === 0;

  /*
    O PORTÃO DA TELA (Fase 5 do redesenho anterior): a Hoje abre inteira ou não abre. `profile`
    pode nascer desligada e mesmo assim entra — `telaPronta` lê `fetchStatus`.
  */
  const pronta = useTelaPronta(
    cycle, profile, gasto, bills, noCartao, reminders, budgets, atividade, caminho, ...setup.consultas,
  );

  const pay = (id: string, title: string, kind: string | null | undefined) =>
    markPaid.mutate(
      { id, paidAt: localISODate() },
      {
        onSuccess: () => toast({ message: `${title}: ${settleDone(kind)}.`, tone: 'success' }),
        onError: () => toast({ message: `Não deu para dar baixa em ${title}.`, tone: 'error' }),
      }
    );

  /*
    `debt` é a prestação de um financiamento e `ref_id` é o id da DÍVIDA: dar baixa de
    lançamento nele não acharia nada. Fatura e dívida vão para a própria tela; compra no cartão
    vai para a fatura em que ela vai cair.
  */
  const acaoDoItem = (i: ItemDaAgenda): React.ComponentProps<typeof AgendaItem>['action'] => {
    if (i.kind === 'card' && i.faturaId) {
      const id = i.faturaId;
      return { label: 'Ver fatura', icon: 'chevron.right', onPress: () => router.push({ pathname: '/finance/invoice/[id]', params: { id } }) };
    }
    if (i.kind === 'card') return undefined;
    if (i.kind === 'invoice') {
      return { label: 'Pagar fatura', icon: 'checkmark', onPress: () => router.push({ pathname: '/finance/invoice/[id]', params: { id: i.ref_id } }) };
    }
    if (i.kind === 'debt') return { label: 'Ver dívida', icon: 'chevron.right', onPress: () => router.push('/finance/debts') };
    return {
      label: settleLabel(i.kind === 'income' ? 'income' : 'expense'),
      icon: 'checkmark',
      onPress: () => pay(i.ref_id, i.title, i.kind),
    };
  };

  /**
   * A linha ABRE o lançamento — quando a conta veio diferente do previsto ("a luz veio 180"),
   * dar baixa gravaria o valor errado, e sem este caminho não havia como corrigir antes.
   */
  const abrirItem = (i: ItemDaAgenda) =>
    i.kind === 'transaction' || i.kind === 'income' || i.kind === 'card'
      ? () => router.push({ pathname: '/finance/[txId]', params: { txId: i.ref_id } })
      : undefined;

  const itemDaAgenda = (i: ItemDaAgenda, onde: 'agora' | 'proximos') => {
    const meta = metaDoItem(i, onde);
    return (
      <AgendaItem
        key={i.chave}
        title={i.title}
        meta={meta.texto}
        metaTone={meta.tom}
        cents={i.cents}
        valueTone={i.kind === 'income' ? 'success' : i.atrasado ? 'danger' : 'text'}
        icon={iconeDoItem(i)}
        cartao={i.cartao}
        action={acaoDoItem(i)}
        onPress={abrirItem(i)}
      />
    );
  };

  /*
    O toque no herói abre o MENU. As opções são as mesmas nas duas raízes (menu que muda de forma
    conforme a tela é menu que se lê toda vez). `mes` e `view` saem do próprio `cycle.data`, nunca
    de um default — o destino tem que mostrar o período que o rodapé nomeou (`finance.md`).
  */
  const abrirMenu = () =>
    showItemActions('Mais opções', [
      ...(cycle.data?.mes
        ? [
            {
              label: 'Ver o que fecha o ciclo',
              icon: 'list.bullet' as const,
              onPress: () =>
                router.push({
                  pathname: '/finance/cycle',
                  params: { month: cycle.data.mes, view: cycle.data.view, tipo: 'sai' },
                }),
            },
          ]
        : []),
      { label: 'Projeção', icon: 'chart.line.uptrend.xyaxis', onPress: () => router.push('/finance/forecast') },
      { label: 'Patrimônio', icon: 'building.columns', onPress: () => router.push('/finance/net-worth') },
      { label: 'Metas', icon: 'target', onPress: () => router.push('/finance/goals') },
    ]);

  if (!pronta) {
    return (
      <Screen topBar={<AppHeader title="Hoje" />}>
        <View style={styles.cabecalho}>
          <Skeleton width="28%" height={12} />
          <Skeleton width="60%" height={28} />
        </View>
        <SkeletonHero />
        <View style={styles.linhaEsqueleto}>
          <Skeleton width="31%" height={64} radius={Radius.md} />
          <Skeleton width="31%" height={64} radius={Radius.md} />
          <Skeleton width="31%" height={64} radius={Radius.md} />
        </View>
        <Skeleton height={64} radius={Radius.pill} />
        <SkeletonList linhas={3} />
      </Screen>
    );
  }

  return (
    <Screen
      stagger
      topBar={<AppHeader title="Hoje" />}
      onRefresh={() =>
        Promise.all([
          gasto.refetch(),
          bills.refetch(),
          noCartao.refetch(),
          reminders.refetch(),
          budgets.refetch(),
          profile.refetch(),
          cycle.refetch(),
          atividade.refetch(),
          caminho.refetch(),
        ])
      }>
      <View style={styles.cabecalho}>
        <ThemedText type="caption" themeColor="textSecondary">
          {diaCurtoBR(hoje)}
        </ThemedText>
        {/* Sem nome (entrou por Phone OTP), a saudação some inteira em vez de virar "Bom dia,". */}
        {primeiroNome ? (
          <ThemedText type="title" style={styles.semEncolher}>
            {`${greetingBR()}, ${primeiroNome}`}
          </ThemedText>
        ) : null}
      </View>

      {gasto.isError ? (
        <ErrorCard onRetry={() => gasto.refetch()} />
      ) : (
        <HeroPanel
          surface="live"
          label={ateQuando ? `Livre até ${isoToBR(ateQuando)}` : 'Livre'}
          concealable
          value={<CountUpMoney cents={livre} variant="heroMoney" tone={livre < 0 ? 'onHeroDanger' : 'onHero'} />}
          secondary={veredito}
          chart={gasto.data ? <RunwayBar pista={pista} ate={ateQuando ?? hoje} entrada={proximaEntrada} /> : undefined}
          footer={
            cycle.data?.ate ? (
              <View style={styles.rodapeHeroi}>
                <ThemedText type="footnote" themeColor="onHeroMuted" style={styles.shrink}>
                  {`Compromissos até ${isoToBR(cycle.data.ate)}`}
                </ThemedText>
                <Money cents={comprometidoNoCiclo} variant="ticker" tone="onHero" concealable />
              </View>
            ) : undefined
          }
          onPress={abrirMenu}
        />
      )}

      {/* Os contadores só existem quando algum conta alguma coisa (badge é contagem real, §8). */}
      {contas.length + lembretes.length + apertados.length > 0 ? (
        <TileRow>
          <Tile
            compact
            label="Vencendo"
            value={<Contagem valor={contas.length} tom={atrasados.some((i) => i.kind !== 'income') ? 'danger' : 'text'} />}
            accessibilityLabel={`Vencendo: ${contas.length}`}
            onPress={() => router.push('/finance/transactions')}
          />
          <Tile
            compact
            label="Lembretes"
            value={<Contagem valor={lembretes.length} tom="warning" />}
            accessibilityLabel={`Lembretes: ${lembretes.length}`}
            onPress={() => router.push('/reminders')}
          />
          <Tile
            compact
            label="No limite"
            value={<Contagem valor={budgets.isError ? null : apertados.length} tom="warning" />}
            accessibilityLabel={budgets.isError ? 'No limite: não deu para carregar' : `No limite: ${apertados.length}`}
            onPress={() => router.push('/finance/budgets')}
          />
        </TileRow>
      ) : null}

      {mostrarPassos ? (
        <Bloco>
          <SetupChecklist
            passos={setup.passos}
            onOpen={(p) => router.push(p.href)}
            onHide={() => esconderPassos(true)}
          />
        </Bloco>
      ) : null}

      <AgentPrompt onPress={() => router.push('/agent/new')} />

      {bills.isError ? (
        <Bloco>
          <BlockHeader title="Agora" voice="app" />
          <ErrorCard onRetry={() => bills.refetch()} />
        </Bloco>
      ) : agenda.agora.length > 0 ? (
        <Bloco>
          <BlockHeader title="Agora" voice="app" count={agenda.agora.length} />
          <View>
            {atrasados.length > 0 ? (
              <DayRail label="atrasado" tone="danger" last={doDia.length === 0}>
                {atrasados.map((i) => itemDaAgenda(i, 'agora'))}
              </DayRail>
            ) : null}
            {doDia.length > 0 ? (
              <DayRail label="hoje" last>
                {doDia.map((i) => itemDaAgenda(i, 'agora'))}
              </DayRail>
            ) : null}
          </View>
        </Bloco>
      ) : null}

      {/*
        A Conversa: o texto REAL que a pessoa mandou, com o registro que ele virou. Só o que ela
        mesma disse (o RPC filtra pelo chamador); sem fala nenhuma, o bloco não existe.
      */}
      {atividade.isError ? (
        <Bloco>
          <BlockHeader title="Conversa" />
          <ErrorCard onRetry={() => atividade.refetch()} />
        </Bloco>
      ) : pares.length > 0 ? (
        <Bloco>
          <BlockHeader title="Conversa" action={{ label: 'Agente', onPress: () => router.push('/agent') }} />
          <ConversationFeed
            pares={pares}
            onOpenRecord={(d) => router.push(d as Href)}
            onOpenConversation={(id) => router.push({ pathname: '/agent/[id]', params: { id } })}
          />
        </Bloco>
      ) : null}

      {reminders.isError ? (
        <Bloco>
          <BlockHeader title="Lembretes" />
          <ErrorCard onRetry={() => reminders.refetch()} />
        </Bloco>
      ) : lembretes.length > 0 ? (
        <Bloco>
          <BlockHeader
            title="Lembretes"
            count={lembretes.length}
            action={{ label: 'Todos', onPress: () => router.push('/reminders') }}
          />
          <ReminderTimeline
            lembretes={lembretes}
            agora={agora}
            onOpen={(id) => router.push({ pathname: '/reminder-form', params: { id } })}
          />
        </Bloco>
      ) : null}

      {noCartao.isError ? (
        <Bloco>
          <BlockHeader title="Próximos dias" voice="app" />
          <ErrorCard onRetry={() => noCartao.refetch()} />
        </Bloco>
      ) : agenda.proximos.length > 0 ? (
        <Bloco>
          <BlockHeader title="Próximos dias" voice="app" />
          <View>
            {agenda.proximos.map((g, indice) => (
              <DayRail
                key={g.day}
                label={rotuloDoDia(g.day, hoje)}
                tone={g.itens.every((i) => i.kind === 'income') ? 'success' : 'neutral'}
                last={indice === agenda.proximos.length - 1}>
                {g.itens.map((i) => itemDaAgenda(i, 'proximos'))}
              </DayRail>
            ))}
          </View>
        </Bloco>
      ) : null}

      {budgets.isError ? (
        <Bloco>
          <BlockHeader title="No limite" />
          <ErrorCard onRetry={() => budgets.refetch()} />
        </Bloco>
      ) : apertados.length > 0 ? (
        <Bloco>
          <BlockHeader
            title="No limite"
            count={apertados.length}
            action={{ label: 'Orçamentos', onPress: () => router.push('/finance/budgets') }}
          />
          <BudgetRings itens={apertados} onPress={() => router.push('/finance/budgets')} />
        </Bloco>
      ) : null}

      {/* O dia calmo é o ÚLTIMO filho: não tem como aparecer acima de conteúdo nem se a regra errar. */}
      {diaCalmo ? (
        <View style={styles.calmo}>
          <Icon name="checkmark.circle" size="sm" color="success" />
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.shrink}>
            {proximaEntrada
              ? `Nada vence hoje · entra dinheiro ${isoToBR(proximaEntrada).slice(0, 5)}`
              : 'Nada vence nos próximos dias'}
          </ThemedText>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  shrink: { flex: 1, minWidth: 0 },
  semEncolher: { flexShrink: 0, maxWidth: '100%' },
  cabecalho: { gap: Space.xs },
  bloco: { gap: Space.md },
  rodapeHeroi: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.lg,
  },
  linhaEsqueleto: { flexDirection: 'row', justifyContent: 'space-between' },
  calmo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    paddingVertical: Space.sm,
  },
});
