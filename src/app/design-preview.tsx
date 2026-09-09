import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CurvedTabBar, type CurvedTab } from '@/components/ui/curved-tab-bar';
import { Radius, Space } from '@/design/tokens';
import { localISODate } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';

import AgentScreen from './(tabs)/agent/index';
import DebtsScreen from './finance/debts';
import InvoiceScreen from './finance/invoice/[id]';
import RecurringScreen from './finance/recurring';
import TransactionFormScreen from './finance/transaction-form';
import MonthScreen from './finance/month';
import FinanceScreen from './(tabs)/finance/index';
import NotesScreen from './(tabs)/notes/index';
import ProfileScreen from './(tabs)/profile/index';
import TodayScreen from './(tabs)/today/index';

/**
 * Vitrine das cinco raízes de aba com dados de exemplo, **fora do portão de sessão**.
 *
 * Existe porque a única forma de olhar essas telas era logar, e logar exige o OTP que chega no
 * WhatsApp do dono do número. Sem isto, "conferir no simulador" (regra de workflow §5) virava
 * "deve funcionar" — que é exatamente como a tela Hoje foi entregue errada duas vezes.
 *
 * O truque é o cache do TanStack, não um mock dentro dos hooks: um `QueryClient` próprio nasce
 * com as chaves já preenchidas e `staleTime: Infinity`, então nenhum `queryFn` chega a rodar e
 * as telas montam o código REAL de produção — mesmos componentes, mesmos estados, mesma
 * tipografia. Hook novo que a tela use e que não esteja semeado aqui aparece no estado de
 * carregando, que também é informação.
 *
 * Não é tela de produto: não tem link para ela em lugar nenhum e o caminho é o deep link
 * `com.proops.personal://design-preview`.
 */
/**
 * `Dívidas` é a única EMPURRADA aqui, e está de propósito: o histórico das parcelas já
 * pagas mora dentro de um sheet que só abre no toque, então sem esta faixa a correção de
 * 09/09/2026 (numeração 9..48 + as 8 anteriores) só poderia ser conferida logando.
 */
/**
 * `Fatura` entra pelo mesmo motivo de `Dívidas`: o pagamento parcial (09/09/2026) só aparece com
 * uma fatura que já recebeu dinheiro e continua em aberto, e o campo de valor mora num sheet.
 * Ela lê o `id` de `useLocalSearchParams`, então a URL da vitrine precisa levá-lo:
 * `/design-preview?id=prev-i1`.
 */
/**
 * `Recorrentes` entra porque a tela ganhou EDIÇÃO em 09/09/2026, e o sheet de edição é outro
 * desenho do de criação (sem frequência, sem âncora, com um resumo no lugar).
 *
 * `Editar` monta o formulário sobre uma PARCELA (`?id=prev-p1`): é a única forma de chegar na
 * pergunta "Aplicar em quais?", que só aparece ao salvar e só quando a linha pertence a uma série.
 * A parcela precisa de `due_at` — o zod do formulário exige vencimento em lançamento previsto.
 *
 * ⚠️ **Sheet se confere por URL + `cliclick`, não por `osascript`.** `xcrun simctl` não tem tap; o clique por
 * System Events exige acesso assistivo que o osascript aqui não tem; e o `idb` não está
 * instalado. Por isso a tela abre a edição por `?edit=<id>`, do mesmo jeito que já abria a
 * criação por `?create=1`: `appproops:///design-preview?edit=prev-r1`.
 *
 * Para tocar: `cliclick c:X,Y` (instalado), com `open -a Simulator` ANTES DE CADA clique — sem
 * refocar, o segundo clique não chega no app. A conversão sai da geometria da janela:
 * `osascript ... get {position, size} of window 1` dá a origem, a tela do device fica em
 * `(origem + 27, origem + 80)` com 398×865pt, e o screenshot é 1206×2622px — fator 0,33.
 */
const ABAS = ['Hoje', 'Finanças', 'Notas', 'Agente', 'Perfil', 'Dívidas', 'Mês', 'Fatura', 'Recorrentes', 'Editar'] as const;

/**
 * A tela é montada numa caixa ALTA e deslocada para cima, em vez de rolada.
 *
 * Screenshot de simulador (`simctl io`) não tem como rolar nada — não existe gesto por linha de
 * comando — e a alternativa seria automatizar cliques na janela do Simulator, que depende de
 * escala de janela e quebra em qualquer monitor diferente. Montando o conteúdo inteiro e
 * empurrando por `translateY`, cada passo é uma faixa exata da tela.
 *
 * O passo avança a cada LANÇAMENTO do app (guardado no `AsyncStorage`), não por timer: assim
 * `terminate` + `launch` + `screenshot` é uma sequência determinística, sem corrida com o relógio.
 */
const PASSO_KEY = 'design-preview-step';
/**
 * A tab bar do Android desenhada JUNTO da tela.
 *
 * Ela é o único pedaço de chrome que esta vitrine não mostrava — as raízes são montadas fora do
 * navegador de abas, então a `CurvedTabBar` nunca aparecia aqui. Era o buraco de verificação que
 * deixou o berço passar 26px fora do lugar sem ninguém notar: o desenho da barra só existia no
 * app logado, que é exatamente o que esta rota existe para evitar.
 *
 * As mesmas entradas de `app-tabs.android.tsx` — copiar rótulo e ícone aqui faria a vitrine
 * mostrar uma barra que não é a de produção.
 */
const TABS_ANDROID: CurvedTab[] = [
  { name: 'today', label: 'Hoje', icon: 'sun.max' },
  { name: 'notes', label: 'Notas', icon: 'note.text' },
  { name: 'finance', label: 'Financeiro', icon: 'chart.pie' },
  { name: 'agent', label: 'Agente', icon: 'bubble.left.and.bubble.right' },
  { name: 'profile', label: 'Perfil', icon: 'person' },
];
/** `ABAS` está na ordem da vitrine; a barra está na ordem do app. Este é o de-para. */
const ABA_PARA_TAB: Record<string, number> = {
  Hoje: 0,
  'Finanças': 2,
  Notas: 1,
  Agente: 3,
  Perfil: 4,
  'Dívidas': 2,
  'Mês': 2,
  Fatura: 1,
  Recorrentes: 2,
  Editar: 2,
};
/** Quantas alturas de tela cada aba ocupa — medido, para não gastar frame em preto. */
const FAIXAS: Record<(typeof ABAS)[number], number> = {
  Hoje: 2,
  'Finanças': 3,
  Notas: 3,
  // Uma faixa: a lista de conversas cabe inteira numa tela.
  Agente: 1,
  Perfil: 3,
  'Dívidas': 2,
  // Uma faixa: a tela rola de verdade (é um `Screen` com ScrollView), e o deslocamento por
  // `translateY` só funciona para tela que desenha a altura inteira.
  'Mês': 1,
  // Uma faixa: o herói e o começo da lista respondem se o parcial aparece.
  Fatura: 1,
  // Duas faixas: a lista de séries e o painel do que entra/sai no mês.
  Recorrentes: 2,
  // Uma faixa: o valor, a categoria e o botão Salvar cabem numa tela — é o que precisa
  // ser tocado para a pergunta de escopo aparecer.
  Editar: 1,
};
/** As cinco raízes de aba. As outras faixas são telas EMPURRADAS e não têm tab bar. */
const RAIZES = new Set<(typeof ABAS)[number]>(['Hoje', 'Finanças', 'Notas', 'Agente', 'Perfil']);

const PASSOS = ABAS.flatMap((aba) =>
  Array.from({ length: FAIXAS[aba] }, (_, faixa) => ({ aba, faixa }))
);

export default function DesignPreviewScreen() {
  const theme = useTheme();
  // Ferramenta de desenvolvimento. Em build de produção a rota existe mas não desenha nada:
  // ela fica FORA do portão de sessão, e uma tela do app aberta sem login não é aceitável nem
  // com dado falso.
  const dev = __DEV__;
  const { height } = useWindowDimensions();
  const [aba, setAba] = useState<(typeof ABAS)[number]>('Hoje');
  const [passo, setPasso] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    AsyncStorage.getItem(PASSO_KEY).then((raw) => {
      if (!vivo) return;
      const atual = Number(raw ?? 0) % PASSOS.length;
      setPasso(atual);
      setAba(PASSOS[atual].aba);
      AsyncStorage.setItem(PASSO_KEY, String(atual + 1));
    });
    return () => {
      vivo = false;
    };
  }, []);

  const faixa = passo === null ? 0 : PASSOS[passo].faixa;
  const alturaTotal = height * FAIXAS[aba];

  const client = useMemo(() => seedClient(), []);

  if (!dev) return <View style={{ flex: 1, backgroundColor: theme.background }} />;

  return (
    <QueryClientProvider client={client}>
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        <View style={styles.janela}>
          <View
            style={{
              height: alturaTotal,
              transform: [{ translateY: -faixa * height }],
            }}>
            {aba === 'Hoje' ? <TodayScreen /> : null}
            {aba === 'Finanças' ? <FinanceScreen /> : null}
            {aba === 'Notas' ? <NotesScreen /> : null}
            {aba === 'Agente' ? <AgentScreen /> : null}
            {aba === 'Perfil' ? <ProfileScreen /> : null}
            {aba === 'Dívidas' ? <DebtsScreen /> : null}
            {aba === 'Mês' ? <MonthScreen /> : null}
            {aba === 'Fatura' ? <InvoiceScreen /> : null}
            {aba === 'Recorrentes' ? <RecurringScreen /> : null}
            {aba === 'Editar' ? <TransactionFormScreen /> : null}
          </View>

          {/*
            A barra do Android por cima da faixa, exatamente como no app: ela é absoluta e
            desenha sobre o conteúdo. Fica DENTRO da janela recortada para não brigar com o
            seletor da vitrine, que é ferramenta e não produto.

            ⚠️ Só nas RAÍZES. Tela empurrada não tem tab bar desde 07/09/2026 (`design.md` §8), e
            desenhá-la aqui não era só enfeite errado: ela cobre a ação ancorada no rodapé, que é
            justamente o que essas faixas existem para mostrar — o "Registrar pagamento" da Fatura
            ficava embaixo dela.
          */}
          {Platform.OS === 'android' && RAIZES.has(aba) ? (
            <CurvedTabBar
              tabs={TABS_ANDROID}
              activeIndex={ABA_PARA_TAB[aba] ?? 0}
              onSelect={(i) => {
                const alvo = ABAS.find((nome) => ABA_PARA_TAB[nome] === i);
                if (alvo) setAba(alvo);
              }}
            />
          ) : null}
        </View>

        {/* Rolável desde que a vitrine passou de cinco faixas: com sete chips o último saía da tela. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.switcherBox, { borderTopColor: theme.cardBorder }]}
          contentContainerStyle={styles.switcher}>
          {ABAS.map((nome) => (
            <Pressable
              key={nome}
              accessibilityRole="button"
              onPress={() => setAba(nome)}
              style={[
                styles.chip,
                {
                  backgroundColor: aba === nome ? theme.tint : theme.surface,
                  borderColor: theme.cardBorder,
                },
              ]}>
              <ThemedText type="caption" themeColor={aba === nome ? 'onTint' : 'textSecondary'}>
                {nome === aba ? `${nome} ${faixa + 1}/${FAIXAS[aba]}` : nome}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </QueryClientProvider>
  );
}

/** Hoje é 03/09/2026 no ambiente de desenvolvimento; as chaves que levam data usam o dia local. */
function seedClient() {
  const hoje = localISODate();
  const agora = new Date();
  const mes = hoje.slice(0, 7);
  const ultimoDia = localISODate(new Date(agora.getFullYear(), agora.getMonth() + 1, 0));
  const anterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
  const mesAnterior = localISODate(anterior).slice(0, 7);
  const ultimoDiaAnterior = localISODate(
    new Date(anterior.getFullYear(), anterior.getMonth() + 1, 0)
  );
  const fimDoMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0);
  const diasRestantes = Math.max(1, fimDoMes.getDate() - agora.getDate());

  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });

  const at = (hora: number, minuto: number) =>
    new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), hora, minuto).toISOString();

  // Curva de saldo do mês: começa em 3.910 e desce até 2.450, para o sparkline ter o que desenhar.
  const forecast = Array.from({ length: diasRestantes + 1 }, (_, i) => ({
    day: `2026-09-${String(agora.getDate() + i).padStart(2, '0')}`,
    balance_cents: 391000 - Math.round((i / diasRestantes) * 146000),
  }));

  client.setQueryData(['forecast', String(diasRestantes)], forecast);

  client.setQueryData(
    ['upcoming-bills', '7'],
    [
      {
        ref_id: 'prev-aluguel',
        title: 'Aluguel',
        due_date: '2026-09-01',
        amount_cents: 180000,
        kind: 'expense',
        overdue: true,
      },
      {
        ref_id: 'prev-energia',
        title: 'Energia',
        due_date: '2026-09-08',
        amount_cents: 21430,
        kind: 'expense',
        overdue: false,
      },
    ]
  );

  client.setQueryData(
    ['reminders', 'today', hoje],
    [
      {
        id: 'prev-r1',
        title: 'Ligar para o contador sobre IRPF',
        recurrence: null,
        next_run_at: at(15, 0),
        channel: 'whatsapp',
        active: true,
      },
      {
        id: 'prev-r2',
        title: 'Comprar filtro de água',
        recurrence: null,
        next_run_at: at(18, 30),
        channel: 'push',
        active: true,
      },
    ]
  );

  // Hoje chama `useBudgetsStatus()` (chave = o DIA) e Financeiro chama com o mês (`YYYY-MM-01`).
  // São duas chaves diferentes para a mesma RPC — as duas precisam de dado aqui.
  const statusOrcamento = 
    [
      {
        category: 'alimentação',
        base_limit_cents: 200000,
        limit_cents: 200000,
        spent_cents: 176000,
        rollover: false,
        rollover_cents: 0,
      },
      {
        category: 'transporte',
        base_limit_cents: 60000,
        limit_cents: 60000,
        spent_cents: 18700,
        rollover: false,
        rollover_cents: 0,
      },
    ];
  client.setQueryData(['budgets-status', hoje], statusOrcamento);
  client.setQueryData(['budgets-status', `${mes}-01`], statusOrcamento);

  const tx = (over: Record<string, unknown>) => ({
    id: 'prev-tx',
    kind: 'expense',
    amount_cents: 4500,
    currency: 'BRL',
    category: 'alimentação',
    description: 'Gastei 45 no almoço do Rangão',
    account_id: null,
    counterparty_account_id: null,
    occurred_at: hoje,
    source: 'whatsapp',
    created_at: at(12, 44),
    status: 'cleared',
    due_at: null,
    invoice_id: null,
    installment_plan_id: null,
    installment_no: null,
    merchant: null,
    recurring_id: null,
    debt_id: null,
    ...over,
  });

  const recentes = [
    tx({}),
    tx({ id: 'prev-tx2', description: 'Supermercado Pão de Açúcar', amount_cents: 14250 }),
    tx({
      id: 'prev-tx3',
      kind: 'income',
      description: 'Pix recebido — consultoria',
      amount_cents: 120000,
      category: 'receita',
    }),
  ];

  // ── as duas fixtures que provam as correções de 08/09/2026 ────────────────
  // Receita PREVISTA: era ela que ganhava o botão "Paguei", como se salário
  // fosse dívida. Aqui ela tem que ler "Recebi" e "previsto · chega".
  const receitaPrevista = tx({
    id: 'prev-salario-futuro',
    kind: 'income',
    description: 'Salário',
    category: 'salário',
    amount_cents: 900000,
    status: 'pending',
    due_at: ultimoDia,
    occurred_at: ultimoDia,
  });
  const comPrevista = [receitaPrevista, ...recentes];

  client.setQueryData(['transactions', 'recent', '5'], comPrevista);
  client.setQueryData(['transactions', 'list', { month: mes }], comPrevista);

  // Financiamento: existia no banco e não aparecia em lugar nenhum do Financeiro.
  client.setQueryData(['debts'], [
    {
      id: 'prev-divida-carro',
      name: 'carro',
      kind: 'financing',
      calculation_mode: 'fixed_installments',
      principal_cents: 7056000,
      remaining_cents: 5880000,
      interest_rate_monthly: 0,
      installments: 48,
      installments_paid: 8,
      installment_cents: 147000,
      account_id: null,
      due_day: 10,
      archived: false,
    },
  ]);

  /*
    O cronograma como o banco passou a devolvê-lo: numerado pelo CONTRATO (9..48), não pela
    posição na lista do que sobrou. As oito anteriores NÃO vêm daqui — a tela as deriva de
    `installments_paid`, que é como o passado de um financiamento é guardado.
  */
  client.setQueryData(
    ['debt-schedule', 'prev-divida-carro'],
    Array.from({ length: 40 }, (_, i) => ({
      installment_no: 9 + i,
      due_date: `${2026 + Math.floor((9 + i) / 12)}-${String(((9 + i) % 12) + 1).padStart(2, '0')}-10`,
      payment_cents: 147000,
      interest_cents: null,
      principal_cents: null,
      balance_cents: 5880000 - 147000 * (i + 1),
    })),
  );
  // Nenhum pagamento registrado: as 8 pagas são as DECLARADAS no cadastro.
  client.setQueryData(['debt-payments', 'prev-divida-carro'], []);
  client.setQueryData(['payoff', 'avalanche'], []);

  /*
    A página de MÊS. As três chaves das RPCs novas, semeadas com a forma que o banco devolve —
    inclusive a parcela do financiamento como linha PROJETADA (`origin: 'debt_schedule'`), que é
    a que resolve "o carro só aparece entrando em Dívidas".
  */
  const linhaMes = (over: Record<string, unknown>) => ({
    bucket: 'variavel', origin: 'transaction', ref_id: 'prev-l1', title: 'Lançamento',
    category: 'outros', method_id: 'prev-a1', method_label: 'Conta corrente',
    due_date: `${mes}-10`, due_day: 10, installment_no: null, installments_total: null,
    kind: 'expense', amount_cents: 10000, settled: false, projected: false, ...over,
  });
  client.setQueryData(['month-lines', mes], [
    linhaMes({ bucket: 'entrada', ref_id: 'prev-e1', title: 'Salário', category: 'salário',
      kind: 'income', amount_cents: 900000, settled: true, due_day: 1 }),
    linhaMes({ bucket: 'fixa', ref_id: 'prev-f1', title: 'Vivo', category: 'contas',
      method_label: 'Nubank Ultravioleta', amount_cents: 3500, due_day: 8 }),
    linhaMes({ bucket: 'fixa', ref_id: 'prev-f2', title: 'Apple iCloud', category: 'assinaturas',
      amount_cents: 1990, due_day: 5, settled: true }),
    linhaMes({ bucket: 'parcela', origin: 'debt_schedule', ref_id: 'prev-divida-carro',
      title: 'Parcela carro', category: 'contas', method_label: 'Financiamento',
      amount_cents: 147000, due_day: 10, installment_no: 9, installments_total: 48,
      projected: true }),
    linhaMes({ bucket: 'parcela', ref_id: 'prev-p1', title: 'Mac', category: 'outros',
      method_label: 'Nubank Ultravioleta', amount_cents: 78096, due_day: 3,
      installment_no: 1, installments_total: 12 }),
    linhaMes({ bucket: 'variavel', ref_id: 'prev-v1', title: 'Gastei 45 no almoço do Rangão',
      category: 'alimentação', method_label: 'Sem conta', method_id: null, amount_cents: 4500,
      settled: true, due_day: 8 }),
    linhaMes({ bucket: 'variavel', ref_id: 'prev-v2', title: 'Vacina do gato',
      category: 'saúde', amount_cents: 9990, settled: true, due_day: 6 }),
  ]);
  client.setQueryData(['month-summary', mes], {
    income_cents: 900000, expense_cents: 245076, result_cents: 654924,
    fixas_cents: 5490, fixas_unsettled_cents: 3500,
    parcelas_cents: 225096, parcelas_unsettled_cents: 225096,
    variaveis_cents: 14490, variaveis_unsettled_cents: 0,
    opening_cash_cents: 41005, closing_cash_cents: 892040,
    recurring_covered_until: `${mes}-04`, beyond_recurring_horizon: false,
    debt_installments_undocumented: 0,
  });
  /*
    O mês ANTERIOR, para a vitrine mostrar o que a tela diz quando está incompleta: recorrentes
    não geradas até lá (a faixa de aviso) e parcela de financiamento declarada como paga sem
    lançamento por trás. É o estado que o `MonthPicker` alcança com um toque em ‹.
  */
  client.setQueryData(['month-lines', mesAnterior], [
    linhaMes({ bucket: 'entrada', ref_id: 'prev-e0', title: 'Salário', category: 'salário',
      kind: 'income', amount_cents: 900000, settled: true, due_day: 1,
      due_date: `${mesAnterior}-01` }),
    linhaMes({ bucket: 'parcela', ref_id: 'prev-p0', title: 'Mac', category: 'outros',
      method_label: 'Nubank Ultravioleta', amount_cents: 78096, due_day: 3, settled: true,
      installment_no: 0, installments_total: 12, due_date: `${mesAnterior}-03` }),
    linhaMes({ bucket: 'variavel', ref_id: 'prev-v0', title: 'Mercado', category: 'alimentação',
      amount_cents: 41230, settled: true, due_day: 20, due_date: `${mesAnterior}-20` }),
  ]);
  client.setQueryData(['month-summary', mesAnterior], {
    income_cents: 900000, expense_cents: 119326, result_cents: 780674,
    fixas_cents: 0, fixas_unsettled_cents: 0,
    parcelas_cents: 78096, parcelas_unsettled_cents: 0,
    variaveis_cents: 41230, variaveis_unsettled_cents: 0,
    opening_cash_cents: 12000, closing_cash_cents: 41005,
    recurring_covered_until: null, beyond_recurring_horizon: true,
    debt_installments_undocumented: 8,
  });
  client.setQueryData(['month-breakdown', mesAnterior, 'natureza'], [
    { group_key: 'parcela', group_label: 'parcela', total_cents: 78096, unsettled_cents: 0, line_count: 1, share_bp: 6545 },
    { group_key: 'variavel', group_label: 'variavel', total_cents: 41230, unsettled_cents: 0, line_count: 1, share_bp: 3455 },
  ]);

  // os outros dois cortes do mês corrente, para o `Segmented` funcionar na vitrine
  client.setQueryData(['month-breakdown', mes, 'meio'], [
    { group_key: 'financiamento', group_label: 'Financiamento', total_cents: 147000, unsettled_cents: 147000, line_count: 1, share_bp: 5998 },
    { group_key: 'prev-a3', group_label: 'Nubank Ultravioleta', total_cents: 81596, unsettled_cents: 78096, line_count: 2, share_bp: 3330 },
    { group_key: 'prev-a1', group_label: 'Conta corrente', total_cents: 11980, unsettled_cents: 0, line_count: 2, share_bp: 489 },
    { group_key: 'Sem conta', group_label: 'Sem conta', total_cents: 4500, unsettled_cents: 0, line_count: 1, share_bp: 184 },
  ]);
  client.setQueryData(['month-breakdown', mes, 'categoria'], [
    { group_key: 'contas', group_label: 'contas', total_cents: 150500, unsettled_cents: 150500, line_count: 2, share_bp: 6141 },
    { group_key: 'outros', group_label: 'outros', total_cents: 78096, unsettled_cents: 78096, line_count: 1, share_bp: 3187 },
    { group_key: 'saúde', group_label: 'saúde', total_cents: 9990, unsettled_cents: 0, line_count: 1, share_bp: 408 },
    { group_key: 'alimentação', group_label: 'alimentação', total_cents: 4500, unsettled_cents: 0, line_count: 1, share_bp: 184 },
    { group_key: 'assinaturas', group_label: 'assinaturas', total_cents: 1990, unsettled_cents: 0, line_count: 1, share_bp: 81 },
  ]);

  client.setQueryData(['month-breakdown', mes, 'natureza'], [
    { group_key: 'parcela', group_label: 'parcela', total_cents: 225096, unsettled_cents: 225096, line_count: 2, share_bp: 9185 },
    { group_key: 'variavel', group_label: 'variavel', total_cents: 14490, unsettled_cents: 0, line_count: 2, share_bp: 591 },
    { group_key: 'fixa', group_label: 'fixa', total_cents: 5490, unsettled_cents: 3500, line_count: 2, share_bp: 224 },
  ]);

  // `transactions_summary` devolve UMA linha por (categoria, tipo), não a transação.
  const resumo = (fim: string, gasto: number, receita: number) => [
    { category: 'alimentação', kind: 'expense', total_cents: gasto, tx_count: 12 },
    { category: 'transporte', kind: 'expense', total_cents: Math.round(gasto * 0.3), tx_count: 5 },
    { category: 'salário', kind: 'income', total_cents: receita, tx_count: 1 },
    { category: 'freela', kind: 'income', total_cents: 120000, tx_count: 2 },
  ];
  client.setQueryData(['tx-summary', `${mes}-01`, ultimoDia], resumo(ultimoDia, 412000, 900000));
  client.setQueryData(['tx-summary', `${mesAnterior}-01`, ultimoDiaAnterior], resumo(ultimoDiaAnterior, 468000, 900000));

  client.setQueryData(['account-balances'], [
    { account_id: 'prev-a1', name: 'Conta corrente', type: 'checking', balance_cents: 892040 },
    { account_id: 'prev-a2', name: 'Carteira', type: 'cash', balance_cents: 12000 },
  ]);
  client.setQueryData(['accounts'], [
    { id: 'prev-a1', name: 'Conta corrente', type: 'checking', initial_balance_cents: 0 },
    { id: 'prev-a2', name: 'Carteira', type: 'cash', initial_balance_cents: 0 },
  ]);
  // Fatura PARCIALMENTE paga: 2.393,92 de compras, 2.080,00 já pagos, 313,92 faltando.
  // É o caso real de setembro/2026 e o único jeito de ver a linha "Pago … · falta …" do herói
  // e o campo de valor do sheet já preenchido com o que falta.
  client.setQueryData(['invoice', 'prev-i1'], {
    invoice: {
      id: 'prev-i1',
      account_id: 'prev-c1',
      reference_month: `${mes}-01`,
      closing_date: `${mes}-03`,
      due_date: `${mes}-10`,
      status: 'closed',
      paid_at: null,
      paid_cents: 208000,
    },
    transactions: [
      tx({ id: 'prev-f1', description: 'King Cell Machado', amount_cents: 39900, category: 'compras',
           occurred_at: `${mesAnterior}-03`, account_id: 'prev-c1', invoice_id: 'prev-i1',
           installment_plan_id: 'prev-p1', installment_no: 9, source: 'import' }),
      tx({ id: 'prev-f2', description: 'Luizroberto', amount_cents: 78096, category: 'compras',
           occurred_at: `${mesAnterior}-04`, account_id: 'prev-c1', invoice_id: 'prev-i1',
           installment_plan_id: 'prev-p2', installment_no: 1, status: 'pending', source: 'import' }),
      tx({ id: 'prev-f3', description: 'Auto Posto Costa Costa', amount_cents: 7000,
           category: 'transporte', occurred_at: `${mesAnterior}-09`, account_id: 'prev-c1',
           invoice_id: 'prev-i1', source: 'import' }),
      tx({ id: 'prev-f4', description: 'Saldo em rotativo do mês passado', amount_cents: 33372,
           category: 'juros', occurred_at: `${mesAnterior}-10`, account_id: 'prev-c1',
           invoice_id: 'prev-i1', source: 'import' }),
      tx({ id: 'prev-f5', description: 'Anthropic* Claude Sub', amount_cents: 56764,
           category: 'assinaturas', occurred_at: `${mesAnterior}-12`, account_id: 'prev-c1',
           invoice_id: 'prev-i1', source: 'import' }),
      tx({ id: 'prev-f6', description: 'Mercadolivre*Mercadol', amount_cents: 10570,
           category: 'compras', occurred_at: `${mesAnterior}-12`, account_id: 'prev-c1',
           invoice_id: 'prev-i1', source: 'import' }),
      tx({ id: 'prev-f7', description: 'Bicho Molhado Petcente', amount_cents: 9990,
           category: 'pet', occurred_at: `${mesAnterior}-14`, account_id: 'prev-c1',
           invoice_id: 'prev-i1', source: 'import' }),
      tx({ id: 'prev-f8', description: 'Casa do Acai Cafe', amount_cents: 3700,
           category: 'alimentação', occurred_at: `${mesAnterior}-21`, account_id: 'prev-c1',
           invoice_id: 'prev-i1', source: 'import' }),
    ],
  });
  // A chave leva `months` como STRING e o default do hook é 60 — chave errada não quebra,
  // cai no estado de carregando e o pager some sem avisar.
  client.setQueryData(['card-invoices', 'prev-c1', '60'], [
    { id: 'prev-i0', reference_month: `${mesAnterior}-01`, due_date: `${mesAnterior}-10`,
      status: 'paid', total_cents: 292008 },
    { id: 'prev-i1', reference_month: `${mes}-01`, due_date: `${mes}-10`,
      status: 'closed', total_cents: 324010 },
  ]);

  client.setQueryData(['card-summary'], [
    {
      account_id: 'prev-c1',
      name: 'Nubank Ultravioleta',
      invoice_id: 'prev-i1',
      invoice_total_cents: 324010,
      unpaid_total_cents: 324010,
      credit_limit_cents: 1500000,
      available_limit_cents: 1175000,
      closing_day: 15,
      due_day: 22,
      closing_date: `${mes}-15`,
      due_date: `${mes}-22`,
      reference_month: `${mes}-01`,
      overdue_count: 0,
      overdue_total_cents: 0,
      oldest_overdue_invoice_id: null,
    },
    {
      account_id: 'prev-c2',
      name: 'Itaú Personnalité',
      invoice_id: 'prev-i2',
      invoice_total_cents: 89050,
      unpaid_total_cents: 89050,
      credit_limit_cents: 400000,
      available_limit_cents: 310950,
      closing_day: 5,
      due_day: 12,
      closing_date: `${mes}-05`,
      due_date: `${mes}-12`,
      reference_month: `${mes}-01`,
      overdue_count: 0,
      overdue_total_cents: 0,
      oldest_overdue_invoice_id: null,
    },
    {
      account_id: 'prev-c3',
      name: 'Cartão da casa',
      invoice_id: 'prev-i3',
      invoice_total_cents: 142300,
      unpaid_total_cents: 142300,
      credit_limit_cents: 600000,
      available_limit_cents: 457700,
      closing_day: 20,
      due_day: 27,
      closing_date: `${mes}-20`,
      due_date: `${mes}-27`,
      reference_month: `${mes}-01`,
      overdue_count: 1,
      overdue_total_cents: 142300,
      oldest_overdue_invoice_id: 'prev-i3',
    },
  ]);
  client.setQueryData(
    ['monthly-cashflow', '6'],
    ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((m, i) => ({
      month: `${m}-01`,
      income_cents: 780000 + i * 40000,
      expense_cents: 520000 - i * 18000,
    }))
  );
  client.setQueryData(['budgets'], []);

  const nota = (over: Record<string, unknown>) => ({
    id: 'prev-n1',
    content: 'Lista do supermercado & feira\nazeite extravirgem · café · filtro de água',
    folder_id: 'prev-f1',
    pinned: true,
    source: 'whatsapp',
    tags: ['mercado'],
    created_at: at(9, 12),
    updated_at: at(9, 12),
    deleted_at: null,
    ...over,
  });

  // `useNotesList` é `useInfiniteQuery`: o cache guarda `{ pages, pageParams }`, não o array.
  /**
   * A aba Agente.
   *
   * ⚠️ A chave e o FORMATO precisam bater exatamente com `useAgentConversations`
   * (`['agent','conversations']`, `useInfiniteQuery` → `{pages, pageParams}`).
   * Chave errada não quebra: a tela cai no estado de erro, em silêncio — foi o
   * que já aconteceu com `budgets_status`, consultada com duas chaves diferentes.
   */
  client.setQueryData(['agent', 'conversations'], {
    pageParams: [null],
    pages: [
      {
        items: [
          {
            id: 'prev-c1',
            title: 'Quanto gastei este mês?',
            preview: 'Você gastou R$ 3.482,10 este mês — 12% a menos que em agosto.',
            last_message_at: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
          },
          {
            id: 'prev-c2',
            title: 'Registrar as compras do mercado',
            preview: 'Anotei: R$ 245,80 em mercado, no cartão Nubank.',
            last_message_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
          },
          {
            id: 'prev-c3',
            title: 'Planejar a viagem de dezembro',
            preview: 'Criei a meta "Viagem dezembro" com R$ 4.000 até 01/12/2026.',
            last_message_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
        next_cursor: null,
      },
    ],
  });

  client.setQueryData(['notes', 'list', {}], {
    pageParams: [0],
    pages: [
      [
        nota({}),
        nota({
          id: 'prev-n2',
          content: 'Ideias para o app\nresumo semanal por áudio no domingo à noite',
          folder_id: 'prev-f2',
          pinned: false,
          source: 'app',
          tags: ['ideias'],
        }),
        nota({
          id: 'prev-n3',
          content: 'Reunião com o contador — levar notas fiscais de agosto',
          folder_id: 'prev-f2',
          pinned: false,
          source: 'whatsapp',
          tags: ['trabalho'],
          updated_at: at(8, 5),
        }),
      ],
    ],
  });

  client.setQueryData(['notes', 'folders'], [
    { id: 'prev-f1', name: 'Mercado', icon: 'cart', notes_count: 4 },
    { id: 'prev-f2', name: 'Trabalho', icon: 'briefcase', notes_count: 6 },
    { id: 'prev-f3', name: 'Ideias', icon: 'lightbulb', notes_count: 8 },
  ]);
  client.setQueryData(['notes', 'tags'], [
    { tag: 'mercado', count: 4 },
    { tag: 'trabalho', count: 6 },
  ]);

  client.setQueryData(['plan-status'], {
    plan: 'pro',
    members: 2,
    max_members: 5,
    ai_messages_month: 143,
    max_ai_messages_month: 1000,
  });
  client.setQueryData(['reminders'], []);
  client.setQueryData(['goals'], []);
  /**
   * `Recorrentes` ganhou EDIÇÃO em 09/09/2026 e o sheet de edição é outro desenho do de
   * criação: sem frequência e sem âncora, com um resumo no lugar. Com a lista vazia a tela
   * cai no estado vazio e nada disso é conferível.
   */
  client.setQueryData(['recurring'], [
    {
      id: 'prev-r1', kind: 'expense', amount_cents: 150000, currency: 'BRL',
      category: 'moradia', description: 'Aluguel', account_id: 'prev-a1',
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=5', next_run_at: `${mes}-05T09:00:00Z`,
      dtstart: `${mes}-05T09:00:00Z`, end_date: null, auto_confirm: true,
      active: true, run_attempts: 0, last_error: null, created_at: `${mes}-01T09:00:00Z`,
    },
    {
      id: 'prev-r2', kind: 'income', amount_cents: 420000, currency: 'BRL',
      category: 'salário', description: 'Salário PJ', account_id: 'prev-a1',
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=4', next_run_at: `${mes}-04T09:00:00Z`,
      dtstart: `${mes}-04T09:00:00Z`, end_date: null, auto_confirm: true,
      active: true, run_attempts: 0, last_error: null, created_at: `${mes}-01T09:00:00Z`,
    },
  ]);
  /**
   * ⚠️ A chave é `['recurring','upcoming', String(dias), HOJE]` — dias como STRING e a data de
   * hoje no fim. Com `30` numérico e sem a data, a query rodava de verdade, falhava sem sessão e
   * a tela abria com a faixa "Não deu para somar os próximos 30 dias" em cima da lista certa.
   * Chave errada não quebra: cai no estado de erro, em silêncio.
   */
  /**
   * A parcela que a banda `Editar` abre (`/design-preview?id=prev-p1`). Ela precisa de
   * `installment_plan_id`: é ele que faz o formulário perguntar "Aplicar em: só esta / esta e
   * as futuras" ao salvar. Sem série, o salvamento é direto e a pergunta não existe.
   */
  client.setQueryData(['transactions', 'item', 'prev-p1'], {
    id: 'prev-p1', kind: 'expense', amount_cents: 41500, currency: 'BRL',
    category: 'casa', description: 'Notebook', merchant: 'Kabum',
    account_id: 'prev-a2', counterparty_account_id: null,
    occurred_at: `${mes}-03`, source: 'app', created_at: `${mes}-03T10:00:00Z`,
    // `due_at` preenchido porque o formulário EXIGE vencimento em lançamento previsto
    // (refine do zod). Toda linha pendente em produção tem: 92 de 92, conferido.
    status: 'pending', due_at: `${mes}-13`, invoice_id: null,
    installment_plan_id: 'prev-pl1', installment_no: 3, recurring_id: null, debt_id: null,
  });

  client.setQueryData(['recurring', 'upcoming', '30', hoje], [
    { kind: 'expense', amount_cents: 150000 },
    { kind: 'income', amount_cents: 420000 },
  ]);

  return client;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  janela: { flex: 1, overflow: 'hidden' },
  switcherBox: {
    flexGrow: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  switcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    padding: Space.sm,
  },
  chip: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
