import { vereditoDoDia } from '@/lib/widget-snapshot';
import { router } from 'expo-router';
import { Fragment, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { ErrorCard } from '@/components/error-card';
import { AgendaItem } from '@/components/feed/agenda-item';
import { ReminderTimeline } from '@/components/feed/reminder-timeline';
import { ProximoPassoCard } from '@/components/feed/proximo-passo';
import { VerMais } from '@/components/ui/ver-mais';
import { useJanelasPorGrupo } from '@/hooks/use-aos-poucos';
import { SetupChecklist } from '@/components/feed/setup-checklist';
import { TodaySignals, type TodaySignal } from '@/components/feed/today-signals';
import { TodayTabletCanvas } from '@/components/feed/today-tablet-canvas';
import { BudgetRings } from '@/components/finance/budget-rings';
import { CashAccounts } from '@/components/finance/cash-accounts';
import { ThemedText } from '@/components/themed-text';
import { AppHeader, HeaderIconButton } from '@/components/ui/app-header';
import { BlockHeader } from '@/components/ui/block-header';
import { Dica } from '@/components/ui/dica';
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
import { Motion, Radius, Space } from '@/design/tokens';
import { useBoolPref } from '@/hooks/use-bool-pref';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import {
  useAccountBalances,
  useBudgetsStatus,
  useCycle,
  useSpendable,
  useSpendablePath,
  useTransactionsSummary,
  useUpcomingBills,
  useUpcomingCardCharges,
} from '@/hooks/use-finance';
import { localISODate, useTodayReminders } from '@/hooks/use-items';
import { useProfile } from '@/hooks/use-profile';
import { useSession } from '@/hooks/use-session';
import { usarDica } from '@/hooks/use-dicas';
import { useProximoPasso } from '@/hooks/use-proximo-passo';
import { useSetupProgress } from '@/hooks/use-setup-progress';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { caixaDasContas, type LinhaDeCaixa } from '@/lib/account-cash';
import { orcamentosApertados } from '@/lib/budget-tight';
import { diaCurtoBR, diasAte, greetingBR, isoToBR, rotuloDoDia } from '@/lib/dates';
import { showItemActions } from '@/lib/item-actions';
import { montarPista } from '@/lib/runway';
import { settleLabel } from '@/lib/settle-labels';
import { useConfirmarBaixa } from '@/components/finance/confirmar-baixa';
import { agendaDoDia, iconeDoItem, metaDoItem, type ItemDaAgenda } from '@/lib/today-sections';
import { diasDoCiclo, ritmoDoDia } from '@/lib/today-spend';
import { transicaoDeLayout } from '@/components/motion/transicao';

/**
 * A Hoje — "Conversa organizada" (spec 2026-09-17).
 *
 * A ordem é de URGÊNCIA: quanto dá para gastar, o que exige ação, o que já saiu hoje, quanto
 * existe em conta, e só então o que vem.
 *
 * ⚠️ **A "Conversa" e o card "Diga ao agente" saíram em 17/09/2026**, a pedido do dono do
 * produto (*"ficou horrível… troque as seções pra algo que realmente faça sentido, informações
 * úteis"*). Os dois eram os únicos blocos que não respondiam pergunta nenhuma: um repetia de
 * volta o texto que a pessoa acabou de mandar, o outro anunciava uma aba que já existe na dock.
 * No lugar entraram as duas perguntas que ela faz todo dia e a Hoje não respondia — **quanto já
 * saiu hoje** e **quanto tem em conta agora**. A citação da fala continua, onde ela informa: na
 * linha do lançamento, no Financeiro.
 *
 * O herói NÃO repete o Financeiro: aqui é "quanto dá para gastar até entrar dinheiro de novo"
 * (`caixa − comprometido_ate_entrada`); lá é "como o ciclo fecha". A identidade que amarra os
 * dois está em `supabase/tests/da_para_gastar.sql`.
 */

const linear = transicaoDeLayout;

/** Bloco que some sem dar tranco no resto (§5: mudança de estado). A entrada é do `Screen`. */
function Bloco({ children }: { children: React.ReactNode }) {
  return (
    <Animated.View style={styles.bloco} layout={linear} exiting={FadeOut.duration(Motion.duration.exit)}>
      {children}
    </Animated.View>
  );
}

/**
 * O cabeçalho da Hoje, o mesmo no esqueleto e na tela pronta (o botão não surge do nada quando a
 * tela termina de carregar). A busca global (`/search`) existia sem porta nenhuma no app
 * (24/09/2026): a Hoje é a raiz, e daqui se procura em lançamentos, notas e lembretes de uma vez.
 */
function CabecalhoDaHoje() {
  return (
    <AppHeader
      title="Hoje"
      action={<HeaderIconButton icon="magnifyingglass" label="Buscar em tudo" onPress={() => router.push('/search')} />}
    />
  );
}

export default function TodayScreen() {
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  // Dinheiro no meio de frase obedece ao "esconder saldo" — `Money` não cabe em texto corrido.
  const brl = useBRL();
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
  const proximo = useProximoPasso(session?.user?.id);
  const [passosEscondidos, esconderPassos] = useBoolPref(`hoje:passos-escondidos:${session?.user?.id ?? ''}`);
  // "Paguei"/"Recebi" confirma o valor numa folha curta antes da baixa (25/09/2026).
  const baixa = useConfirmarBaixa();
  const caminho = useSpendablePath();
  const saldos = useAccountBalances();
  /*
    O que saiu HOJE e o que saiu no ciclo até hoje: duas fatias da mesma leitura, e é a segunda
    que dá a régua ("seu ritmo"). A do ciclo só liga quando a borda chega — buscar com um palpite
    de início daria o ritmo de outro período sob o rótulo deste.
  */
  const saiuHoje = useTransactionsSummary(hoje, hoje);
  const saiuNoCiclo = useTransactionsSummary(cycle.data?.de ?? hoje, hoje, Boolean(cycle.data?.de));

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
  // Aos poucos (24/09/2026): o atrasado não tem data mínima e podia encher a Hoje inteira.
  const janelas = useJanelasPorGrupo('');
  const jAtrasados = janelas.janelaDe('atrasados', atrasados);
  const jDoDia = janelas.janelaDe('doDia', doDia);
  /** O contador "Vencendo" e o badge são SÓ de despesa (receita prevista não vence). */
  const contas = (bills.data ?? []).filter((b) => b.kind !== 'income');
  const lembretes = reminders.data ?? [];
  const apertados = useMemo(() => orcamentosApertados(budgets.data ?? []), [budgets.data]);

  /* `isError` e não só `data`: o TanStack guarda o resultado anterior quando o refetch falha. */
  const emConta = useMemo(() => caixaDasContas(saldos.isError ? [] : (saldos.data ?? [])), [saldos.isError, saldos.data]);
  const soma = (linhas: { kind: string; total_cents: number | string }[] | undefined, lado: string) =>
    (linhas ?? []).filter((l) => l.kind === lado).reduce((t, l) => t + Number(l.total_cents), 0);
  const entrouHoje = soma(saiuHoje.data, 'income');
  const ritmo = useMemo(
    () =>
      ritmoDoDia({
        hojeCents: soma(saiuHoje.data, 'expense'),
        cicloCents: soma(saiuNoCiclo.data, 'expense'),
        diasDecorridos: cycle.data?.de ? diasDoCiclo(cycle.data.de, hoje) : 1,
      }),
    [saiuHoje.data, saiuNoCiclo.data, cycle.data?.de, hoje]
  );

  /*
    A segunda linha do herói é o VEREDITO DO DIA: obrigação (devo alguma coisa?) ganha de
    permissão (posso gastar?). "Por dia" some abaixo de R$ 1,00 — um número ridículo no lugar
    mais nobre da tela ensina a pessoa a não ler a linha.
  */
  const atrasadoCents = atrasados.filter((i) => i.kind !== 'income').reduce((s, i) => s + i.cents, 0);
  const venceHojeCents = doDia.filter((i) => i.kind !== 'income').reduce((s, i) => s + i.cents, 0);
  // A MESMA frase dos widgets (`vereditoDoDia`, `lib/widget-snapshot.ts`).
  const doVeredito = vereditoDoDia({
    atrasadoCents, venceHojeCents, livreCents: livre, diasLivres, brl,
  });
  const veredito: { icon: React.ComponentProps<typeof Icon>['name']; negative: boolean; text: string } =
    { icon: doVeredito.icone, negative: doVeredito.tom === 'perigo', text: doVeredito.texto };

  const mostrarPassos = setup.pronto && !passosEscondidos && setup.passos.some((p) => !p.feito);
  const diaCalmo =
    bills.isSuccess &&
    reminders.isSuccess &&
    agenda.agora.length === 0 &&
    agenda.proximos.length === 0 &&
    lembretes.length === 0;

  const vencidas = contas.filter((conta) => conta.overdue).length;
  const orcamentosEstourados = apertados.filter((item) => item.estourou).length;
  const sinais: TodaySignal[] = [
    ...(!bills.isError && contas.length > 0
      ? [{
          key: 'bills' as const,
          count: contas.length,
          label: 'Vencendo',
          detail: vencidas > 0 ? `${vencidas} ${vencidas === 1 ? 'atrasada' : 'atrasadas'}` : 'Próximos 7 dias',
          tone: vencidas > 0 ? 'danger' as const : 'text' as const,
          destination: 'lançamentos',
          onPress: () => router.push('/finance/transactions'),
        }]
      : []),
    ...(!reminders.isError && lembretes.length > 0
      ? [{
          key: 'reminders' as const,
          count: lembretes.length,
          label: 'Lembretes',
          detail: 'Para hoje',
          tone: 'text' as const,
          destination: 'lembretes',
          onPress: () => router.push('/reminders'),
        }]
      : []),
    ...(!budgets.isError && apertados.length > 0
      ? [{
          key: 'budgets' as const,
          count: apertados.length,
          label: 'No limite',
          detail: orcamentosEstourados > 0
            ? `${orcamentosEstourados} ${orcamentosEstourados === 1 ? 'atingiu' : 'atingiram'} o limite`
            : 'Perto do limite',
          tone: 'warning' as const,
          destination: 'orçamentos',
          onPress: () => router.push('/finance/budgets'),
        }]
      : []),
  ];

  /*
    O PORTÃO DA TELA (Fase 5 do redesenho anterior): a Hoje abre inteira ou não abre. `profile`
    pode nascer desligada e mesmo assim entra — `telaPronta` lê `fetchStatus`.
  */
  const pronta = useTelaPronta(
    cycle, profile, gasto, bills, noCartao, reminders, budgets, saldos, saiuHoje, saiuNoCiclo, caminho, ...setup.consultas,
    ...proximo.consultas,
  );

  const pay = (id: string) => baixa.abrir(id);

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
      onPress: () => pay(i.ref_id),
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
  const abrirMenu = () => {
    usarDica('hoje-painel');
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
  };

  if (!pronta) {
    return (
      <Screen wide={tablet} topBar={<CabecalhoDaHoje />}>
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

  const heroBlock = (
    <>
      <View style={styles.cabecalho}>
        {primeiroNome ? (
          <ThemedText type="title" style={styles.semEncolher}>
            {`${greetingBR()}, ${primeiroNome}`}
          </ThemedText>
        ) : null}
        <ThemedText type="caption" themeColor="textSecondary">{diaCurtoBR(hoje)}</ThemedText>
      </View>
      {gasto.isError ? (
        <ErrorCard onRetry={() => gasto.refetch()} />
      ) : (
        <View style={styles.comDica}>
        <HeroPanel
          surface="live"
          label={ateQuando ? `Livre até ${isoToBR(ateQuando)}` : 'Livre'}
          concealable
          value={<CountUpMoney cents={livre} variant="heroMoney" tone={livre < 0 ? 'onHeroDanger' : 'onHero'} />}
          secondary={veredito}
          chart={gasto.data ? <RunwayBar pista={pista} ate={ateQuando ?? hoje} entrada={proximaEntrada} /> : undefined}
          footer={cycle.data?.ate ? (
            <View style={styles.rodapeHeroi}>
              <ThemedText type="footnote" themeColor="onHeroMuted" style={styles.shrink}>
                Compromissos
              </ThemedText>
              <Money cents={comprometidoNoCiclo} variant="ticker" tone="onHero" concealable />
            </View>
          ) : undefined}
          onPress={abrirMenu}
        />
        <Dica id="hoje-painel" tela="hoje" />
        </View>
      )}
    </>
  );

  const signalsBlock = sinais.length > 0 ? <TodaySignals signals={sinais} /> : null;

  const pulseBlock = saiuHoje.isError ? null : (
    <TileRow>
      <Tile
        icon="arrow.up.right"
        label="Saiu hoje"
        value={<Money cents={ritmo.hoje} variant="money" tone="text" concealable />}
        caption={ritmo.media === null
          ? undefined
          : `${ritmo.acima ? 'acima' : 'abaixo'} de ${brl(ritmo.media)}/dia`}
        accessibilityLabel={`Saiu hoje: ${brl(ritmo.hoje)}`}
        onPress={() => router.push('/finance/transactions')}
      />
      <Tile
        icon="arrow.down.left"
        label="Entrou hoje"
        value={<Money cents={entrouHoje} variant="money" tone={entrouHoje > 0 ? 'success' : 'text'} concealable />}
        accessibilityLabel={`Entrou hoje: ${brl(entrouHoje)}`}
        onPress={() => router.push('/finance/transactions')}
      />
    </TileRow>
  );

  const actionsBlock = (
    <>
      {mostrarPassos ? (
        <Bloco>
          <SetupChecklist
            passos={setup.passos}
            onOpen={(p) => router.push(p.href)}
            onHide={() => esconderPassos(true)}
          />
        </Bloco>
      ) : null}
      {/*
        O Próximo passo espera os Primeiros passos: um card de descoberta por vez (23/09/2026).
        A projeção não tem dado que diga "já viu" — abrir é o que conta, então tocar dispensa.
      */}
      {setup.pronto && !mostrarPassos && proximo.passo ? (
        <Bloco>
          <ProximoPassoCard
            passo={proximo.passo}
            onAbrir={() => {
              const passo = proximo.passo!;
              if (passo.id === 'projecao') proximo.dispensar('projecao');
              router.push(passo.href);
            }}
            onDispensar={() => proximo.dispensar(proximo.passo!.id)}
          />
        </Bloco>
      ) : null}
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
                {jAtrasados.visiveis.map((i) => itemDaAgenda(i, 'agora'))}
              </DayRail>
            ) : null}
            {doDia.length > 0 ? (
              <DayRail label="hoje" last>
                {jDoDia.visiveis.map((i) => itemDaAgenda(i, 'agora'))}
              </DayRail>
            ) : null}
          </View>
          <VerMais restantes={jAtrasados.restantes} onPress={() => janelas.verMais('atrasados')} />
          <VerMais restantes={jDoDia.restantes} onPress={() => janelas.verMais('doDia')} />
        </Bloco>
      ) : null}
    </>
  );

  const accountsBlock = saldos.isError ? (
    <Bloco>
      <BlockHeader title="Nas contas" />
      <ErrorCard onRetry={() => saldos.refetch()} />
    </Bloco>
  ) : emConta.linhas.length > 0 ? (
    <Bloco>
      <BlockHeader
        title="Nas contas"
        action={{ label: 'Contas', onPress: () => router.push('/finance/accounts') }}
      />
      <Dica id="conta-extrato" tela="hoje" bico="baixo" />
      <CashAccounts
        caixa={emConta}
        onOpen={(l: LinhaDeCaixa) =>
          router.push(
            l.id
              ? { pathname: '/finance/transactions', params: { accountId: l.id } }
              : '/finance/transactions'
          )
        }
      />
    </Bloco>
  ) : null;

  const comingBlock = (
    <>
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
    </>
  );

  return (
    <Screen
      stagger
      wide={tablet}
      topBar={<CabecalhoDaHoje />}
      overlay={baixa.folha}
      onRefresh={() =>
        Promise.all([
          gasto.refetch(),
          bills.refetch(),
          noCartao.refetch(),
          reminders.refetch(),
          budgets.refetch(),
          profile.refetch(),
          cycle.refetch(),
          saldos.refetch(),
          saiuHoje.refetch(),
          saiuNoCiclo.refetch(),
          caminho.refetch(),
        ])
      }>
      {tablet ? (
        <TodayTabletCanvas
          hero={heroBlock}
          signals={signalsBlock}
          pulse={pulseBlock}
          actions={actionsBlock}
          accounts={accountsBlock}
          coming={comingBlock}
        />
      ) : (
        [
          <Fragment key="hero">{heroBlock}</Fragment>,
          <Fragment key="signals">{signalsBlock}</Fragment>,
          <Fragment key="pulse">{pulseBlock}</Fragment>,
          <Fragment key="actions">{actionsBlock}</Fragment>,
          <Fragment key="accounts">{accountsBlock}</Fragment>,
          <Fragment key="coming">{comingBlock}</Fragment>,
        ]
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  shrink: { flex: 1, minWidth: 0 },
  semEncolher: { flexShrink: 0, maxWidth: '100%' },
  cabecalho: { gap: Space.xs },
  /** A dica encosta no que ela explica — mais perto que o `gap` entre blocos. */
  comDica: { gap: Space.sm },
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
