
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import { useBRL } from '@/components/ui/conceal';
import { ThemedText } from '@/components/themed-text';
import { ErrorCard } from '@/components/error-card';
import { AppHeader } from '@/components/ui/app-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { HeroPanel } from '@/components/ui/hero-panel';
import { Screen } from '@/components/ui/screen';
import { CountUpMoney } from '@/components/ui/count-up-money';
import { SectionHead } from '@/components/ui/section-head';
import { Skeleton, SkeletonHero, SkeletonList } from '@/components/ui/skeleton';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { ProgressBar } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  useBudgetsStatus,
  useSpendable,
  useCycle,
  useMarkPaid,
  useRecentTransactions,
  useUpcomingBills,
  useUpcomingCardCharges,
} from '@/hooks/use-finance';
import { categoryIcon } from '@/design/category-icons';
import { formatDateBR, localISODate, useTodayReminders } from '@/hooks/use-items';
import { useProfile } from '@/hooks/use-profile';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { diasAte, greetingBR, isoToBR } from '@/lib/dates';
import { showItemActions } from '@/lib/item-actions';
import { settleDone, settleLabel } from '@/lib/settle-labels';
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
/** Uma instância só: `LinearTransition` recriado a cada render remonta a animação. */
const linear = LinearTransition.duration(Motion.duration.base);

/**
 * A linha de conta, animada — **um `Animated.View` POR FORA do `Pressable`**.
 *
 * ⚠️ **Não use `createAnimatedComponent(Pressable)` aqui.** O `Pressable` recebe `style` como
 * FUNÇÃO (`({ pressed }) => [...]`), e o componente animado não a aplica: o estilo simplesmente
 * não chega. Como `flexDirection: 'row'` mora nesse estilo, a linha virava COLUNA — título,
 * valor e botão empilhados, com o botão encostado na esquerda. Foi a queixa literal
 * (*"olha como está todo desorganizado esse card"*), e o print veio do iOS e do Android.
 *
 * ⚠️ E o pior: `uiautomator dump` continuava listando os três textos, só que em `bounds`
 * diferentes — conferir a PRESENÇA do texto deu verde num layout quebrado. Layout se confere por
 * geometria ou por imagem, nunca por "o texto está lá".
 *
 * O `Animated.View` por fora não muda o layout (é um bloco sem estilo dentro de uma `Secao` que
 * já espaça por `gap`) e carrega o que só existe em componente do Reanimated: `layout` e
 * `exiting`. A palavra é **mudança de estado** (§5) — você toca em "Paguei" e a linha some;
 * saída mais rápida que entrada, `duration.exit` contra `duration.base`.
 */
function LinhaAnimada({
  children,
  ...props
}: React.ComponentProps<typeof Pressable> & { children: React.ReactNode }) {
  return (
    <Animated.View layout={linear} exiting={FadeOut.duration(Motion.duration.exit)}>
      <Pressable {...props}>{children}</Pressable>
    </Animated.View>
  );
}

/**
 * Um bloco da Hoje, entrando escalonado.
 *
 * A palavra é **continuidade** (§5): a tela nasce com seis queries assentando em tempos
 * diferentes, e sem isto os blocos aparecem piscando fora de ordem. O `cap` do `Motion.stagger`
 * é o que impede o último bloco de esperar meio segundo — escalonar sem teto vira espera, não
 * ritmo.
 *
 * ⚠️ `layout` é o que faz a linha que SAI — você deu baixa numa conta — empurrar as de baixo em
 * vez de a lista dar um salto. Mesma classe de mudança de estado que §5 já exige animar em barra
 * e gráfico ("valor que salta é bug visual").
 */
function Secao({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    /*
      ⚠️ **A entrada saiu daqui e foi para o `Screen`** (Fase 5): a Hoje era a única tela que
      escalonava, com um passo próprio (30 ms) e contando um `index` que a tela tinha que
      manter à mão. Agora a cascata é do primitivo, vale para as oito telas e o passo é um só.
      O `layout` FICA: ele não é entrada, é o que faz uma seção que some não dar tranco na
      lista inteira.
    */
    <Animated.View style={styles.section} layout={linear}>
      {children}
    </Animated.View>
  );
}

export default function TodayScreen() {
  // Dinheiro no meio de frase obedece ao "esconder saldo" — `Money` não cabe em texto corrido.
  const brl = useBRL();
  const theme = useTheme();
  const toast = useToast();

  /**
   * A janela do painel é o CICLO do usuário, não o mês civil.
   *
   * Quem paga tudo no mesmo dia tem o ciclo cortado ao meio por "dia 1 a 31": o salário do dia
   * 20 cai num balde e a fatura que ele paga com esse salário, no seguinte. Quem sabe onde o
   * ciclo fecha é o banco (`cycle_now`); aqui só se lê. Enquanto ele não responde, o fim do mês
   * civil é o palpite certo — é o que vale para quem não configurou nada.
   */
  const cycle = useCycle();
  /*
    ⚠️ **A projeção diária saiu daqui** (13/09/2026). `useCashFlowForecast(daysLeft)` era a
    leitura mais cara desta tela — um JSON de N dias, mais o motor de projeção inteiro — e depois
    do redesenho ela só alimentava `isLoading` e uma soma que `spendable` já devolve pronta.
    `useAccountBalances` saiu junto: ela somava `cleared_cents` das contas não-cartão, que é
    `private.cash_total` REIMPLEMENTADO em TypeScript — e sem o termo de `account_id is null`,
    que `finance.md` registra como "zerava o caixa de quem só usa o WhatsApp" (bug da `0028`).
  */
  const daysLeft = cycle.data?.diasAteOFim ?? 1;

  const { session } = useSession();
  const profile = useProfile(session?.user?.id);
  /** Só o primeiro nome: "Bom dia, Gabriel Almeida Dias" é um crachá, não um cumprimento. */
  const firstName = profile.data?.display_name?.trim().split(/\s+/)[0];

  const bills = useUpcomingBills(7);
  const reminders = useTodayReminders();
  const budgets = useBudgetsStatus();
  const recent = useRecentTransactions(5);
  /*
    ⚠️ **LIMITADO de propósito, e o limite é o produto.** A fatura do Nubank tem dezenas de
    linhas; despejá-las aqui faria a Hoje virar o extrato do cartão. Quatro é o que cabe sem
    empurrar "Lembretes" e "Passando do limite" para fora da primeira tela — e quem quer a lista
    inteira toca na linha e cai na fatura.
  */
  const noCartao = useUpcomingCardCharges(4);
  const markPaid = useMarkPaid();

  /*
    ⚠️ **O número grande é "quanto dá para gastar", não o resultado do ciclo.**

    Ele já foi o resultado do ciclo, e por isso as duas raízes diziam a MESMA coisa com rótulos
    diferentes — e a daqui ainda por cima lia o ciclo JÁ FECHADO (o mês do ciclo não é o mês
    civil; ver `useCycleMonth`). Hoje o Financeiro responde "como o ciclo fecha" e esta tela
    responde "quanto está livre até entrar dinheiro de novo": mesma base, janelas diferentes.
  */
  const gasto = useSpendable();
  const caixa = Number(gasto.data?.caixa ?? 0);
  const comprometido = Number(gasto.data?.comprometido_no_ciclo ?? 0);
  const aReceberNoCiclo = Number(gasto.data?.a_receber_no_ciclo ?? 0);
  const proximaEntrada = gasto.data?.proxima_entrada ?? null;
  const livre = caixa - Number(gasto.data?.comprometido_ate_entrada ?? 0);

  /** Até quando o "livre" vale: a próxima entrada, ou o fim do ciclo se não houver nenhuma. */
  const ateQuando = proximaEntrada ?? cycle.data?.ate ?? null;
  const diasLivres = Math.max(1, ateQuando ? diasAte(ateQuando) : (cycle.data?.diasAteOFim ?? 1));

  /*
    O denominador é TODO o dinheiro que passa pela mão neste ciclo — o que já está na conta mais
    o que ainda entra. Acima de 100% a barra satura e a frase muda (ver o `chart` abaixo): barra
    cheia com "110%" ao lado lê como defeito de render, não como aviso.
  */
  const totalDoCiclo = caixa + aReceberNoCiclo;
  const usado = totalDoCiclo > 0 ? comprometido / totalDoCiclo : 0;

  /**
   * Os dois números que o card passou a mostrar lado a lado, a pedido do dono do produto.
   *
   * `series[0]` é o dia 0 da projeção, e o dia 0 é `private.cash_total` — que filtra
   * `status='cleared'`. Ou seja: é o dinheiro que ele TEM, sem o Pix que não chegou. O
   * "a receber" é a soma de `in_cents` do resto do mês, que é justamente o que está fora
   * do primeiro número e dentro do último.
   */
  /*
    ⚠️ **`TENHO HOJE` é o dinheiro NA CONTA, sem abater fatura vencida.** Ele saía de `series[0]`,
    que é o caixa JÁ menos o que venceu e não foi pago — por isso a Hoje mostrava −370,92 onde o
    extrato do banco diz 0,72. Recusa explícita do dono do produto: *"o saldo na conta permanece
    exatamente na conta e o que faltou pagar continua faltando pagar"*.

    ⚠️ E é `cleared_cents`, não `balance_cents`: em conta de dinheiro o saldo honesto é o que já
    passou pela conta. `balance_cents` inclui previsto, que é o que o número de cima projeta.
  */

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

  /*
    ⚠️ **A segunda linha do herói é o VEREDITO DO DIA, não uma métrica fixa.**

    Quem abre um app de dinheiro de manhã não pergunta "qual é o meu saldo seguro" — pergunta
    *"preciso fazer alguma coisa agora?"*. O número grande é a permissão (posso gastar?); esta
    linha é a obrigação (devo alguma coisa?), e obrigação GANHA de permissão quando existe.

    A ordem é a mesma da tela (atrasado → vence hoje → o resto), então o herói passa a liderar a
    urgência em vez de repetir um número enquanto ela fica três blocos abaixo.
  */
  const atrasadoCents = overdue.reduce((s, b) => s + Number(b.amount_cents), 0);
  const hojeISO = localISODate();
  const venceHoje = dueSoon.filter((b) => b.due_date === hojeISO);
  const venceHojeCents = venceHoje.reduce((s, b) => s + Number(b.amount_cents), 0);

  /*
    ⚠️ **O "por dia" some quando não significa nada.** Com R$ 0,72 livres em 7 dias ele escrevia
    "≈ R$ 0,10 por dia": preciso, e inútil — ninguém planeja o dia em dez centavos, e um número
    ridículo no lugar mais nobre da tela ensina a pessoa a não ler a linha. Abaixo de R$ 1,00 por
    dia a frase vira o que realmente importa ali, que é quando entra dinheiro de novo.
  */
  const porDia = livre > 0 ? Math.floor(livre / diasLivres) : 0;
  const veredito: { icon: React.ComponentProps<typeof Icon>['name']; negative: boolean; text: string } =
    atrasadoCents > 0
      ? { icon: 'exclamationmark.triangle', negative: true, text: `${brl(atrasadoCents)} atrasado` }
      : venceHojeCents > 0
        ? { icon: 'clock', negative: true, text: `${brl(venceHojeCents)} vence hoje` }
        : porDia >= 100
          ? { icon: 'calendar', negative: false, text: `≈ ${brl(porDia)} por dia · ${diasLivres} ${diasLivres === 1 ? 'dia' : 'dias'}` }
          : { icon: 'checkmark.circle', negative: false, text: `Nada vence hoje · ${diasLivres} ${diasLivres === 1 ? 'dia' : 'dias'} até entrar` };

  /*
    O PORTÃO DA TELA (Fase 5) — 8 consultas e 2 portões antes disto, que era a pior proporção do
    app: o painel preenchia, e depois "Atrasado", "O que vence" e "Lembretes de hoje" entravam
    cada um no seu tempo.

    ⚠️ **`profile` pode nascer desligada** (`enabled: !!userId`) e mesmo assim entra: sem ela a
    saudação — que é a PRIMEIRA linha da tela — aparecia depois do painel. `telaPronta` não se
    prende numa consulta desligada porque lê `fetchStatus`, e aqui a sessão sempre existe (esta
    tela vive dentro do `Stack.Protected`).
  */
  const pronta = useTelaPronta(cycle, profile, bills, reminders, budgets, recent, gasto, noCartao);

  const loading = gasto.isLoading || bills.isLoading || reminders.isLoading;
  const nothing =
    !loading &&
    overdue.length === 0 &&
    dueSoon.length === 0 &&
    // Seção que renderiza conta para o vazio, sempre — ver o comentário de `aReceber` abaixo.
    (noCartao.data ?? []).length === 0 &&
    // ⚠️ `aReceber` tem SEÇÃO PRÓPRIA ("O que entra") e estava fora desta conta: com uma receita
    // prevista e mais nada, a tela desenhava "Nada para hoje" LOGO ACIMA dela. Seção que
    // renderiza conta para o vazio, sempre — é o mesmo defeito que `dueSoon` já teve.
    aReceber.length === 0 &&
    todayReminders.length === 0 &&
    tight.length === 0 &&
    !captured;

  const pay = (id: string, title: string, kind: string | null | undefined) =>
    markPaid.mutate(
      { id, paidAt: localISODate() },
      {
        onSuccess: () => toast({ message: `${title}: ${settleDone(kind)}.`, tone: 'success' }),
        onError: () => toast({ message: `Não deu para dar baixa em ${title}.`, tone: 'error' }),
      }
    );

  /*
    Uma forma de tela só: saudação, herói e as duas listas que a Hoje sempre tem. Sem `topBar`
    diferente e sem o empty state — dizer "não tem nada" antes de ter perguntado é a mesma
    mentira que o `isLoading` contava (§7).
  */
  if (!pronta) {
    return (
      <Screen topBar={<AppHeader title="Hoje" />}>
        <Skeleton width="52%" height={22} />
        <SkeletonHero />
        <SkeletonList linhas={2} />
        <SkeletonList linhas={3} />
      </Screen>
    );
  }

  return (
    /*
      ⚠️ **`<Screen>`, e não um `ScrollView` à mão.** Esta era uma das DUAS telas de conteúdo que
      furavam o primitivo que governa o ritmo vertical (`gap: Space.xl`, calha `Space.lg`, o
      respiro do topo calibrado no aparelho e o padding de baixo que soma safe area + dock). Por
      isso ela tinha o próprio `paddingTop` (`+ Space.md` contra o `+ Space.sm` de todas as
      outras) e empilhava padding onde ninguém olhava.
    */
    <Screen
      stagger
      topBar={<AppHeader title="Hoje" />}
      onRefresh={() => Promise.all([gasto.refetch(), bills.refetch(), reminders.refetch(), budgets.refetch(), recent.refetch(), profile.refetch()])}>
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
        {gasto.isLoading ? (
          <View style={styles.heroSkeleton}>
            <Skeleton width="55%" height={14} />
            <Skeleton width="70%" height={38} />
          </View>
        ) : gasto.isError ? (
          <ErrorCard onRetry={() => gasto.refetch()} />
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
            /*
              ⚠️ **Esta tela NÃO repete o número do Financeiro, e isso é o produto.** Lá a
              pergunta é "como o ciclo fecha"; aqui é "quanto dá para gastar AGORA" — o dinheiro
              na conta menos o que vence ANTES da próxima entrada. Os dois saem dos mesmos três
              números, e a identidade que os amarra está em `supabase/tests/da_para_gastar.sql`;
              o que muda é a janela e a pergunta.

              Antes as duas raízes mostravam o mesmo valor com rótulos diferentes — e o da Hoje
              ainda estava errado, lendo o ciclo já fechado.
            */
            label={ateQuando ? `Livre até ${isoToBR(ateQuando)}` : 'Livre'}
            concealable
            value={
              <CountUpMoney
                cents={livre}
                variant="heroMoney"
                tone={livre < 0 ? 'onHeroDanger' : 'onHero'}
              />
            }
            secondary={veredito}
            chart={
              totalDoCiclo > 0 ? (
                <View style={styles.medidor}>
                  <ProgressBar
                    value={comprometido}
                    max={totalDoCiclo}
                    tone={usado >= 1 ? 'onHeroDanger' : 'onHeroWarning'}
                    track="heroChip"
                  />
                  <View style={styles.medidorLinha}>
                    {/*
                      Acima de 100% a barra satura e a FRASE muda: "110%" ao lado de uma barra
                      cheia lê como defeito de render, não como aviso.
                    */}
                    <ThemedText type="code" themeColor="onHeroMuted" style={styles.shrink}>
                      {usado >= 1
                        ? 'comprometi mais do que entra'
                        : `já comprometi ${Math.round(usado * 100)}%`}
                    </ThemedText>
                    {proximaEntrada ? (
                      <ThemedText type="code" themeColor="onHeroSuccess">
                        {`entra ${isoToBR(proximaEntrada)}`}
                      </ThemedText>
                    ) : null}
                  </View>
                </View>
              ) : undefined
            }
            footer={
              cycle.data ? (
                <View style={styles.heroFooter}>
                  <ThemedText type="footnote" themeColor="onHeroMuted" style={styles.shrink}>
                    {`Compromissos até ${isoToBR(cycle.data.ate)}`}
                  </ThemedText>
                  {/*
                    `ticker` + `onHero`: `footnote` com o tone padrão vira `text`, que no tema
                    claro é #131315 sobre a faixa escura — invisível.
                  */}
                  <Money cents={comprometido} variant="ticker" tone="onHero" concealable />
                </View>
              ) : undefined
            }
            onPress={() =>
              showItemActions('Mais opções', [
                /*
                  ⚠️ **O rodapé afirmava um número e não levava a lugar nenhum.** Ele escreve
                  "Compromissos até 10/10" e o painel escreve "comprometi mais do que entra";
                  o que compõe isso ficava fora de alcance daqui — medido na conta do dono do
                  produto em 16/09/2026: das seis saídas até o fim do ciclo, a maior (a fatura
                  do Nubank, 45% do total) vence em 24 dias e a janela de "O que vence" é de 7,
                  então ela não aparece na Hoje em ~23 dos 30 dias do mês.

                  A lista que responde já existe inteira (`/finance/cycle`, agrupada, com a
                  fatura abrindo nas compras dela) — faltava o caminho. **Alargar a janela de 7
                  dias seria o conserto errado**: a Hoje viraria a tela do ciclo, e o comentário
                  do `HeroPanel` acima decide o oposto ("aqui é quanto dá para gastar AGORA").

                  `mes` e `view` saem do PRÓPRIO `cycle.data`, não de um default: com `view`
                  fixo, quem está na régua civil veria no destino um período diferente do que o
                  rodapé nomeou — a discordância muda de tela que `finance.md` persegue. E
                  `tipo: 'sai'` porque `comprometido_no_ciclo` é `sum(out_cents)`: mandar para
                  a lista completa mostraria entradas que aquele número não conta.
                */
                ...(cycle.data
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
              ])
            }
          />
        )}

        {/*
          2. Os três contadores — **só quando algum deles conta alguma coisa.**

          ⚠️ Isto MUDOU (13/09/2026): a regra antiga era "zero é informação, não motivo para
          esconder", e ela estava certa enquanto ninguém mais dizia isso na tela. Agora o herói
          escreve "Nada vence hoje" logo acima, então três caixas com "0" repetem o que já foi
          dito e gastam uma fileira inteira para isso — o mesmo argumento do badge de aba
          (`design.md` §8: contagem real, ou não existe).

          Com qualquer um deles diferente de zero a fileira volta inteira: aí os zeros ao lado do
          número que importa são contraste, não enchimento.
        */}
        {overdue.length + dueSoon.length + todayReminders.length + tight.length > 0 ? (
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
          {/*
            "Orçamento" não era nem evento nem coisa contável — o número é quantas categorias
            passaram do limite, e lia-se "Orçamento 2". "No limite" diz o que o número conta.
          */}
          <Counter
            label="No limite"
            value={budgets.isError ? null : tight.length}
            tone={tight.length > 0 ? 'warning' : 'textSecondary'}
            onPress={() => router.push('/finance/budgets')}
          />
        </View>
        ) : null}

        {loading ? (
          <Secao index={0}>
            <Skeleton width="100%" height={92} radius={Radius.md} />
            <Skeleton width="100%" height={140} radius={Radius.md} />
          </Secao>
        ) : null}

        {/* 3. O que já venceu. */}
        {bills.isError ? (
          <Secao index={1}>
            <SectionHead title="Atrasado" inset={false} />
            <ErrorCard onRetry={() => bills.refetch()} />
          </Secao>
        ) : overdue.length > 0 ? (
          <Secao index={2}>
            <SectionHead
              title="Atrasado"
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
              <LinhaAnimada
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
                      pay(b.ref_id, b.title, b.kind);
                    }
                  }}
                />
              </LinhaAnimada>
            ))}
          </Secao>
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
          <Secao index={3}>
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
              <LinhaAnimada
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
                      pay(b.ref_id, b.title, b.kind);
                    }
                  }}
                />
              </LinhaAnimada>
            ))}
          </Secao>
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
          <Secao index={4}>
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
              <LinhaAnimada
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
                  onPress={() => pay(b.ref_id, b.title, b.kind)}
                />
              </LinhaAnimada>
            ))}
          </Secao>
        ) : null}

        {/*
          3c. O que ainda vai CAIR NO CARTÃO — a parcela e a assinatura com data futura.

          ⚠️ **Elas não estavam em nenhuma outra seção, e a causa é boa.** O ramo avulso de
          `upcoming_bills` exige `invoice_id is null` para não contar duas vezes o que já está
          somado dentro da fatura; o efeito colateral é que a compra que posta semana que vem
          sumia da tela inteira. Medido em 16/09/2026: `DAS` (20/09) e `Carro Peças (2/3)`
          (22/09) não apareciam em lugar nenhum da Hoje.

          ⚠️ **A FATURA não é a resposta, e isto já foi tentado.** A primeira versão desta seção
          mostrava "Fatura Nubank · R$ 3.751,22" e foi recusada: *"eu não quero a fatura em si,
          quero os próximos lançamentos previstos dentro da fatura"*. O total é um número fechado
          sobre o que já foi gasto; o que ajuda a decidir hoje é o que ainda vai entrar nele.

          ⚠️ **Fora do contador "Vencendo" e do badge da aba, de propósito.** Nada aqui vence —
          é compra que vai POSTAR. Badge é contagem do que dá para resolver agora (design.md §8),
          e somar isto ali seria pedir uma ação que não existe.

          A pílula é neutra pelo mesmo motivo das seções acima: não é problema nem aviso.

          (`index` é vestigial — o `Secao` o ignora desde que a cascata virou do `Screen`.)
        */}
        {(noCartao.data ?? []).length > 0 ? (
          <Secao index={11}>
            <SectionHead
              title="Vai cair no cartão"
              inset={false}
              action={
                <ThemedText type="caption" themeColor="textSecondary">
                  {`${noCartao.data!.length} ${noCartao.data!.length === 1 ? 'compra' : 'compras'}`}
                </ThemedText>
              }
            />
            {noCartao.data!.map((c) => (
              <LinhaAnimada
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={`Abrir ${c.title}`}
                onPress={() => router.push({ pathname: '/finance/[txId]', params: { txId: c.id } })}
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
                      {c.title}
                    </ThemedText>
                    {/*
                      O CARTÃO entra na pílula junto da data: com dois cartões, "cai 20/09" não
                      diz em qual fatura a compra vai parar — e essa é a pergunta que o
                      `AccountPicker` existe para responder em outro lugar do app.
                    */}
                    <View style={[styles.duePill, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText type="caption" themeColor="textSecondary">
                        {`${c.card} · ${formatDateBR(c.occurred_at)}`}
                      </ThemedText>
                    </View>
                  </View>
                  <Money cents={c.amount_cents} variant="ticker" />
                </View>
                <Button
                  label="Ver fatura"
                  icon="chevron.right"
                  size="sm"
                  variant="secondary"
                  onPress={() =>
                    router.push({ pathname: '/finance/invoice/[id]', params: { id: c.invoice_id } })
                  }
                />
              </LinhaAnimada>
            ))}
          </Secao>
        ) : null}

        {/* 4. Os lembretes de hoje, agrupados numa superfície só, como no desenho. */}
        {reminders.isError ? (
          <Secao index={5}>
            <SectionHead title="Lembretes de hoje" inset={false} />
            <ErrorCard onRetry={() => reminders.refetch()} />
          </Secao>
        ) : todayReminders.length > 0 ? (
          <Secao index={6}>
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
                        {/* Só o canal que foge do padrão ganha palavra: o lembrete comum chega no
                            próprio app, e escrever "no app" em toda linha era ruído. */}
                        {r.channel === 'whatsapp' ? (
                          <>
                            <View style={[styles.metaDot, { backgroundColor: theme.separator }]} />
                            <View style={styles.tag}>
                              <Icon name="bubble.left" size="xs" color="success" />
                              <ThemedText type="caption" themeColor="success">
                                via WhatsApp
                              </ThemedText>
                            </View>
                          </>
                        ) : null}
                      </View>
                    </View>
                    <Icon name={r.recurrence ? 'arrow.clockwise' : 'bell'} size="sm" color="textSecondary" />
                  </Pressable>
                </View>
              ))}
            </View>
          </Secao>
        ) : null}

        {/*
          5. Orçamento apertado — barra em `warning`/`danger`, que é ESTADO a resolver.

          ⚠️ **Seção que falha DIZ que falhou (design.md §7).** `budgets` e `recent` eram lidos
          com `?? []` e sem `isError`, então uma falha de `budgets_status` fazia esta seção
          sumir **e o contador marcar zero** — a tela afirmava que estava tudo bem justamente
          quando não sabia. As outras três seções desta mesma tela já tratavam erro; estas duas
          ficaram para trás.
        */}
        {budgets.isError ? (
          <Secao index={7}>
            <SectionHead title="Passando do limite" inset={false} />
            <ErrorCard onRetry={() => budgets.refetch()} />
          </Secao>
        ) : tight.length > 0 ? (
          <Secao index={8}>
            <SectionHead title="Passando do limite" inset={false} />
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
                        {`Limite do mês: ${brl(limit)}`}
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
                        {left < 0 ? `${brl(-left)} acima` : `${brl(left)} restantes`}
                      </ThemedText>
                    </View>
                    <ThemedText type="caption" themeColor="textSecondary">
                      {`${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'} até fechar`}
                    </ThemedText>
                  </View>
                </View>
              );
            })}
          </Secao>
        ) : null}

        {/* 6. O que acabou de chegar pelo WhatsApp — a prova de que o canal funcionou. */}
        {/*
          ⚠️ Mesma régua da seção de limite: `recent` era lido com `?? []` e sem `isError`, e uma
          falha apagava a única prova, na tela, de que a mensagem virou lançamento. Some
          calado é o pior desenho possível justamente aqui.
        */}
        {recent.isError ? (
          <Secao index={9}>
            <SectionHead title="Capturado no WhatsApp" inset={false} />
            <ErrorCard onRetry={() => recent.refetch()} />
          </Secao>
        ) : captured ? (
          <Secao index={10}>
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
                    Registrado pelo agente
                  </ThemedText>
                </View>
                <View style={[styles.amountBadge, { backgroundColor: theme.surfaceRaised }]}>
                  <ThemedText type="code" themeColor="textSecondary" style={tabular}>
                    {`${captured.kind === 'income' ? '+' : '−'} ${brl(Number(captured.amount_cents))}`}
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
          </Secao>
        ) : null}
        {/*
          ⚠️ **O vazio é o ÚLTIMO filho, e isso é guarda estrutural.** Ele renderizava no meio da
          lista e a flag `nothing` esquecia de contar as receitas a receber — então, com um
          salário previsto e mais nada, a tela desenhava "Nada para hoje" LOGO ACIMA da seção "O
          que entra" populada. Renderizando por último, ele não tem como aparecer acima de
          conteúdo nem que a flag erre de novo.

          Sem `styles.empty`: o `EmptyState` já traz o próprio ritmo vertical, e o wrapper
          somava mais 24dp em cima e embaixo de uma caixa que já tinha 48.
        */}
        {nothing ? (
          <EmptyState
            title="Nada para hoje"
            hint="Mande um áudio ou uma mensagem no WhatsApp e o que você contar aparece aqui organizado."
          />
        ) : null}
    </Screen>
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
  /** `null` = a consulta falhou. Zero afirma "está tudo bem"; "—" não afirma nada. */
  value: number | null;
  tone: 'danger' | 'warning' | 'textSecondary';
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value === null ? `${label}: não deu para carregar` : `${label}: ${value}`}
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
        <ThemedText
          type="headline"
          themeColor={value === null ? 'textSecondary' : value > 0 ? tone : 'text'}
          style={tabular}>
          {value ?? '—'}
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
  /* O medidor de comprometimento: barra e a linha de leitura abaixo dela. */
  medidor: { gap: Space.sm },
  medidorLinha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Space.sm,
  },
  heroFooterPart: {
    gap: Space.half,
  },
});
