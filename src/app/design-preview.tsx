import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CurvedTabBar, type CurvedTab } from '@/components/ui/curved-tab-bar';
import { Radius, Space } from '@/design/tokens';
import { localISODate } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';

import AgentScreen from './(tabs)/agent/index';
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
const ABAS = ['Hoje', 'Finanças', 'Notas', 'Agente', 'Perfil'] as const;

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
};
/** Quantas alturas de tela cada aba ocupa — medido, para não gastar frame em preto. */
const FAIXAS: Record<(typeof ABAS)[number], number> = {
  Hoje: 2,
  'Finanças': 3,
  Notas: 3,
  // Uma faixa: a lista de conversas cabe inteira numa tela.
  Agente: 1,
  Perfil: 3,
};
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
          </View>

          {/*
            A barra do Android por cima da faixa, exatamente como no app: ela é absoluta e
            desenha sobre o conteúdo. Fica DENTRO da janela recortada para não brigar com o
            seletor da vitrine, que é ferramenta e não produto.
          */}
          {Platform.OS === 'android' ? (
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

        <View style={[styles.switcher, { borderTopColor: theme.cardBorder }]}>
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
        </View>
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

  client.setQueryData(['transactions', 'recent', '5'], recentes);
  client.setQueryData(['transactions', 'list', { month: mes }], recentes);

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
  client.setQueryData(['recurring'], []);

  return client;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  janela: { flex: 1, overflow: 'hidden' },
  switcher: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    padding: Space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  chip: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
