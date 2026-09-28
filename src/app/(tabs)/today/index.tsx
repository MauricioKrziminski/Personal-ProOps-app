import { router } from 'expo-router';
import { Fragment, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { ErrorCard } from '@/components/error-card';
import { AgendaItem, LinhaDoAtrasado } from '@/components/feed/agenda-item';
import { DinheiroDoDia } from '@/components/feed/dinheiro-do-dia';
import { AgoraLinha, GrupoDoDia, RotuloNoGrupo } from '@/components/feed/grupo-do-dia';
import { LinhaDeLembrete } from '@/components/feed/lembrete-do-dia';
import { NotasDaHoje } from '@/components/feed/notas-da-hoje';
import { ProximoPassoCard } from '@/components/feed/proximo-passo';
import { SetupChecklist } from '@/components/feed/setup-checklist';
import { TodayTabletCanvas } from '@/components/feed/today-tablet-canvas';
import { useConfirmarBaixa } from '@/components/finance/confirmar-baixa';
import { transicaoDeLayout } from '@/components/motion/transicao';
import { ThemedText } from '@/components/themed-text';
import { AppHeader, HeaderIconButton } from '@/components/ui/app-header';
import { BlockHeader } from '@/components/ui/block-header';
import { useBRL } from '@/components/ui/conceal';
import { Dica } from '@/components/ui/dica';
import { ExtendedFab } from '@/components/ui/extended-fab';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { Skeleton, SkeletonList } from '@/components/ui/skeleton';
import { VerMais } from '@/components/ui/ver-mais';
import { Motion, Radius, Space } from '@/design/tokens';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { useAgora } from '@/hooks/use-agora';
import { useBoolPref } from '@/hooks/use-bool-pref';
import { usarDica } from '@/hooks/use-dicas';
import {
  useAccountBalances,
  useBudgetsStatus,
  useCycle,
  useSpendable,
  useTransactionsSummary,
  useUpcomingBills,
  useUpcomingCardCharges,
} from '@/hooks/use-finance';
import { localISODate, useTodayReminders } from '@/hooks/use-items';
import { useNoteFolders, useNotesList } from '@/hooks/use-notes';
import { useProfile } from '@/hooks/use-profile';
import { useProximoPasso } from '@/hooks/use-proximo-passo';
import { useSession } from '@/hooks/use-session';
import { useSetupProgress } from '@/hooks/use-setup-progress';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { caixaDasContas } from '@/lib/account-cash';
import { PASSO } from '@/lib/aos-poucos';
import { orcamentosApertados } from '@/lib/budget-tight';
import { diaCurtoBR, diasAte, greetingBR, isoToBR, rotuloDoDia } from '@/lib/dates';
import { showItemActions } from '@/lib/item-actions';
import { settleLabel } from '@/lib/settle-labels';
import {
  agendaDoDia,
  iconeDoItem,
  linhasDoDia,
  metaDoItem,
  separarLembretes,
  type ItemDaAgenda,
} from '@/lib/today-sections';
import { diasDoCiclo, painelDoDia, ritmoDoDia } from '@/lib/today-spend';

/**
 * A Hoje — "o dia" (spec `2026-09-28-hoje-o-dia-design.md`).
 *
 * ⚠️ **Ela deixou de ser um segundo Financeiro.** As duas telas abriam no mesmo bloco de tinta com
 * o MESMO número (sem receita prevista, o "livre até o fim do ciclo" é o resultado do ciclo),
 * seguidas dos mesmos ladrilhos e dos mesmos anéis de orçamento. A pesquisa do nicho (Things,
 * Structured, Fantastical, Todoist, Nubank) ancora a tela inicial no TEMPO:
 *
 * | # | bloco | por quê |
 * |---|---|---|
 * | 1 | saudação e data | o dia de quem abre |
 * | 2 | primeiros passos | só para quem está começando |
 * | 3 | **Seu dia** | o atrasado numa linha, o que vence/chega hoje e os lembretes com o AGORA |
 * | 4 | **o dinheiro do dia** | quanto cabe por dia, o que saiu hoje, quanto há em conta |
 * | 5 | próximos dias | a semana, uma linha por compromisso |
 * | 6 | notas | as fixadas (ou as últimas) — notas são metade do produto |
 *
 * O Financeiro continua sendo "como o ciclo fecha"; aqui, nada é número de ciclo no topo.
 */

/** Bloco que some sem dar tranco no resto (§5: mudança de estado). A entrada é do `Screen`. */
function Bloco({ children }: { children: React.ReactNode }) {
  return (
    <Animated.View style={styles.bloco} layout={transicaoDeLayout} exiting={FadeOut.duration(Motion.duration.exit)}>
      {children}
    </Animated.View>
  );
}

/**
 * O cabeçalho da Hoje, o mesmo no esqueleto e na tela pronta (o botão não surge do nada quando a
 * tela termina de carregar). A busca global (`/search`) é daqui: a Hoje é a raiz, e daqui se
 * procura em lançamentos, notas e lembretes de uma vez.
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
  // O relógio anda: o AGORA e o "em 2 h" não ficam presos na hora em que a aba abriu.
  const agora = useAgora();
  const hoje = localISODate(new Date(agora));

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
  const saldos = useAccountBalances();
  const notas = useNotesList({ sort: 'recentes' });
  const pastas = useNoteFolders();
  const setup = useSetupProgress();
  const proximo = useProximoPasso(session?.user?.id);
  const [passosEscondidos, esconderPassos] = useBoolPref(`hoje:passos-escondidos:${session?.user?.id ?? ''}`);
  // "Paguei"/"Recebi" confirma o valor numa folha curta antes da baixa (25/09/2026).
  const baixa = useConfirmarBaixa();
  /*
    O que saiu HOJE e o que saiu no ciclo até hoje: duas fatias da mesma leitura, e é a segunda
    que dá a régua ("sua média"). A do ciclo só liga quando a borda chega — buscar com um palpite
    de início daria o ritmo de outro período sob o rótulo deste.
  */
  const saiuHoje = useTransactionsSummary(hoje, hoje);
  const saiuNoCiclo = useTransactionsSummary(cycle.data?.de ?? hoje, hoje, Boolean(cycle.data?.de));

  const [atrasadosAbertos, setAtrasadosAbertos] = useState(false);
  const [limiteDoAtrasado, setLimiteDoAtrasado] = useState(PASSO);
  const [contasAbertas, setContasAbertas] = useState(false);

  const caixa = Number(gasto.data?.caixa ?? 0);
  const comprometido = Number(gasto.data?.comprometido_ate_entrada ?? 0);
  const proximaEntrada = gasto.data?.proxima_entrada ?? null;
  const livre = caixa - comprometido;
  /** Até quando o "livre" vale: a próxima entrada, ou o fim do ciclo se não houver nenhuma. */
  const ateQuando = proximaEntrada ?? cycle.data?.ate ?? null;
  const diasLivres = Math.max(1, ateQuando ? diasAte(ateQuando, hoje) : (cycle.data?.diasAteOFim ?? 1));
  const painel = painelDoDia({ livreCents: livre, diasLivres, ate: ateQuando, entrada: proximaEntrada, brl });

  const agenda = useMemo(
    () => agendaDoDia(bills.data ?? [], noCartao.data ?? [], hoje),
    [bills.data, noCartao.data, hoje]
  );
  const atrasados = agenda.agora.filter((i) => i.atrasado);
  const doDia = agenda.agora.filter((i) => !i.atrasado);
  const lembretes = useMemo(() => separarLembretes(reminders.data ?? [], hoje), [reminders.data, hoje]);
  const linhas = linhasDoDia({ atrasados, atrasadosAbertos, limiteDoAtrasado, doDia, lembretes, agora });
  const apertados = useMemo(() => orcamentosApertados(budgets.data ?? []), [budgets.data]);

  /* `isError` e não só `data`: o TanStack guarda o resultado anterior quando o refetch falha. */
  const emConta = useMemo(() => caixaDasContas(saldos.isError ? [] : (saldos.data ?? [])), [saldos.isError, saldos.data]);
  const soma = (resumo: { kind: string; total_cents: number | string }[] | undefined, lado: string) =>
    (resumo ?? []).filter((l) => l.kind === lado).reduce((t, l) => t + Number(l.total_cents), 0);
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
  const legendaDeHoje =
    [
      ritmo.media === null ? null : `${ritmo.acima ? 'acima' : 'abaixo'} da média de ${brl(ritmo.media)}/dia`,
      entrouHoje > 0 ? `entrou ${brl(entrouHoje)}` : null,
    ]
      .filter(Boolean)
      .join(' · ') || undefined;

  /** As fixadas; sem nenhuma, as mexidas por último. Uma prévia, não a lista: "Todas" leva a ela. */
  const todasAsNotas = useMemo(() => notas.data?.pages.flat() ?? [], [notas.data]);
  const fixadas = todasAsNotas.filter((n) => n.pinned);
  const notasDaHoje = (fixadas.length > 0 ? fixadas : todasAsNotas).slice(0, 8);
  const corDasPastas = useMemo(() => new Map((pastas.data ?? []).map((p) => [p.id, p.color])), [pastas.data]);

  const mostrarPassos = setup.pronto && !passosEscondidos && setup.passos.some((p) => !p.feito);
  /** O Seu dia só afirma "nada" com as DUAS respostas na mão. */
  const diaCalmo = bills.isSuccess && reminders.isSuccess && linhas.length === 0;
  const proximoCompromisso = agenda.proximos[0]?.itens[0] ?? null;

  /*
    O PORTÃO DA TELA: a Hoje abre inteira ou não abre. `profile` pode nascer desligada e mesmo
    assim entra — `telaPronta` lê `fetchStatus`.
  */
  const pronta = useTelaPronta(
    cycle, profile, gasto, bills, noCartao, reminders, budgets, saldos, saiuHoje, saiuNoCiclo, notas, pastas,
    ...setup.consultas, ...proximo.consultas,
  );

  /*
    `debt` é a prestação de um financiamento e `ref_id` é o id da DÍVIDA: dar baixa de
    lançamento nele não acharia nada. Fatura e dívida vão para a própria tela.
  */
  const acaoDoItem = (i: ItemDaAgenda): React.ComponentProps<typeof AgendaItem>['action'] => {
    if (i.kind === 'card') return undefined;
    if (i.kind === 'invoice') {
      return { label: 'Pagar fatura', icon: 'checkmark', onPress: () => router.push({ pathname: '/finance/invoice/[id]', params: { id: i.ref_id } }) };
    }
    if (i.kind === 'debt') {
      const id = i.ref_id;
      return { label: 'Ver dívida', icon: 'chevron.right', onPress: () => router.push({ pathname: '/finance/debts', params: { id } }) };
    }
    return {
      label: settleLabel(i.kind === 'income' ? 'income' : 'expense'),
      icon: 'checkmark',
      onPress: () => baixa.abrir(i.ref_id),
    };
  };

  /**
   * Toda linha ABRE o que ela é: o lançamento (quando a conta veio diferente do previsto — "a luz
   * veio 180" — é ali que se corrige antes da baixa), a fatura, a dívida. A compra no cartão abre a
   * fatura em que ela vai cair.
   */
  const abrirItem = (i: ItemDaAgenda) => () => {
    if (i.kind === 'card' && i.faturaId) {
      router.push({ pathname: '/finance/invoice/[id]', params: { id: i.faturaId } });
    } else if (i.kind === 'invoice') {
      router.push({ pathname: '/finance/invoice/[id]', params: { id: i.ref_id } });
    } else if (i.kind === 'debt') {
      router.push({ pathname: '/finance/debts', params: { id: i.ref_id } });
    } else {
      router.push({ pathname: '/finance/[txId]', params: { txId: i.ref_id } });
    }
  };

  /** No Seu dia a linha resolve (Paguei, Pagar fatura…); nos próximos dias ela só abre. */
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
        action={onde === 'agora' ? acaoDoItem(i) : undefined}
        onPress={abrirItem(i)}
      />
    );
  };

  const abrirLembrete = (id: string) => router.push({ pathname: '/reminder-form', params: { id, ocorrencia: '1' } });

  /*
    O toque no número do dinheiro abre o MENU (o mesmo do herói antigo e do Financeiro). `mes` e
    `view` saem do próprio `cycle.data`, nunca de um default — o destino tem que mostrar o período
    que a tela nomeou (`finance.md`).
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
          <Skeleton width="60%" height={28} />
          <Skeleton width="28%" height={12} />
        </View>
        <SkeletonList linhas={3} />
        <Skeleton height={176} radius={Radius.md} />
        <SkeletonList linhas={2} />
      </Screen>
    );
  }

  const saudacaoBlock = (
    <View style={styles.cabecalho}>
      {primeiroNome ? (
        <ThemedText type="title" style={styles.semEncolher}>
          {`${greetingBR()}, ${primeiroNome}`}
        </ThemedText>
      ) : null}
      <ThemedText type="caption" themeColor="textSecondary">{diaCurtoBR(hoje)}</ThemedText>
    </View>
  );

  const passosBlock = (
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
    </>
  );

  const diaBlock = (
    <Bloco>
      <BlockHeader
        title="Seu dia"
        voice="app"
        action={{ label: 'Lembretes', accessibilityLabel: 'Ver todos os lembretes', onPress: () => router.push('/reminders') }}
      />
      {/* Cada leitura tem o seu erro (§7): contas e lembretes falham separados. */}
      {bills.isError ? <ErrorCard onRetry={() => bills.refetch()} /> : null}
      {reminders.isError ? <ErrorCard onRetry={() => reminders.refetch()} /> : null}
      {linhas.length > 0 || diaCalmo ? (
        <GrupoDoDia>
          {linhas.map((l) => {
            if (l.tipo === 'resumo') {
              return (
                <LinhaDoAtrasado
                  key={l.chave}
                  resumo={l.resumo}
                  aberto={l.aberto}
                  onAlternar={() => setAtrasadosAbertos((v) => !v)}
                />
              );
            }
            if (l.tipo === 'item') return itemDaAgenda(l.item, 'agora');
            if (l.tipo === 'verMais') {
              return (
                <View key={l.chave} style={styles.verMais}>
                  <VerMais restantes={l.restantes} onPress={() => setLimiteDoAtrasado((n) => n + PASSO)} />
                </View>
              );
            }
            if (l.tipo === 'agora') return <AgoraLinha key={l.chave} agora={agora} />;
            return (
              <LinhaDeLembrete key={l.chave} lembrete={l.lembrete} estado={l.estado} agora={agora} onOpen={abrirLembrete} />
            );
          })}
          {diaCalmo ? (
            <View style={styles.calmo}>
              <Icon name="checkmark.circle" size="md" color="success" />
              <View style={styles.shrink}>
                <ThemedText type="default">Nada para hoje</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {proximoCompromisso
                    ? `${rotuloDoDia(proximoCompromisso.day, hoje)}: ${proximoCompromisso.title}`
                    : proximaEntrada
                      ? `entra dinheiro ${isoToBR(proximaEntrada).slice(0, 5)}`
                      : 'nada vence nos próximos dias'}
                </ThemedText>
              </View>
            </View>
          ) : null}
        </GrupoDoDia>
      ) : null}
    </Bloco>
  );

  const dinheiroBlock = gasto.isError ? (
    <Bloco>
      <ErrorCard onRetry={() => gasto.refetch()} />
    </Bloco>
  ) : (
    <Bloco>
      <View style={styles.comDica}>
        <DinheiroDoDia
          painel={painel}
          onAbrirMenu={abrirMenu}
          hoje={saiuHoje.isError ? null : { saiu: ritmo.hoje, legenda: legendaDeHoje }}
          onAbrirHoje={() => router.push('/finance/transactions')}
          caixa={saldos.isError ? null : emConta}
          contasAbertas={contasAbertas}
          onAlternarContas={() => setContasAbertas((v) => !v)}
          onAbrirConta={(l) =>
            router.push(
              l.id
                ? { pathname: '/finance/transactions', params: { accountId: l.id } }
                : '/finance/transactions'
            )
          }
          apertados={apertados}
          onAbrirOrcamentos={() => router.push('/finance/budgets')}
        />
        {/* Sem saldos a tela não afirma saldo nenhum: o erro, e o "Tentar de novo" só dos saldos. */}
        {saldos.isError ? <ErrorCard onRetry={() => saldos.refetch()} /> : null}
        <Dica id="hoje-painel" tela="hoje" />
        {contasAbertas ? <Dica id="conta-extrato" tela="hoje" /> : null}
      </View>
    </Bloco>
  );

  const proximosBlock = noCartao.isError ? (
    <Bloco>
      <BlockHeader title="Próximos dias" voice="app" />
      <ErrorCard onRetry={() => noCartao.refetch()} />
    </Bloco>
  ) : agenda.proximos.length > 0 ? (
    <Bloco>
      <BlockHeader title="Próximos dias" voice="app" />
      <GrupoDoDia>
        {agenda.proximos.flatMap((g) => [
          <RotuloNoGrupo key={`dia:${g.day}`} texto={rotuloDoDia(g.day, hoje)} />,
          ...g.itens.map((i) => itemDaAgenda(i, 'proximos')),
        ])}
      </GrupoDoDia>
    </Bloco>
  ) : null;

  const notasBlock = notas.isError ? (
    <Bloco>
      <BlockHeader title="Notas" />
      <ErrorCard onRetry={() => notas.refetch()} />
    </Bloco>
  ) : notasDaHoje.length > 0 ? (
    <Bloco>
      <BlockHeader
        title={fixadas.length > 0 ? 'Fixadas' : 'Notas recentes'}
        action={{ label: 'Todas', accessibilityLabel: 'Ver todas as notas', onPress: () => router.push('/notes') }}
      />
      <NotasDaHoje
        notas={notasDaHoje}
        corDaPasta={(id) => (id ? (corDasPastas.get(id) ?? null) : null)}
        onOpen={(id) => router.push({ pathname: '/notes/[id]', params: { id } })}
      />
    </Bloco>
  ) : null;

  return (
    <Screen
      stagger
      wide={tablet}
      topBar={<CabecalhoDaHoje />}
      overlay={
        <>
          {baixa.folha}
          {/* Criar ONDE se vê o dia (25/09/2026): a Hoje mostra lançamentos, lembretes e notas. */}
          <ExtendedFab
            label="Lançar"
            icon="plus"
            onPress={() =>
              showItemActions('Lançar', [
                { label: 'Gasto ou receita', onPress: () => router.push('/finance/transaction-form') },
                { label: 'Lembrete', onPress: () => router.push('/reminder-form') },
                { label: 'Nota', onPress: () => router.push('/notes/new') },
              ])
            }
          />
        </>
      }
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
          notas.refetch(),
          pastas.refetch(),
        ])
      }>
      {tablet ? (
        <TodayTabletCanvas
          saudacao={saudacaoBlock}
          passos={passosBlock}
          dia={diaBlock}
          dinheiro={dinheiroBlock}
          proximos={proximosBlock}
          notas={notasBlock}
        />
      ) : (
        [
          <Fragment key="saudacao">{saudacaoBlock}</Fragment>,
          <Fragment key="passos">{passosBlock}</Fragment>,
          <Fragment key="dia">{diaBlock}</Fragment>,
          <Fragment key="dinheiro">{dinheiroBlock}</Fragment>,
          <Fragment key="proximos">{proximosBlock}</Fragment>,
          <Fragment key="notas">{notasBlock}</Fragment>,
        ]
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  shrink: { flex: 1, minWidth: 0, gap: Space.half },
  semEncolher: { flexShrink: 0, maxWidth: '100%' },
  cabecalho: { gap: Space.xs },
  bloco: { gap: Space.md },
  /** A dica encosta no que ela explica — mais perto que o `gap` entre blocos. */
  comDica: { gap: Space.sm },
  verMais: { paddingBottom: Space.sm },
  calmo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
});
