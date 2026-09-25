import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { telaPronta } from './tela-pronta.ts';
import { ladosDoArrasto } from './arrasto.ts';

const require = createRequire(import.meta.url);

// Execute the screen JSX and its event handlers. Native components/query boundaries
// are inert; state persists across renders so each interaction uses current props.
function screen(file: string, options: { tablet?: boolean; debts?: any[]; archivedDebts?: any[]; debtSchedule?: any[]; payoff?: any[]; invoiceStatus?: string; create?: boolean; monthLines?: any[]; monthSummary?: any; cycleLines?: any[]; cycleRow?: any; rangeError?: boolean; rangePending?: boolean; rangePendingMonths?: string[]; bills?: any[]; billsError?: boolean; charges?: any[]; reminders?: any[]; budgets?: any[]; setupPassos?: any[]; proximo?: any; activity?: any[]; activityError?: boolean; forecastAccounts?: any[]; anticipation?: any[] | ((pagarEm: string) => any[]); cards?: any[]; params?: Record<string, string>; paymentsError?: boolean; debtPayments?: any[]; importItems?: any[]; importBatch?: any; unmatched?: any[]; forecastMonths?: any[]; categoriasUsadas?: any[]; maisPaginas?: boolean; alerts?: any[]; buscaNotas?: any[]; faturas?: any[]; balances?: any[]; balancesError?: boolean; plan?: string; planPending?: boolean; txStatus?: string; recent?: any[]; rules?: any[]; recurring?: any[]; goals?: any[]; componente?: string; props?: any; folders?: any[]; notes?: any[]; conversations?: any[]; batches?: any[]; plans?: any[]; contributions?: any[]; txs?: any[]; arquivadas?: number } = {}) {
  const state: any[] = [];
  let cursor = 0;
  let nodes: any[] = [];
  // Como no React: `setState` DURANTE o render (o `?edit=`/`?id=` consumido quando o dado chega)
  // desenha de novo na hora, antes de a tela valer.
  let renderizando = false;
  let deNovo = false;
  const writes: { operation: string; value: any }[] = [];
  const confirmations: (() => void)[] = [];
  const actions: { label: string; onPress: () => void }[] = [];
  const navigations: any[] = [];
  /** Quais consultas o "Tentar de novo" refez — é assim que se sabe se ele refez a CERTA. */
  const refetches: string[] = [];
  let forecastDrafts: any[] = [];
  /** O que cada chamada do portão da tela recebeu — o dublê dele abre sempre, então é por aqui que se confere a COMPOSIÇÃO. */
  const gates: any[][] = [];
  const query = { data: [], isLoading: false, isError: false, isRefetching: false, refetch: async () => {} };
  /** As mesmas escritas de `writes`, com as opções (`onSuccess`/`onError`) — é por aqui que se chama o retorno. */
  const pedidos: { operation: string; value: any; opts: any }[] = [];
  const toasts: any[] = [];
  /** O texto de cada confirmação destrutiva (o 4º argumento de `confirmDestructive`). */
  const avisos: string[] = [];
  /** Com que limite cada lista paginada no servidor foi pedida — é como se vê o "Ver mais" pedir mais. */
  const pedidosDeLimite: [string, number | undefined][] = [];
  const mutation = (operation: string) => ({ isPending: false, reset() {}, mutate(value: any, opts?: any) { writes.push({ operation, value }); pedidos.push({ operation, value, opts }); } });
  const animation = { duration: () => animation, delay: () => animation };
  const finance = new Proxy({
    DEBT_KINDS: [{ value: 'financing', label: 'Financiamento' }, { value: 'loan', label: 'Empréstimo' }],
    SUGGESTED_CATEGORIES: [],
    ACCOUNT_TYPES: [{ value: 'checking', label: 'Conta corrente', icon: 'building.columns' }],
    INCOME_CATEGORIES: [],
    ASSET_CLASSES: [{ value: 'investment', label: 'Investimento', icon: 'chart.line.uptrend.xyaxis' }],
    useDebts: () => ({ ...query, data: options.debts ?? [] }),
    useCardSummary: () => ({ ...query, isSuccess: true, data: options.cards ?? [] }),
    useCardInvoices: () => ({ ...query, isSuccess: true, data: options.faturas ?? [] }),
    useCategoriesUsed: () => ({ ...query, isSuccess: true, data: options.categoriasUsadas ?? [] }),
    useImportItems: () => ({ ...query, isSuccess: true, data: options.importItems ?? [] }),
    useImportBatch: () => ({ ...query, isSuccess: true, data: options.importBatch ?? { status: 'open', account_id: 'conta-1', accounts: { type: 'checking' } } }),
    useImportUnmatched: () => ({ ...query, isSuccess: true, data: options.unmatched ?? [] }),
    // Só responde quando o teste dá os lançamentos: respondido e vazio, o Financeiro afirmaria
    // "Ainda não tem movimento", e o teste das bordas falhando depende de ele NÃO afirmar.
    useRules: () => ({ ...query, isSuccess: true, data: options.rules ?? [] }),
    useRecurringTransactions: () => ({ ...query, isSuccess: true, data: options.recurring ?? [] }),
    useToggleRecurring: () => mutation('toggleRecurring'),
    useGoals: () => ({ ...query, isSuccess: true, data: options.goals ?? [] }),
    useImportBatches: (limite?: number) => { pedidosDeLimite.push(['batches', limite]); return { ...query, isSuccess: true, data: options.batches ?? [] }; },
    useAlertsSent: (limite?: number) => { pedidosDeLimite.push(['alerts', limite]); return { ...query, isSuccess: true, data: options.alerts ?? [] }; },
    useInstallmentPlans: () => ({ ...query, isSuccess: true, data: options.plans ?? [] }),
    useInstallmentPlan: (id?: string) => ({ ...query, isSuccess: true, data: (options.plans ?? []).find((p: any) => p.id === id) ?? null }),
    useGoalContributions: () => ({ ...query, isSuccess: true, data: options.contributions ?? [] }),
    useGoalDeposit: () => mutation('goalDeposit'),
    useDeleteImportBatch: () => mutation('deleteImportBatch'),
    useRecentTransactions: () => (options.recent ? { ...query, isSuccess: true, data: options.recent } : query),
    PLANS: [
      { value: 'free', label: 'Free', price: 'grátis', pitch: '1 pessoa' },
      { value: 'pro', label: 'Pro', price: 'R$ 24,90/mês', pitch: '3 pessoas' },
      { value: 'family', label: 'Família', price: 'R$ 39,90/mês', pitch: '5 pessoas' },
    ],
    usePlanStatus: () => options.planPending
      ? { ...query, isPending: true, data: undefined }
      : { ...query, isPending: false, isSuccess: true, data: { plan: options.plan ?? 'pro' } },
    useMonthLines: () => ({ ...query, data: options.monthLines ?? [] }),
    useCycleLines: () => ({ ...query, data: options.cycleLines ?? [] }),
    // A tela do ciclo mostra o esqueleto enquanto não tem a série — sem este dublê ela nunca
    // chega a renderizar linha nenhuma, e o teste passaria a medir o esqueleto.
    useCycleSeries: () => ({ ...query, isPending: false, data: [options.cycleRow ?? {
      mes: '2026-09-01', ini: '2026-08-11', fim: '2026-09-10', estado: 'fechado',
      comecei_com: 86797, entrou: 633062, saiu: 719787, resultado: 72,
      caixa_no_fim: 72, faltou_pagar: 37164, confere: true,
    }] }),
    /*
      O CONTRATO de `MonthRange`: bordas + o estado da consulta que as resolve. Devolver só
      `{from, to}` passava pelo portão por ACASO (`!undefined`) e deixava `pronto` indefinido —
      o card de resumo dos Lançamentos caía no esqueleto e nenhum teste via.
    */
    useMonthRange: (month: string) => {
      const buscando = Boolean(options.rangePending || options.rangePendingMonths?.includes(month));
      return {
        from: `${month}-01`,
        to: `${month}-30`,
        pronto: !options.rangeError && !buscando,
        isPending: buscando,
        fetchStatus: buscando ? 'fetching' : 'idle',
        isError: Boolean(options.rangeError),
        refetch: async () => { refetches.push('range'); },
      };
    },
    /*
      Consulta INFINITA (`{pages}`), e o mesmo `enabled` do hook real: com `pronto: false` ela
      fica desligada — `isPending` para sempre, sem dado. É exatamente o estado que prendia a
      lista no esqueleto quando as bordas falhavam, então o dublê tem que reproduzi-lo.
    */
    useTransactions: (filters: { pronto?: boolean }) => filters.pronto === false
      ? { ...query, data: undefined, isPending: true, fetchStatus: 'idle', hasNextPage: false, isFetchingNextPage: false, fetchNextPage: () => {}, refetch: async () => { refetches.push('list'); } }
      // Uma linha: com a lista vazia o card do resumo SOME de propósito (card que soma uma lista
      // vazia é eco — design.md §1), e o caminho feliz não teria o que mostrar.
      : { ...query, data: { pages: [options.txs ?? [{ id: 'tx-1', kind: 'expense', amount_cents: 4500, occurred_at: '2026-09-15', description: 'Mercado', category: 'mercado', account_id: null, status: options.txStatus ?? 'cleared' }]], pageParams: [] }, isPending: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: () => {}, refetch: async () => { refetches.push('list'); } },
    useMonthSummary: () => ({ ...query, data: options.monthSummary ?? null }),
    useAccounts: () => ({ ...query, data: options.forecastAccounts ?? [] }),
    useCashFlowForecast: () => ({ ...query, data: [{ day: '2026-09-18', balance_cents: 10000, in_cents: 0, out_cents: 0 }] }),
    useCashHistory: () => ({ ...query, data: [] }),
    useAnticipationCandidates: (pagarEm: string) => ({ ...query, isSuccess: true,
      data: typeof options.anticipation === 'function' ? options.anticipation(pagarEm) : options.anticipation ?? [] }),
    useForecastWithDrafts: (_days: number, drafts: any[]) => {
      forecastDrafts = drafts;
      return { ...query, data: [{ day: '2026-09-18', balance_cents: 10000, in_cents: 0, out_cents: 0 }] };
    },
    useForecastMonths: () => ({ ...query, data: { hoje: 10000, meses: options.forecastMonths ?? [] }, isPlaceholderData: false }),
    // O mês é uma STRING (`2026-09`); sem este dublê o Proxy devolvia um objeto-consulta.
    useCycleMonth: () => '2026-09',
    useMonthBreakdown: () => ({ ...query, data: [] }),
    useSaveDebt: () => mutation('saveDebt'),
    useArchiveDebt: () => mutation('archiveDebt'),
    useUnarchiveDebt: () => mutation('unarchiveDebt'),
    useDeleteDebt: () => mutation('deleteDebt'),
    useArchivedDebts: () => ({ ...query, data: options.archivedDebts ?? [] }),
    useDebtSchedule: () => ({ ...query, data: options.debtSchedule ?? [] }),
    usePayoffStrategy: () => ({ ...query, data: options.payoff ?? [] }),
    useDebtPayments: () => options.paymentsError
      ? { ...query, isSuccess: false, isError: true, data: undefined, refetch: async () => { refetches.push('payments'); } }
      : { ...query, isSuccess: true, data: options.debtPayments ?? [] },
    pagamentosDaDivida: async () => ({ count: 0, totalCents: 0 }),
    useSaveAsset: () => mutation('saveAsset'),
    useArchiveAsset: () => mutation('archiveAsset'),
    useSettleInvoice: () => mutation('settleInvoice'),
    useUpcomingBills: () => ({
      ...query,
      isSuccess: !options.billsError,
      isError: Boolean(options.billsError),
      data: options.billsError ? undefined : (options.bills ?? []),
      refetch: async () => { refetches.push('bills'); },
    }),
    useUpcomingCardCharges: () => ({ ...query, isSuccess: true, data: options.charges ?? [] }),
    useBudgetsStatus: () => ({ ...query, isSuccess: true, data: options.budgets ?? [] }),
    useSpendablePath: () => ({ ...query, isSuccess: true, data: [] }),
    useCycle: () => ({ ...query, isSuccess: true, data: options.cycle ?? { de: '2026-09-01', ate: '2026-09-30', mes: '2026-09', diasAteOFim: 22 } }),
    useAccountBalances: () => ({
      ...query,
      isSuccess: !options.balancesError,
      isError: Boolean(options.balancesError),
      data: options.balancesError ? undefined : (options.balances ?? []),
      refetch: async () => { refetches.push('balances'); },
    }),
    // A MESMA função serve as duas fatias da Hoje; o que as separa é a janela pedida.
    useTransactionsSummary: (from: string, to: string) => ({
      ...query,
      isSuccess: true,
      data: from === to ? (options.saiuHoje ?? []) : (options.saiuNoCiclo ?? []),
      refetch: async () => { refetches.push('summary'); },
    }),
    useMarkPaid: () => mutation('markPaid'),
    usePayInvoice: () => mutation('payInvoice'),
    useInvoice: () => ({ ...query, data: {
      invoice: { id: 'invoice-1', account_id: 'card-1', status: options.invoiceStatus ?? 'closed', reference_month: '2026-08-01', closing_date: '2026-08-10', due_date: '2026-08-20', paid_at: options.invoiceStatus === 'paid' ? '2026-08-18' : null },
      transactions: [{ id: 'purchase-1', kind: 'expense', amount_cents: 147000, occurred_at: '2026-08-01' }],
    } }),
  }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => query });
  const load = (path: string): any => {
    const module = { exports: {} as any };
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    runInNewContext(code, { module, exports: module.exports, require: (name: string) => {
      if (name === 'react') return {
        Fragment: Symbol.for('react.fragment'),
        useState(initial: any) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], (value: any) => { state[index] = typeof value === 'function' ? value(state[index]) : value; if (renderizando) deNovo = true; }]; },
        useMemo: (fn: () => unknown) => fn(),
        useCallback: (fn: unknown) => fn,
        useRef: (v: unknown) => ({ current: v }),
        useEffect: () => {},
        memo: (componente: unknown) => componente,
        createContext: (valor: unknown) => ({ valor, Provider: 'Provider' }),
        useContext: (ctx: any) => ctx?.valor,
      };
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return { StyleSheet: { create: (value: unknown) => value }, View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', FlatList: 'FlatList', useWindowDimensions: () => ({ width: 384, height: 800 }), Platform: { OS: 'android', select: (o: any) => o.android ?? o.default } };
      if (name === 'react-native-reanimated') return { default: { View: 'AnimatedView' }, FadeInDown: animation, FadeOut: animation, FadeIn: animation, LinearTransition: animation, useAnimatedRef: () => ({ current: null }) };
      if (name === 'expo-haptics') return { selectionAsync() {}, notificationAsync() {}, NotificationFeedbackType: { Success: 'success', Warning: 'warning' } };
      // `back` é navegação como qualquer outra e ENTRA na lista: é o que prende o "fechar um
      // formulário que outra tela abriu devolve para ela" (`useVoltarQuandoFechar`).
      if (name === 'expo-router') return { Stack: { Screen: 'StackScreen' }, useLocalSearchParams: () => options.params ?? ({ id: 'invoice-1', ...(options.create !== false ? { create: 'financing' } : {}) }), router: { push: (to: any) => navigations.push(to), navigate: (to: any) => navigations.push(to), back: () => navigations.push({ back: true }) } };
      if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
      if (name === '@/hooks/use-finance') return finance;
      if (name === '@/hooks/use-aos-poucos') return load('src/hooks/use-aos-poucos.ts');
      if (name === '@/hooks/use-lock') return { useLock: () => ({ semTrancar: (fn: () => unknown) => fn() }) };
      // O voo da Carteira é camada da raiz; aqui só a forma dos hooks, inerte.
      if (name === '@/components/motion/flight-layer') return { useFlight: () => ({ voar: async () => false }), useFlightAnchor: () => ({ prender: null, aoPosicionar: undefined }), useFlightHidden: () => undefined };
      if (name === '@/hooks/use-adaptive-window') return {
        useAdaptiveWindow: () => ({
          width: options.tablet ? 1280 : 384,
          windowClass: options.tablet ? 'expanded' : 'compact',
          fontScale: 1,
        }),
      };
      if (name === '@/hooks/use-theme') return { useTheme: () => ({}), useScheme: () => 'light', PaletaTingida: 'PaletaTingida' };
      // portão de "a tela está pronta": no harness nada carrega, então ele já nasce aberto
      if (name === '@/hooks/use-tela-pronta') return { useTelaPronta: (...consultas: any[]) => { gates.push(consultas); return true; } };
      // Carregado DE VERDADE: ele é a regra que se quer testar, não um arredor da tela.
      if (name === '@/hooks/use-voltar-quando-fechar') return load('src/hooks/use-voltar-quando-fechar.ts');
      if (name === '@/hooks/use-items') return { localISODate: () => '2026-09-08', formatDateBR: () => '08/09/2026', formatBRL: load('src/lib/dates.ts').formatBRL, useRealtimeInvalidate: () => {}, useTodayReminders: () => ({ ...query, isSuccess: true, data: options.reminders ?? [] }), useReminders: () => ({ ...query, isSuccess: true, data: { pages: [options.reminders ?? []], pageParams: [0] }, hasNextPage: Boolean(options.maisPaginas), isFetchingNextPage: false, fetchNextPage: () => { refetches.push('proxima-pagina'); } }), useToggleReminder: () => mutation('toggleReminder'), useDeleteReminder: () => mutation('deleteReminder') };
      if (name === '@/hooks/use-session') return { useSession: () => ({ session: { user: { id: 'user-1' } } }) };
      if (name === '@/hooks/use-profile') return { useProfile: () => ({ ...query, isSuccess: true, data: { display_name: 'Gabriel Almeida', phone: null } }) };
      if (name === '@/hooks/use-proximo-passo') return { useProximoPasso: () => ({ passo: options.proximo ?? null, dispensar: (id: string) => writes.push({ operation: 'dispensarProximo', value: id }), consultas: [] }) };
      if (name === '@/hooks/use-setup-progress') return { useSetupProgress: () => ({ passos: options.setupPassos ?? [], pronto: true, consultas: [] }) };
      if (name === '@/hooks/use-bool-pref') return { useBoolPref: () => [false, () => {}] };
      // As dicas: a loja fica fora (aparelho); o que se prende é ONDE a tela as põe e o que o
      // gesto e o "Mostrar" pedem a ela.
      if (name === '@/hooks/use-dicas') return {
        useDica: () => true,
        useGuiaAberto: () => false,
        usarDica: (id: string) => writes.push({ operation: 'usarDica', value: id }),
        reacenderDica: (id: string) => writes.push({ operation: 'reacenderDica', value: id }),
        dispensarDica: () => {},
        marcarGuiaAberto: () => {},
      };
      if (name === '@/hooks/use-agent-activity') return {
        useAgentActivity: () => ({
          ...query,
          isSuccess: !options.activityError,
          isError: Boolean(options.activityError),
          data: options.activityError ? undefined : (options.activity ?? []),
          refetch: async () => { refetches.push('activity'); },
        }),
      };
      // Orçamentos consulta direto (a lista de linhas): o mesmo resultado inerte dos hooks.
      if (name === '@tanstack/react-query') return { useQuery: () => query, useMutation: () => mutation('mutation'), useQueryClient: () => ({ invalidateQueries: async () => {} }) };
      if (name === '@/lib/finance-form' || name === '@/lib/dates' || name === '@/lib/forecast-months' || name === '@/lib/month-view' || name === '@/lib/settle-labels' || name === '@/lib/accounts' || name === '@/lib/cycle-label' || name === '@/lib/card-status' || name === '@/lib/today-sections' || name === '@/lib/runway' || name === '@/lib/budget-tight' || name === '@/lib/setup-steps' || name === '@/lib/activity-feed' || name === '@/lib/account-cash' || name === '@/lib/today-spend' || name === '@/lib/anticipation' || name === '@/lib/widget-snapshot' || name === '@/lib/debt-history' || name === '@/lib/import-preview' || name === '@/lib/arrasto' || name === '@/lib/text' || name === '@/lib/installment-progress' || name === '@/lib/aos-poucos' || name === '@/lib/categories' || name === '@/lib/categories-merge' || name === '@/lib/alert-history' || name === '@/lib/data-da-compra' || name === '@/lib/dicas') return load(`src/lib/${name.split('/').at(-1)}.ts`);
      if (name === '@/hooks/use-debounced') return { useDebounced: (value: unknown) => value };
      if (name === '@/components/ui/glass-backdrop') return { GlassBackdrop: 'GlassBackdrop', supportsLiquidGlass: () => false };
      if (name === '@/hooks/use-note-sort') return { SORT_LABEL: {}, useNoteSort: () => ['manual', () => {}] };
      if (name === '@/components/notes/use-folder-menu') return { useFolderMenu: () => () => {} };
      if (name === '@/lib/rrule-text') return { describeRRule: () => 'todo mês' };
      if (name === '@/hooks/use-archived-folders') return { useArchivedFolders: () => ({ ...query, isSuccess: true, data: [] }) };
      if (name === '@/hooks/use-notes') return new Proxy({
        useNoteFolders: () => ({ ...query, isSuccess: true, data: options.folders ?? [] }),
        useNotesList: () => ({ ...query, isSuccess: true, data: { pages: [options.notes ?? []] }, hasNextPage: Boolean(options.maisPaginas), isFetchingNextPage: false, fetchNextPage: () => { refetches.push('proxima-pagina'); } }),
        folderTree: (lista: any[]) => lista.map((f) => ({ ...f, depth: 0 })),
        useArchivedCount: () => ({ ...query, isSuccess: true, data: options.arquivadas ?? 0 }),
      } as Record<string, any>, { get: (target, key) => key in target ? target[key as string] : () => mutation(String(key)) });
      if (name === '@/hooks/use-agent-chat') return {
        useAgentConversations: () => ({ ...query, isSuccess: true, hasNextPage: false, fetchNextPage() {}, data: { pages: [{ items: options.conversations ?? [] }] } }),
        useRenameAgentConversation: () => mutation('renameConversation'),
        useDeleteAgentConversation: () => mutation('deleteConversation'),
      };
      if (name === '@/components/notes/note-actions') return { actionSheet: () => {}, FOLDER_ICONS: [], notesLabel: (n: number) => `${n} notas`, symbol: () => 'folder' };
      if (name === '@/design/note-colors') return { noteInk: () => null, notePalette: (cor: string | null) => (cor ? { surface: `fundo-${cor}`, backgroundSelected: `forte-${cor}`, cardBorder: `borda-${cor}`, accentSoft: `forte-${cor}` } : null) };
      if (name === '@/hooks/use-search') return {
        useGlobalSearch: (_q: string, limite?: number) => {
          pedidosDeLimite.push(['busca', limite]);
          const r = (data: any[]) => ({ ...query, isSuccess: true, isLoading: false, data });
          return { notes: r(options.buscaNotas ?? []), transactions: r([]), reminders: r([]), enabled: true, term: 'mercado' };
        },
      };
      if (name === '@/lib/search') return { noteTitle: (texto: string) => texto.split('\n')[0], notePreview: () => '' };
      if (name === '@/lib/note-blocks') return { todoProgress: () => ({ done: 0, total: 0 }) };
      if (name === '@/design/category-icons') return { categoryIcon: () => 'circle' };
      if (name === '@/design/adaptive-window') return load('src/design/adaptive-window.ts');
      // import relativo DENTRO de um módulo puro já carregado (month-view → ./dates.ts)
      if (name === './dates.ts' || name === './dates') return load('src/lib/dates.ts');
      if (name === './debt-history.ts' || name === './debt-history') return load('src/lib/debt-history.ts');
      if (name === './text.ts' || name === './text') return load('src/lib/text.ts');
      // o `month-picker` é `.tsx` e importa React Native; aqui só as funções puras dele
      if (name === '@/components/finance/month-picker') return {
        MonthPicker: 'MonthPicker',
        currentMonth: () => '2026-09',
        monthLabel: (m: string) => m,
        monthShort: (m: string) => m,
        shiftMonth: (m: string, delta: number) => {
          const [y, mm] = m.split('-').map(Number);
          const d = new Date(y, mm - 1 + delta, 1);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        },
        monthTitle: (m: string) => {
          const [y, mm] = m.split('-').map(Number);
          const label = new Date(y, mm - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
          return label.charAt(0).toUpperCase() + label.slice(1);
        },
      };
      // `month-ruler` também é `.tsx`: o hook devolve a régua inerte, que é o que a tela
      // precisa para renderizar sem escolher nada.
      if (name === '@/components/finance/month-ruler') return {
        MonthRuler: 'MonthRuler',
        useMonthRuler: () => ({ view: 'cycle', setView: () => {}, temCiclo: false, cycle: { data: undefined } }),
      };
      if (name === '@/lib/item-actions') return { confirmDestructive: (_title: string, _label: string, callback: () => void, mensagem?: string) => { confirmations.push(callback); avisos.push(mensagem ?? ''); }, showItemActions: (_title: string, entries: any[]) => actions.push(...entries) };
      if (name === '@/components/ui/toast') return { useToast: () => (t: any) => toasts.push(t), useSubirAcimaDoToast: () => ({}) };
      // O provider de "esconder saldo" só existe dentro da árvore real; aqui o valor aparece.
      if (name === '@/components/ui/conceal') return {
        useConceal: () => ({ concealed: false, toggle: () => {} }),
        concealText: () => '••••••',
        useBRL: () => (cents: number) => `R$ ${(cents / 100).toFixed(2)}`,
      };
      if (name === '@/design/tokens') return { Motion: { duration: {}, stagger: {} }, Space: {}, Radius: {}, tabular: {}, Elevation: { light: {}, dark: {} }, Type: new Proxy({}, { get: () => ({}) }) };
      return new Proxy({}, { get: (_, key) => String(key) });
    } });
    return module.exports;
  };
  // `componente`: um componente nomeado (o card de nota), renderizado com `props`.
  const Component = load(file)[options.componente ?? 'default'];
  const visit = (node: any) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node?.props || (node.type === 'Sheet' && !node.props.visible)) return;
    nodes.push(node);
    visit(node.props.children);
    // Tablet adapters hold the existing blocks in named slots, not children. Visit those slots
    // too so the same behavior assertions cover both compositions.
    if (node.type === 'TodayTabletCanvas') {
      for (const slot of ['hero', 'signals', 'pulse', 'actions', 'accounts', 'coming']) visit(node.props[slot]);
    }
    if (node.type === 'FinanceTabletCanvas') {
      for (const slot of ['cycle', 'actions', 'ledger', 'breakdown']) visit(node.props[slot]);
    }
    if (node.type === 'FinanceAnalysisPanes') visit(node.props.compact);
    // No celular o `AdaptivePanes` desenha o slot de uma coluna só (Pastas, Recorrentes…).
    if (node.type === 'AdaptivePanes') visit(node.props.singlePaneContent ?? node.props.main);
    visit(node.props.ListHeaderComponent);
    // Mesmo motivo do header: slot é conteúdo renderizado. As ações da fatura desceram para o
    // FIM da lista em 15/09/2026 (botão fixo sobre o scroll foi recusado pelo dono do produto),
    // e sem esta linha elas somem daqui enquanto continuam na tela.
    visit(node.props.ListFooterComponent);
    // O estado vazio da lista também é slot renderizado — e é ONDE a lista dos Lançamentos
    // desenhava três linhas de esqueleto para sempre quando as bordas do período falhavam.
    visit(node.props.ListEmptyComponent);
    // As linhas de `FlatList`/`SectionList` são `renderItem` — é nelas que mora o card de uma
    // lista longa (Lançamentos, fatura), e sem isto nenhum teste enxergava a linha.
    if (typeof node.props.renderItem === 'function') {
      const itens = Array.isArray(node.props.sections)
        ? node.props.sections.flatMap((section: any) => (section.data ?? []).map((item: any) => ({ item, section })))
        : (Array.isArray(node.props.data) ? node.props.data : []).map((item: any) => ({ item }));
      itens.forEach((x: any, index: number) => visit(node.props.renderItem({ ...x, index })));
    }
    // O "Salvar" do sheet mora no slot `action` do `SheetHeader`, não em `children` — sem esta
    // linha o botão existe na tela e some daqui, que foi o que estas seis asserções viram.
    visit(node.props.action);
    // Ação de header é DECLARADA como dado (`actions={[{label, onPress}]}`) e desenhada como
    // botão pela plataforma — o "+" que abre todo formulário de lista (§8 do design) mora aí.
    // Sem esta linha nenhum sheet de criação é alcançável por este harness. `ItemLink` também
    // tem `actions`, mas aquilo é menu de contexto, não botão visível: só `HeaderActions`.
    if (node.type === 'HeaderActions' && Array.isArray(node.props.actions))
      node.props.actions.forEach((a: any) => nodes.push({ type: 'Button', props: a }));
  };
  const render = () => {
    for (let vez = 0; vez < 5; vez++) {
      cursor = 0; nodes = []; deNovo = false; renderizando = true;
      try { visit(Component(options.props ?? {})); } finally { renderizando = false; }
      if (!deNovo) return;
    }
  };
  render();
  return {
    writes, pedidos, toasts, pedidosDeLimite, avisos, confirmations, actions, navigations, refetches, gates,
    drafts: () => forecastDrafts,
    nodes: () => nodes,
    button(label: string) { const node = nodes.find((n) => n.type === 'Button' && n.props.label === label); assert.ok(node, `visible button: ${label}`); return node; },
    press(label: string) { const node = this.button(label); assert.ok(!node.props.disabled, `${label} must be enabled`); node.props.onPress(); render(); },
    fill(label: string, value: string | number) { const field = nodes.find((n) => n.type === 'Field' && n.props.label === label); assert.ok(field, `visible field: ${label}`); const children: any[] = []; const collect = (n: any) => { if (Array.isArray(n)) return n.forEach(collect); if (n?.props) { children.push(n); collect(n.props.children); } }; collect(field); const input = children.find((n) => ['TextField', 'MoneyField', 'QuantityField', 'DatePickerField'].includes(n.type)); assert.ok(input); if (input.type === 'QuantityField') input.props.onChange(Number(value)); else (input.props.onChangeText ?? input.props.onChangeCents ?? input.props.onChange)(value); render(); },
    interact(callback: (nodes: any[]) => void) { callback(nodes); render(); },
  };
}
const debtsFile = 'src/app/finance/debts.tsx';
const forecastFile = 'src/app/finance/forecast.tsx';

test('E se: Ver resultado funciona na primeira hipótese, com Adicionar mais uma disponível em paralelo', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }] });
  ui.press('Supor um lançamento');
  ui.fill('Valor', 25000);
  assert.equal(ui.button('Adicionar mais uma').props.disabled, false);
  ui.press('Ver resultado');

  assert.equal(ui.drafts().length, 1);
  assert.equal(ui.drafts()[0].kind, 'income');
  assert.equal(ui.drafts()[0].amount_cents, 25000);
  assert.ok(ui.nodes().some((n: any) => n.type === 'ThemedText' && n.props.children === 'Rascunho'));
  assert.equal(ui.nodes().some((n: any) => n.type === 'Sheet' && n.props.visible), false);
  assert.deepEqual(ui.writes, []);
});

test('E se: Adicionar mais uma prepara várias hipóteses sem fechar; Ver resultado inclui a última', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }] });
  ui.press('Supor um lançamento');
  ui.fill('Valor', 25000);
  ui.press('Adicionar mais uma');
  assert.ok(ui.nodes().some((n: any) => n.type === 'Sheet' && n.props.visible));
  assert.equal(ui.button('Adicionar mais uma').props.disabled, true);
  assert.equal(ui.button('Ver resultado').props.disabled, false);
  ui.fill('Valor', 10000);
  ui.press('Adicionar mais uma');
  assert.deepEqual(Array.from(ui.drafts(), (d: any) => d.amount_cents), [25000, 10000]);

  ui.fill('Valor', 5000);
  ui.press('Ver resultado');
  assert.deepEqual(Array.from(ui.drafts(), (d: any) => d.amount_cents), [25000, 10000, 5000]);
  assert.equal(ui.nodes().some((n: any) => n.type === 'Sheet' && n.props.visible), false);
  assert.deepEqual(ui.writes, []);
});

test('E se: adiantar vira UMA hipótese — o pagamento e um cancelamento por parcela, no dia de cada uma', () => {
  const carro = {
    source: 'debt', ref_id: 'd1', title: 'Carro', account_name: null, total_n: 48, taxa: 0.0199,
    events: [
      { n: 46, day: '2029-01-15', cents: 124500, pv_cents: 80000 },
      { n: 47, day: '2029-02-15', cents: 124500, pv_cents: 79000 },
      { n: 48, day: '2029-03-15', cents: 124500, pv_cents: 78000 },
    ],
  };
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], anticipation: [carro] });
  ui.press('Supor um lançamento');
  const tipo = () => ui.nodes().find((n: any) => n.type === 'Segmented'
    && n.props.options.some((o: any) => o.value === 'adiantar'));
  ui.interact(() => tipo().props.onChange('adiantar'));
  const campos = () => ui.nodes().find((n: any) => n.type === 'AdiantarCampos');
  assert.equal(ui.button('Ver resultado').props.disabled, true, 'sem item escolhido não há hipótese');

  ui.interact(() => campos().props.onItem('d1'));
  ui.interact(() => campos().props.onQuantas(2));
  // o padrão é "as últimas", e o valor nasce na soma dos valores presentes
  assert.equal(campos().props.valor, 79000 + 78000);
  ui.press('Ver resultado');

  const drafts = ui.drafts();
  assert.equal(drafts.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(drafts.map((d: any) => [d.mode, d.amount_cents, d.start]).slice(1))), [
    ['cancel', 124500, '2029-02-15'],
    ['cancel', 124500, '2029-03-15'],
  ]);
  assert.equal(drafts[0].mode, 'total');
  assert.equal(drafts[0].amount_cents, 157000);
  assert.ok(ui.nodes().some((n: any) => n.type === 'ThemedText'
    && String(n.props.children).includes('adianta 2 parcelas de Carro')), 'a lista mostra uma linha');
  assert.deepEqual(ui.writes, []);

  // Tocar na linha EDITA: o sheet volta com a escolha feita e o valor aprovado
  const linha = () => ui.nodes().find((n: any) => n.type === 'Pressable'
    && String(n.props.accessibilityLabel).startsWith('Editar hipótese'));
  assert.equal(ui.nodes().some((n: any) => n.type === 'Button' && n.props.label === 'Tirar'), false,
    'o card não tem um botão por linha');
  ui.interact(() => linha().props.onPress());
  assert.ok(ui.nodes().some((n: any) => n.type === 'TaskHeader' && n.props.title === 'Editar hipótese'));
  assert.equal(campos().props.itemId, 'd1');
  assert.equal(campos().props.quantas, 2);
  assert.equal(campos().props.valor, 157000);
  assert.equal(ui.nodes().some((n: any) => n.type === 'Button' && n.props.label === 'Adicionar mais uma'), false);

  // mudar a quantidade volta à sugestão e Salvar TROCA a hipótese, não soma outra
  ui.interact(() => campos().props.onQuantas(3));
  assert.equal(campos().props.valor, 80000 + 79000 + 78000);
  ui.press('Salvar');
  assert.equal(ui.drafts().length, 4, 'um pagamento e três cancelamentos, a hipótese antiga saiu');
  assert.equal(ui.drafts().filter((d: any) => d.mode === 'total').length, 1);
  assert.ok(ui.nodes().some((n: any) => n.type === 'ThemedText'
    && String(n.props.children).includes('adianta 3 parcelas de Carro')));

  // "Tirar hipótese" mora no sheet de edição e leva o grupo inteiro
  ui.interact(() => linha().props.onPress());
  ui.press('Tirar hipótese');
  assert.equal(ui.drafts().length, 0);
});

test('E se: trocar o mês do pagamento para depois das parcelas escolhidas DIMINUI a quantidade sozinho', () => {
  // 22/09/2026: 4x escolhidas em setembro, pagar em dezembro. Primeiro virou um erro que travava
  // a hipótese; o dono do produto pediu o número diminuindo sozinho. Campo, valor e hipótese
  // leem o MESMO número assentado.
  const eventos = [
    { n: 5, day: '2026-10-10', cents: 10000, pv_cents: 10000 },
    { n: 6, day: '2026-11-10', cents: 10000, pv_cents: 10000 },
    { n: 7, day: '2026-12-10', cents: 10000, pv_cents: 10000 },
    { n: 8, day: '2027-01-10', cents: 10000, pv_cents: 10000 },
  ];
  const tv = (pagarEm: string) => [{ source: 'plan', ref_id: 'p1', title: 'TV', account_name: null,
    total_n: 8, taxa: null, events: eventos.filter((e) => e.day > pagarEm) }];
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], anticipation: tv });
  ui.press('Supor um lançamento');
  ui.interact((nodes) => nodes.find((n: any) => n.type === 'Segmented'
    && n.props.options.some((o: any) => o.value === 'adiantar')).props.onChange('adiantar'));
  const campos = () => ui.nodes().find((n: any) => n.type === 'AdiantarCampos');
  ui.interact(() => campos().props.onItem('p1'));
  ui.interact(() => campos().props.onQuantas(4));
  assert.equal(campos().props.quantas, 4);

  ui.interact(() => campos().props.onMes('2026-12'));
  assert.equal(campos().props.quantas, 2, 'assentou nas 2 que ainda vencem');
  assert.equal('erroQuantidade' in campos().props, false, 'não existe mais erro');
  assert.equal(ui.button('Ver resultado').props.disabled, false);
  ui.press('Ver resultado');
  assert.equal(ui.drafts().filter((d: any) => d.mode === 'cancel').length, 2);
});

test('E se: editar uma entrada troca o valor e as parcelas no mesmo lugar da lista', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }] });
  ui.press('Supor um lançamento');
  ui.fill('Valor', 25000);
  ui.press('Adicionar mais uma');
  ui.fill('Valor', 10000);
  ui.press('Ver resultado');
  const linhas = () => ui.nodes().filter((n: any) => n.type === 'Pressable'
    && String(n.props.accessibilityLabel).startsWith('Editar hipótese'));
  assert.equal(linhas().length, 2);

  ui.interact(() => linhas()[0].props.onPress());
  assert.equal(ui.button('Salvar').props.disabled, false);
  ui.fill('Valor', 30000);
  ui.interact((nodes) => nodes.find((n: any) => n.type === 'QuantityField'
    && n.props.accessibilityLabel === 'Em quantas vezes').props.onChange(3));
  ui.press('Salvar');

  assert.deepEqual(JSON.parse(JSON.stringify(ui.drafts().map((d: any) => [d.amount_cents, d.installments]))),
    [[30000, 3], [10000, 1]]);
  assert.equal(ui.nodes().some((n: any) => n.type === 'Sheet' && n.props.visible), false);
  assert.deepEqual(ui.writes, []);
});

test('E se: Ver resultado depois de Somar não duplica a hipótese já adicionada', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }] });
  ui.press('Supor um lançamento');
  ui.fill('Valor', 25000);
  ui.press('Adicionar mais uma');
  ui.press('Ver resultado');
  assert.equal(ui.drafts().length, 1);
  assert.equal(ui.nodes().some((n: any) => n.type === 'Sheet' && n.props.visible), false);
});

test('new financing: Nome and Conta first, the name is required and the typed one is saved', () => {
  const ui = screen(debtsFile);
  // 23/09/2026: "Nome e conta" era uma linha recolhida no FIM, e o nome caía em "Financiamento 2".
  assert.deepEqual(ui.nodes().filter((n) => n.type === 'Field').map((n) => n.props.label), ['Nome', 'Conta que paga', 'Valor', 'Total de parcelas', 'Parcelas já pagas', 'Primeira parcela']);
  assert.equal(ui.nodes().some((n) => n.type === 'Row' && n.props.title === 'Nome e conta'), false);
  assert.equal(ui.button('Salvar').props.disabled, true);
  ui.fill('Valor', 147000);
  ui.fill('Total de parcelas', '48');
  // A data ancora o cronograma: sem ela a projeção chuta quando o dinheiro sai.
  assert.equal(ui.button('Salvar').props.disabled, true);
  ui.fill('Primeira parcela', '05/12/2026');
  // Tudo preenchido menos o nome: o Salvar segue travado e o campo diz por quê.
  assert.equal(ui.button('Salvar').props.disabled, true);
  assert.equal(ui.nodes().find((n) => n.type === 'Field' && n.props.label === 'Nome').props.error, 'Dê um nome');
  ui.fill('Nome', 'Carro');
  ui.press('Salvar');
  const saved = ui.writes[0].value;
  assert.equal(ui.writes.length, 1);
  assert.equal(saved.name, 'Carro');
  assert.equal(saved.kind, 'financing');
  assert.equal(saved.calculation_mode, 'fixed_installments');
  assert.equal(saved.installments, 48);
  assert.equal(saved.installments_paid, 0);
  assert.equal(saved.installment_cents, 147000);
  assert.equal(saved.principal_cents, 7056000);
  assert.equal(saved.remaining_cents, 7056000);
  assert.equal(saved.interest_rate_monthly, 0);
  assert.equal(saved.due_day, 5);
  assert.equal(saved.first_due_date, '2026-12-05');
  assert.equal(saved.account_id, null);
});

test('"Total a pagar" divides by the count and saves the contract that the check accepts', () => {
  const ui = screen(debtsFile);
  ui.fill('Nome', 'Carro');
  ui.interact((nodes) => nodes.find((n) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'total')).props.onChange('total'));
  ui.fill('Valor', 7000000);
  ui.fill('Total de parcelas', '48');
  ui.fill('Primeira parcela', '05/12/2026');
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.installment_cents, 145833);
  assert.equal(ui.writes[0].value.principal_cents, 145833 * 48, 'grava parcela × N, nunca o digitado');
});

test('paid history moves the anchor: the date asked is the NEXT one, and the first is derived', () => {
  const ui = screen(debtsFile);
  ui.fill('Nome', 'Carro');
  ui.fill('Valor', 147000);
  ui.fill('Total de parcelas', '48');
  ui.fill('Parcelas já pagas', '8');
  ui.fill('Próxima parcela (a 9ª)', '05/10/2026');
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.installments_paid, 8);
  assert.equal(ui.writes[0].value.remaining_cents, 5880000);
  assert.equal(ui.writes[0].value.principal_cents, 7056000);
  assert.equal(ui.writes[0].value.first_due_date, '2026-02-05');
});

test('history above the contract total settles on the total instead of blocking (22/09/2026)', () => {
  const ui = screen(debtsFile);
  ui.fill('Nome', 'Carro');
  ui.fill('Valor', 147000);
  ui.fill('Total de parcelas', '48');
  ui.fill('Parcelas já pagas', '49');
  ui.fill('Próxima parcela (a 49ª)', '05/10/2026');
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.installments_paid, 48, 'nunca mais pagas que o contrato');
  assert.equal(ui.writes[0].value.installments, 48);
});

const carro = {
  id: 'd1', name: 'Carro', kind: 'financing', calculation_mode: 'fixed_installments',
  principal_cents: 7056000, remaining_cents: 5880000, interest_rate_monthly: 0, installments: 48,
  installments_paid: 8, installment_cents: 147000, account_id: null, due_day: 5, archived: false,
  first_due_date: '2026-02-05',
};
const editar = (ui: any) => {
  ui.interact((nodes: any[]) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.onLongPress).props.onLongPress());
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Editar').onPress());
};

test('editing the paid count keeps the contract calendar: the next date follows the anchor', () => {
  const ui = screen(debtsFile, { create: false, debts: [carro] });
  editar(ui);
  ui.fill('Parcelas já pagas', '10');
  const data = ui.nodes().find((n) => n.type === 'Field' && n.props.label === 'Próxima parcela (a 11ª)');
  assert.ok(data, 'o rótulo segue as pagas');
  ui.press('Salvar');
  const saved = ui.writes[0].value;
  assert.equal(saved.id, 'd1');
  assert.equal(saved.installments_paid, 10);
  assert.equal(saved.remaining_cents, 147000 * 38);
  assert.equal(saved.first_due_date, '2026-02-05');
  assert.equal(saved.due_day, 5);
});

test('long press on an active debt offers the full set, including delete for good', () => {
  const ui = screen(debtsFile, { create: false, debts: [carro] });
  ui.interact((nodes: any[]) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.onLongPress).props.onLongPress());
  assert.deepEqual(ui.actions.map((a: any) => a.label), ['Pagar parcela', 'Ver as parcelas', 'Editar', 'Arquivar', 'Excluir por completo']);
});

test('archived debts have a place to come back from', () => {
  const ui = screen(debtsFile, { create: false, debts: [carro], archivedDebts: [{ ...carro, id: 'd2', name: 'Moto', archived: true }] });
  const linha = ui.nodes().find((n) => n.type === 'Row' && n.props.title === 'Arquivadas · 1');
  assert.ok(linha, 'a seção das arquivadas existe');
  ui.interact(() => linha.props.onPress());
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Row' && n.props.title === 'Moto').props.onPress());
  assert.deepEqual(ui.actions.map((a: any) => a.label), ['Desarquivar', 'Excluir por completo']);
  ui.interact(() => ui.actions[0].onPress());
  assert.deepEqual(ui.writes.at(-1), { operation: 'unarchiveDebt', value: 'd2' });
});

test('"Desfazer"/Desarquivar de uma dívida que já não existe não diz que ela voltou', () => {
  const ui = screen(debtsFile, { create: false, debts: [carro], archivedDebts: [{ ...carro, id: 'd2', name: 'Moto', archived: true }] });
  ui.interact(() => ui.nodes().find((n) => n.type === 'Row' && n.props.title === 'Arquivadas · 1').props.onPress());
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Row' && n.props.title === 'Moto').props.onPress());
  ui.interact(() => ui.actions[0].onPress());
  ui.interact(() => ui.pedidos.at(-1).opts.onSuccess(false));
  assert.doesNotMatch(ui.toasts.at(-1).message, /voltou/);
  assert.match(ui.toasts.at(-1).message, /não existe mais/);
  ui.interact(() => ui.pedidos.at(-1).opts.onSuccess(true));
  assert.match(ui.toasts.at(-1).message, /voltou para a lista/);
});

test('salvar a edição manda a versão que foi aberta, e a dívida que mudou no meio vira aviso', () => {
  const ui = screen(debtsFile, { create: false, debts: [{ ...carro, updated_at: '2026-09-24T10:00:00.123456+00:00' }] });
  editar(ui);
  ui.fill('Nome', 'Carro novo');
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.versao, '2026-09-24T10:00:00.123456+00:00');
  ui.interact(() => ui.pedidos.at(-1).opts.onError(Object.assign(new Error('x'), { code: 'VERSAO' })));
  assert.match(ui.toasts.at(-1).message, /mudou enquanto você editava/);
});

test('without archived debts there is no empty "Arquivadas" row', () => {
  const ui = screen(debtsFile, { create: false, debts: [carro] });
  assert.equal(ui.nodes().some((n) => n.type === 'Row' && String(n.props.title).startsWith('Arquivadas')), false);
});

test('delete for good asks with the consequence first, then deletes', async () => {
  const ui = screen(debtsFile, { create: false, debts: [carro] });
  ui.interact((nodes: any[]) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.onLongPress).props.onLongPress());
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Excluir por completo').onPress());
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ui.writes.some((w: any) => w.operation === 'deleteDebt'), false, 'nada sai antes do SIM');
  assert.equal(ui.confirmations.length, 1);
  ui.interact(() => ui.confirmations[0]());
  assert.deepEqual(ui.writes.at(-1), { operation: 'deleteDebt', value: 'd1' });
});

test('the detail has the "…" with the same actions as the long press', () => {
  const ui = screen(debtsFile, { create: false, debts: [carro] });
  ui.interact((nodes: any[]) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.onLongPress).props.onPress());
  const menu = ui.nodes().find((n) => n.type === 'HeaderIconButton' && n.props.label === 'Mais ações');
  assert.ok(menu, 'o detalhe tem o "…" no alto');
  ui.interact(() => menu.props.onPress());
  // no detalhe "Ver as parcelas" sai: é o que já se está vendo
  assert.deepEqual(ui.actions.map((a: any) => a.label), ['Editar', 'Arquivar', 'Excluir por completo']);
});

test('detalhe da dívida: "A seguir" começa na próxima, 20 por vez, e "Já pagas" vem da mais recente', () => {
  const futuras = Array.from({ length: 30 }, (_, i) => ({
    installment_no: 9 + i, due_date: `${2026 + Math.floor((9 + i) / 12)}-${String(((9 + i) % 12) + 1).padStart(2, '0')}-05`,
    payment_cents: 147000, interest_cents: null, principal_cents: null, balance_cents: 0,
  }));
  const ui = screen(debtsFile, { create: false, debts: [{ ...carro, installments_paid: 8 }], debtSchedule: futuras });
  ui.interact((nodes: any[]) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.onLongPress).props.onPress());
  const linhas = () => ui.nodes().filter((n: any) => n.type === 'DebtTimeline');
  const seguir = () => linhas()[0].props.anos.flatMap((a: any) => a.itens);
  assert.equal(seguir()[0].n, 9, 'a próxima no topo');
  assert.equal(seguir().length, 20, 'só o primeiro passo');
  const pagas = linhas()[1].props.anos.flatMap((a: any) => a.itens);
  assert.deepEqual(JSON.parse(JSON.stringify(pagas.map((i: any) => i.n))), [8, 7, 6, 5, 4, 3, 2, 1], 'a mais recente primeiro');
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais' && n.props.restantes === 10);
  assert.ok(mais, '"Ver mais" com as 10 que faltam');
  ui.interact(() => mais.props.onPress());
  assert.equal(seguir().length, 30);
});

test('detalhe da dívida: juros de R$ 0,00 não viram linha vermelha; juros de verdade continuam', () => {
  const texto = (ui: any) => JSON.stringify(ui.nodes().filter((n: any) => n.type === 'ThemedText').map((n: any) => n.props.children));
  const abrir = (juros: number | null) => {
    const ui = screen(debtsFile, {
      create: false,
      debts: [{ ...carro, calculation_mode: 'amortized', interest_rate_monthly: juros ? 0.0199 : 0 }],
      debtSchedule: [{ installment_no: 9, due_date: '2026-10-05', payment_cents: 147000, interest_cents: juros, principal_cents: 147000, balance_cents: 0 }],
    });
    ui.interact((nodes: any[]) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.onLongPress).props.onPress());
    return texto(ui);
  };
  assert.doesNotMatch(abrir(0), /são juros/, 'sem juros, nada a avisar');
  assert.match(abrir(29000), /são juros/);
});

test('por onde começar: dívida com juros ZERO diz "sem juros", como a linha dela', () => {
  const moto = { ...carro, id: 'd2', name: 'Moto', calculation_mode: 'amortized', interest_rate_monthly: 0 };
  const ui = screen(debtsFile, {
    create: false,
    debts: [carro, moto],
    payoff: [{ debt_id: 'd2', name: 'Moto', interest_rate_monthly: 0, months_left: 11, remaining_cents: 110000 }],
  });
  const texto = JSON.stringify(ui.nodes().filter((n: any) => n.type === 'ThemedText').map((n: any) => n.props.children));
  assert.doesNotMatch(texto, /juros 0/);
  assert.match(texto, /sem juros/);
});

test('editing the paid count of an OLD debt keeps the date its schedule shows (final review, 23/09/2026)', () => {
  // A dívida antiga não tem âncora: deduzir uma de `schedule[0]` − pagas levaria a data meses para
  // a frente quando a pessoa corrige as pagas (5 → 9), e parcelas sumiriam da projeção.
  const ui = screen(debtsFile, {
    create: false,
    debts: [{ ...carro, first_due_date: null, installments_paid: 5, remaining_cents: 147000 * 43 }],
    debtSchedule: [{ installment_no: 6, due_date: '2026-10-05', payment_cents: 147000, interest_cents: null, principal_cents: null, balance_cents: 0 }],
  });
  editar(ui);
  ui.fill('Parcelas já pagas', '9');
  const campo = ui.nodes().find((n) => n.type === 'DatePickerField');
  assert.equal(campo.props.value, '05/10/2026', 'a data mostrada é a do cronograma, não uma deduzida');
  ui.press('Salvar');
  assert.equal('first_due_date' in ui.writes[0].value, false, 'sem tocar na data, nada de âncora');
  assert.equal(ui.writes[0].value.installments_paid, 9);
});

test('editar com os pagamentos sem carregar diz por que o Salvar não liga, e tenta de novo', () => {
  const ui = screen(debtsFile, { create: false, debts: [{ ...carro }], paymentsError: true });
  editar(ui);
  assert.equal(ui.button('Salvar').props.disabled, true);
  const faixa = ui.nodes().find((n: any) => typeof n.type === 'function' && n.type.name === 'ErrorBand' && /pagamentos/.test(n.props.message));
  assert.ok(faixa, 'a faixa de erro aparece no formulário');
  faixa.props.onRetry();
  assert.ok(ui.refetches.includes('payments'));
});

test('as pagas não descem abaixo da maior parcela já paga pelo app (não só da contagem)', () => {
  // Um "Paguei" lançado como a 5ª: dizer 4 pagas deixaria a 5ª paga aparecendo como futura.
  const ui = screen(debtsFile, {
    create: false,
    debts: [{ ...carro, installments_paid: 5, remaining_cents: 147000 * 43 }],
    debtPayments: [{ debt_payment_no: 5, occurred_at: '2026-09-05', amount_cents: 147000 }],
  });
  editar(ui);
  ui.fill('Parcelas já pagas', '4');
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.installments_paid, 5);
});

test('diminuir as pagas de uma dívida com âncora nunca mostra uma próxima parcela no passado', () => {
  // Contrato com 1ª em 05/02/2026 e 9 pagas: a 10ª é 05/11. Corrigir para 5 levaria a 6ª a 05/07,
  // que já passou — o cronograma a mostra na próxima ocorrência do dia 5 a partir de hoje (08/09).
  const ui = screen(debtsFile, { create: false, debts: [{ ...carro, first_due_date: '2026-02-05', installments_paid: 9, remaining_cents: 147000 * 39 }] });
  editar(ui);
  ui.fill('Parcelas já pagas', '5');
  const campo = ui.nodes().find((n) => n.type === 'DatePickerField');
  assert.equal(campo.props.value, '05/10/2026');
});

test('a month-end contract keeps day 31 when the chosen date falls in a short month (final review)', () => {
  const ui = screen(debtsFile, { create: false, debts: [{ ...carro, due_day: 31, first_due_date: '2026-01-31', installments_paid: 1, remaining_cents: 147000 * 47 }] });
  editar(ui);
  ui.fill('Próxima parcela (a 2ª)', '28/02/2026');
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.due_day, 31, 'o 28 de fevereiro é o 31 clampado');
});

test('editing an OLD debt without its schedule loaded never invents an anchor', () => {
  const ui = screen(debtsFile, { create: false, debts: [{ ...carro, first_due_date: null }] });
  editar(ui);
  ui.fill('Nome', 'Carro novo');
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.name, 'Carro novo');
  assert.equal('first_due_date' in ui.writes[0].value, false);
  assert.equal(ui.writes[0].value.due_day, 5);
});

test('detailed mode still exposes the financial inputs', () => {
  const ui = screen(debtsFile);
  ui.interact((nodes) => nodes.find((n) => n.type === 'Segmented').props.onChange('amortized'));
  const labels = ui.nodes().filter((n) => n.type === 'Field').map((n) => n.props.label);
  for (const label of ['Nome', 'Quanto você deve hoje', 'Valor original', 'Juros por mês']) assert.ok(labels.includes(label), label);
  assert.equal(ui.button('Salvar').props.disabled, true);
});

test('a debt without installments has no cadence, so it never demands a due day', () => {
  // "Devo 500 pro João": exigir dia de vencimento aqui travaria o cadastro por
  // um dado que o contrato não tem. A trava vale só para contrato com parcelas.
  // `create: 'financing'` no deep link nasce como financiamento, que exige parcelas.
  const ui = screen(debtsFile, { create: false });
  ui.interact((nodes) => nodes.find((n) => n.type === 'EmptyState').props.action.onPress());
  ui.interact((nodes) => nodes.find((n) => n.type === 'Segmented').props.onChange('amortized'));
  ui.fill('Nome', 'João');
  ui.fill('Quanto você deve hoje', 50000);
  ui.fill('Juros por mês', '0');
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.due_day, null);
  assert.equal(ui.writes[0].value.remaining_cents, 50000);
});

test('fechar um formulário que OUTRA tela abriu devolve para aquela tela', () => {
  // A queixa (15/09/2026): *"cliquei em editar a compra inteira e quando eu clico em voltar,
  // ao invés de voltar para a tela onde eu estava, ele me leva para a tela de Parceladas"*.
  // Chegar num formulário de sheet vindo de fora é um `push` na tela da LISTA com parâmetro;
  // fechar o sheet tem que fechar também a tela que só existia para hospedá-lo.
  const ui = screen(debtsFile);
  const cabecalhos = ui.nodes().filter((n) => n.type === 'TaskHeader');
  assert.equal(cabecalhos.length, 1, 'só o sheet do formulário está aberto');
  ui.interact(() => cabecalhos[0].props.onClose());
  assert.deepEqual(ui.navigations, [{ back: true }]);
});

test('e quem abriu o formulário PELA PRÓPRIA tela continua nela', () => {
  // O espelho do caso acima, e o que quebra se alguém marcar "veio de fora" sem condição:
  // fechar levaria a pessoa para fora de uma lista que ela abriu de propósito.
  const ui = screen(debtsFile, { create: false });
  ui.interact((nodes) => nodes.find((n) => n.type === 'EmptyState').props.action.onPress());
  ui.interact((nodes) => nodes.find((n) => n.type === 'TaskHeader').props.onClose());
  assert.deepEqual(ui.navigations, []);
});

test('o detalhe da dívida aberto por OUTRA tela (?id=) devolve para ela ao fechar', () => {
  // O pagamento de uma dívida (Editar lançamento) e a prestação no ciclo abrem ESTA dívida.
  const fora = screen(debtsFile, { create: false, debts: [carro], params: { id: 'd1' } });
  fora.interact((nodes) => nodes.find((n) => n.type === 'TaskHeader' && n.props.title === 'Carro').props.onClose());
  assert.deepEqual(fora.navigations, [{ back: true }]);

  // E o que se abriu a partir dele também: pagar a parcela e fechar volta para onde se estava.
  const pagando = screen(debtsFile, {
    create: false, debts: [carro], params: { id: 'd1' },
    debtSchedule: [{ installment_no: 9, due_date: '2026-10-05', payment_cents: 147000, interest_cents: null, principal_cents: null, balance_cents: 0 }],
  });
  pagando.press('Paguei esta parcela');
  pagando.interact((nodes) => nodes.find((n) => n.type === 'TaskHeader' && /^Pagar/.test(n.props.title)).props.onClose());
  assert.deepEqual(pagando.navigations, [{ back: true }]);

  // Quem abriu pela própria lista continua nela.
  const lista = screen(debtsFile, { create: false, debts: [carro], params: {} });
  lista.interact((nodes: any[]) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.onLongPress).props.onPress());
  lista.interact((nodes) => nodes.find((n) => n.type === 'TaskHeader' && n.props.title === 'Carro').props.onClose());
  assert.deepEqual(lista.navigations, []);
});

test('editing a legacy amortized financing preserves its mode and remaining-term semantics', () => {
  const ui = screen(debtsFile, { create: false, debts: [{ id: 'old-debt', name: 'Carro', kind: 'financing', calculation_mode: 'amortized', principal_cents: 7056000, remaining_cents: 5880000, installments: 48, installments_paid: 8, installment_cents: 147000, interest_rate_monthly: 0.0199, account_id: null, due_day: 10 }] });
  ui.interact((nodes) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.onLongPress).props.onLongPress());
  ui.interact(() => ui.actions.find((a) => a.label === 'Editar')!.onPress());
  assert.ok(ui.nodes().some((n) => n.type === 'Field' && n.props.label === 'Juros por mês'));
  assert.ok(!ui.nodes().some((n) => n.type === 'Segmented'));
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.id, 'old-debt');
  assert.equal(ui.writes[0].value.calculation_mode, 'amortized');
  assert.equal(ui.writes[0].value.installments, 48);
  assert.equal(ui.writes[0].value.remaining_cents, 5880000);
  assert.equal(ui.writes[0].value.interest_rate_monthly, 0.0199);
});

test('visible invoice settlement confirms then marks paid without issuing an account payment', () => {
  const ui = screen('src/app/finance/invoice/[id].tsx');
  ui.button('Registrar pagamento');
  ui.press('Marcar como paga');
  assert.equal(ui.writes.length, 0, 'confirmation comes before settlement');
  assert.equal(ui.confirmations.length, 1);
  ui.confirmations[0]();
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.writes[0].operation, 'settleInvoice');
  assert.equal(ui.writes[0].value.invoiceId, 'invoice-1');
});

// A face ancorada carrega o que o card de total carregava (Regra 0 da fase 4): estado,
// contagem, total, fecha e vence — e as linhas que explicam o total ficam DENTRO dela.
test('the docked card carries the invoice summary and the explaining lines', () => {
  const ui = screen('src/app/finance/invoice/[id].tsx', { invoiceStatus: 'paid' });
  const doca = ui.nodes().find((n) => n.type === 'InvoiceDock');
  assert.ok(doca, 'a fatura desenha a doca');
  assert.deepEqual(
    { ...doca.props.resumo },
    { status: 'Paga', atrasada: false, contagem: 1, totalCents: 147000, fecha: '2026-08-10', vence: '2026-08-20' }
  );
  assert.equal(doca.props.atualId, 'invoice-1');
  const texto = JSON.stringify(doca.props.children);
  assert.ok(texto.includes('Paga em'), 'a linha "Paga em" mora sob a face');
});

test('a paid invoice does not expose settlement or payment buttons', () => {
  const ui = screen('src/app/finance/invoice/[id].tsx', { invoiceStatus: 'paid' });
  assert.ok(!ui.nodes().some((n) => n.type === 'Button' && ['Marcar como paga', 'Registrar pagamento'].includes(n.props.label)));
});


// ── tela do ciclo (era a tela Mês, apagada em 13/09/2026) ───────────────────
//
// O roteamento das linhas é testado em `cycle-routes.test.ts`: ele é lógica PURA, e este harness
// não desce em componente aninhado — a linha do ciclo mora dentro de `<Linha>`, não solta na
// árvore da tela.


// ── patrimônio: campo obrigatório é campo que BLOQUEIA ─────────────────────
//
// A queixa de 15/09/2026 foi de classe, não de tela: "tem campos que teoricamente são
// obrigatórios preencher mas me deixa eu salvar normalmente?". `assets.current_value_cents` é
// NOT NULL e o formulário só olhava o nome, então um bem nascia valendo R$ 0,00 — presente no
// banco, mudo na lista, somando zero no patrimônio. O caso que prende a regressão é o Salvar
// com nome válido e valor zerado: sem a guarda ele está habilitado e escreve.
test('an asset with a valid name but no value cannot be saved', () => {
  const ui = screen('src/app/finance/net-worth.tsx');
  ui.press('Novo bem');
  ui.fill('Nome', 'Tesouro Selic');
  const salvar = ui.button('Salvar');
  assert.equal(salvar.props.disabled, true, 'Salvar fica travado enquanto o valor é zero');
  assert.equal(ui.writes.length, 0);

  ui.fill('Valor atual', 150000);
  ui.press('Salvar');
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.writes[0].value.current_value_cents, 150000);
});


/*
  ⚠️ **O skeleton eterno de 16/09/2026.** Com o `cycle_range` falhando, `range.pronto` ficava
  `false` para sempre: o portão da tela não abria, e mesmo com ele aberto o resumo (`!pronto`) e a
  lista (desligada, `isPending` eterno) desenhavam esqueleto. Reproduzido no emulador injetando a
  falha só naquela RPC — a tela parava no carregamento sem erro nem "Tentar de novo".

  O portão agora recebe o range como CONSULTA (preso em `anti-slop.test.ts`); estes testes prendem
  a outra metade: o que a tela DESENHA quando as bordas não vêm.
*/
const transacoesFile = 'src/app/finance/transactions.tsx';
const tipos = (ui: ReturnType<typeof screen>) => ui.nodes().map((n: any) => n.type);

test('Lançamentos com as bordas do período falhando mostra o erro, não um esqueleto eterno', () => {
  const ui = screen(transacoesFile, { rangeError: true });
  const t = tipos(ui);
  assert.ok(t.includes('ErrorCard'), 'a falha do período precisa aparecer');
  for (const esqueleto of ['Skeleton', 'SkeletonRow'])
    assert.ok(!t.includes(esqueleto), `${esqueleto} com o período em erro é o defeito de volta`);
  // Nem um total: sem bordas, qualquer número seria de OUTRA janela.
  assert.ok(!t.includes('PeriodSummaryCard'));
  // O card do resumo E a lista: as duas metades mostram a falha.
  assert.equal(t.filter((x: string) => x === 'ErrorCard').length, 2);
});

test('o "Tentar de novo" do período refaz as BORDAS, não o resumo buscado com o palpite', () => {
  // `refetch` do TanStack ignora `enabled`: refazer o resumo sem bordas definitivas buscaria o
  // mês civil. Refeito o range, a chave muda e o resumo liga sozinho.
  const ui = screen(transacoesFile, { rangeError: true });
  ui.nodes().find((n: any) => n.type === 'ErrorCard').props.onRetry();
  assert.deepEqual(ui.refetches, ['range']);
});

test('Lançamentos com o período resolvido desenha o resumo, sem erro', () => {
  // A outra ponta, e é ela que o dublê antigo (`{from, to}`, sem `pronto`) escondia: com `pronto`
  // indefinido o card caía no esqueleto e nenhum teste percebia.
  const t = tipos(screen(transacoesFile));
  assert.ok(t.includes('PeriodSummaryCard'), 'o card do resumo tem que aparecer');
  assert.ok(!t.includes('ErrorCard'));
});


const semLimiteFalhou = (ui: ReturnType<typeof screen>) =>
  ui.nodes().find((n: any) => n.props?.message === 'Não deu para ver em que você gastou sem limite.');

test('Orçamentos com as bordas falhando avisa em "Sem limite", em vez de sumir com a seção', () => {
  // Sem bordas o resumo não liga, `semLimite` fica vazio e a seção SUMIA calada — a pessoa lia
  // "não há gasto sem limite" quando o que houve foi não conseguir perguntar.
  const ui = screen('src/app/finance/budgets.tsx', { rangeError: true });
  const aviso = semLimiteFalhou(ui);
  assert.ok(aviso, 'a falha do período precisa aparecer');
  aviso.props.onRetry();
  assert.deepEqual(ui.refetches, ['range'], 'refaz as bordas, não o resumo com o palpite');
});

test('Orçamentos com o período resolvido não mostra falha nenhuma', () => {
  assert.equal(semLimiteFalhou(screen('src/app/finance/budgets.tsx')), undefined);
});


const financeiroFile = 'src/app/(tabs)/finance/index.tsx';

test('Financeiro com as bordas falhando mostra o erro no herói, não um esqueleto eterno', () => {
  const ui = screen(financeiroFile, { rangeError: true });
  const t = tipos(ui);
  assert.ok(t.includes('ErrorCard'), 'o herói precisa mostrar a falha do período');
  assert.ok(!t.includes('Skeleton'), 'esqueleto com o período em erro é o defeito de volta');
  // "Ainda não tem movimento" é uma afirmação: sem resposta do resumo ela não pode aparecer.
  assert.ok(!ui.nodes().some((n: any) => n.props?.title === 'Ainda não tem movimento'));
});

test('o "Tentar de novo" do herói refaz as bordas e nunca o resumo sem elas', () => {
  const ui = screen(financeiroFile, { rangeError: true });
  ui.nodes().find((n: any) => n.type === 'ErrorCard').props.onRetry();
  assert.ok(ui.refetches.includes('range'), 'as bordas são o que falhou');
  assert.ok(!ui.refetches.includes('summary'), '`refetch` ignora `enabled`: buscaria o mês civil');
});

test('trocando de mês, com as bordas ainda chegando, o herói espera em vez de desenhar zero', () => {
  // O resumo só liga com as bordas definitivas, então `summary.isLoading` fica `false` enquanto
  // elas buscam. Com o portão da tela já aberto — é o que acontece numa troca de mês —, sem
  // `bordasChegando` o herói pintaria R$ 0,00 nesse intervalo.
  const ui = screen(financeiroFile, { rangePending: true });
  const t = tipos(ui);
  const hero = ui.nodes().find((n: any) => n.type === 'HeroPanel');
  assert.ok(hero, 'o cartão permanece montado durante a troca');
  assert.equal(hero.props.value.type, 'Skeleton', 'o valor ainda não confirmado fica oculto');
  assert.equal(hero.props.onPress, undefined, 'ações do período aguardam os dados');
  assert.ok(!t.includes('ErrorCard'), 'buscando não é falha');
});

test('Financeiro segura a primeira pintura enquanto as bordas do mês ANTERIOR chegam', () => {
  // `previous` só liga com `previousRange.pronto`, e desligado ele não segura o portão. Sem o
  // `previousRange` na lista, a tela abria com o mês atual e o "vs agosto" chegava depois.
  const buscandoAnterior = screen(financeiroFile, { rangePendingMonths: ['2026-08'] });
  assert.equal(telaPronta(...buscandoAnterior.gates.at(-1)!), false, 'o range anterior buscando segura a tela');
  const tudoPronto = screen(financeiroFile);
  assert.equal(telaPronta(...tudoPronto.gates.at(-1)!), true, 'sem este, o de cima não distinguiria nada');
});

test('Financeiro com o período resolvido não mostra falha nem esqueleto no herói', () => {
  const t = tipos(screen(financeiroFile));
  assert.ok(!t.includes('ErrorCard'));
  assert.ok(!t.includes('Skeleton'), 'sem este, o teste de cima não distinguiria nada');
});

const hojeFile = 'src/app/(tabs)/today/index.tsx';
/** Objetos criados dentro do `runInNewContext` têm outro protótipo: o `deepEqual` estrito os recusa. */
const copia = (v: unknown) => JSON.parse(JSON.stringify(v));
const agendaItem = (ui: ReturnType<typeof screen>, title?: string) =>
  ui.nodes().find((n: any) => n.type === 'AgendaItem' && (!title || n.props.title === title));

test('Hoje: o atrasado aparece em Agora e o botão dá baixa no lançamento certo', () => {
  const ui = screen(hojeFile, {
    bills: [{ ref_id: 'luz-1', title: 'Luz', due_date: '2026-09-01', amount_cents: 21000, kind: 'transaction', overdue: true }],
  });
  const item = agendaItem(ui, 'Luz');
  assert.ok(item, 'a conta atrasada precisa estar na tela');
  assert.equal(item.props.meta, 'venceu 01/09');
  item.props.action.onPress();
  assert.deepEqual(ui.writes.map((w) => w.operation), ['markPaid']);
  assert.equal(ui.writes[0].value.id, 'luz-1');
});

test('Hoje: fatura atrasada leva para a fatura, nunca dá baixa de lançamento', () => {
  const ui = screen(hojeFile, {
    bills: [{ ref_id: 'fat-1', title: 'Fatura Nubank', due_date: '2026-09-01', amount_cents: 135000, kind: 'invoice', overdue: true }],
  });
  agendaItem(ui).props.action.onPress();
  assert.equal(ui.writes.length, 0);
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/finance/invoice/[id]', params: { id: 'fat-1' } });
});

test('Hoje: compra que vai cair no cartão aparece nos próximos dias e abre a fatura', () => {
  const ui = screen(hojeFile, {
    charges: [{ id: 'c-1', title: 'DAS', occurred_at: '2026-09-10', amount_cents: 7000, card: 'Nubank', invoice_id: 'f-9' }],
  });
  const item = agendaItem(ui, 'DAS');
  assert.equal(item.props.cartao, 'Nubank');
  item.props.action.onPress();
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/finance/invoice/[id]', params: { id: 'f-9' } });
});

test('Hoje: usuário novo vê os Primeiros passos', () => {
  const ui = screen(hojeFile, {
    setupPassos: [{ id: 'whatsapp', titulo: 'Ligar o WhatsApp', feito: false, href: '/link-phone' }],
  });
  const passos = ui.nodes().find((n: any) => n.type === 'SetupChecklist');
  assert.ok(passos, 'o card de primeiros passos precisa aparecer');
  passos.props.onOpen(passos.props.passos[0]);
  assert.equal(ui.navigations.at(-1), '/link-phone');
});

test('Hoje: com os passos todos feitos o card não aparece', () => {
  const ui = screen(hojeFile, {
    setupPassos: [{ id: 'whatsapp', titulo: 'Ligar o WhatsApp', feito: true, href: '/link-phone' }],
  });
  assert.ok(!tipos(ui).includes('SetupChecklist'));
});

const passoImportar = { id: 'importar', titulo: 'Traga sua fatura', acao: 'Importar fatura', icon: 'square.and.arrow.down', href: '/import?conta=c1' };

test('Hoje: o Próximo passo espera os Primeiros passos acabarem', () => {
  const ui = screen(hojeFile, {
    setupPassos: [{ id: 'whatsapp', titulo: 'Ligar o WhatsApp', feito: false, href: '/link-phone' }],
    proximo: passoImportar,
  });
  assert.ok(!tipos(ui).includes('ProximoPassoCard'), 'um card de descoberta por vez');
});

test('Hoje: com os Primeiros passos feitos aparece o Próximo passo, e ele leva ao lugar', () => {
  const ui = screen(hojeFile, {
    setupPassos: [{ id: 'whatsapp', titulo: 'Ligar o WhatsApp', feito: true, href: '/link-phone' }],
    proximo: passoImportar,
  });
  const card = ui.nodes().find((n: any) => n.type === 'ProximoPassoCard');
  assert.ok(card, 'o card do próximo passo aparece');
  card.props.onAbrir();
  assert.equal(ui.navigations.at(-1), '/import?conta=c1');
  card.props.onDispensar();
  assert.deepEqual(ui.writes.at(-1), { operation: 'dispensarProximo', value: 'importar' });
});

test('Hoje: falha nas contas mostra o erro em Agora, e o "Tentar de novo" refaz as contas', () => {
  const ui = screen(hojeFile, { billsError: true });
  const erro = ui.nodes().find((n: any) => n.type === 'ErrorCard');
  assert.ok(erro, 'seção que falha diz que falhou (§7)');
  erro.props.onRetry();
  assert.ok(ui.refetches.includes('bills'));
  assert.ok(!ui.nodes().some((n: any) => n.type === 'ThemedText' && String(n.props.children).startsWith('Nada vence')),
    'sem resposta das contas a tela não afirma que nada vence');
});

test('Hoje: dia sem nada diz que nada vence, sem inventar lista', () => {
  const ui = screen(hojeFile, {});
  assert.ok(!tipos(ui).includes('AgendaItem'));
  assert.ok(ui.nodes().some((n: any) => n.type === 'ThemedText' && String(n.props.children).startsWith('Nada vence')));
});

test('Hoje: o painel destaca só avisos acionáveis e cada linha mantém seu destino', () => {
  const ui = screen(hojeFile, {
    bills: [{ ref_id: 'luz-1', title: 'Luz', due_date: '2026-09-01', amount_cents: 21000, kind: 'transaction', overdue: true }],
    reminders: [{ id: 'r-1', title: 'Comprar remédio' }],
    budgets: [{ category: 'Mercado', limit_cents: 100_00, spent_cents: 85_00, committed_cents: 0 }],
  });
  const painel = ui.nodes().find((n: any) => n.type === 'TodaySignals');
  assert.ok(painel);
  assert.deepEqual(copia(painel.props.signals.map((s: any) => s.key)), ['bills', 'reminders', 'budgets']);
  assert.equal(painel.props.signals[0].detail, '1 atrasada');
  for (const sinal of painel.props.signals) sinal.onPress();
  assert.deepEqual(copia(ui.navigations), ['/finance/transactions', '/reminders', '/finance/budgets']);

  const semOrcamentoNoLimite = screen(hojeFile, {
    bills: [{ ref_id: 'luz-1', title: 'Luz', due_date: '2026-09-01', amount_cents: 21000, kind: 'transaction', overdue: true }],
    reminders: [{ id: 'r-1', title: 'Comprar remédio' }],
  });
  const doisAvisos = semOrcamentoNoLimite.nodes().find((n: any) => n.type === 'TodaySignals');
  assert.deepEqual(copia(doisAvisos.props.signals.map((s: any) => s.key)), ['bills', 'reminders']);

  const semAvisos = screen(hojeFile);
  assert.ok(!semAvisos.nodes().some((n: any) => n.type === 'TodaySignals'), 'zero não vira card nem deixa vão na cascata');
});

const saldo = (nome: string, tipo: string, cents: number, aReceber = 0) => ({
  account_id: nome, name: nome, type: tipo,
  balance_cents: cents, cleared_cents: cents, pending_in_cents: aReceber, pending_out_cents: 0,
});

test('Hoje: "Nas contas" soma exatamente as linhas que mostra, e cartão fica de fora', () => {
  const ui = screen(hojeFile, {
    balances: [saldo('Nubank', 'checking', 120_00), saldo('Cofre', 'savings', 500_00), saldo('Cartão', 'credit_card', -900_00)],
  });
  const bloco = ui.nodes().find((n: any) => n.type === 'CashAccounts');
  assert.ok(bloco, 'o bloco das contas precisa aparecer');
  assert.equal(bloco.props.caixa.total, 620_00);
  assert.equal(
    bloco.props.caixa.linhas.reduce((t: number, l: any) => t + l.cents, 0),
    bloco.props.caixa.total,
    'o total do topo é a soma das linhas de baixo'
  );
  assert.ok(!bloco.props.caixa.linhas.some((l: any) => l.nome === 'Cartão'), 'cartão tem fatura, não saldo');
});

test('Hoje: tocar numa conta abre o extrato DELA', () => {
  const ui = screen(hojeFile, { balances: [saldo('Nubank', 'checking', 120_00)] });
  const bloco = ui.nodes().find((n: any) => n.type === 'CashAccounts');
  bloco.props.onOpen(bloco.props.caixa.linhas[0]);
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/finance/transactions', params: { accountId: 'Nubank' } });
});

test('Hoje: falha nos saldos diz que falhou e refaz só os saldos', () => {
  const ui = screen(hojeFile, { balancesError: true });
  assert.ok(!tipos(ui).includes('CashAccounts'), 'sem resposta a tela não afirma saldo nenhum');
  const erro = ui.nodes().find((n: any) => n.type === 'ErrorCard');
  assert.ok(erro);
  erro.props.onRetry();
  assert.deepEqual(ui.refetches, ['balances']);
});

test('Hoje: sem conta nenhuma o bloco não desenha um card vazio', () => {
  const ui = screen(hojeFile, {});
  assert.ok(!tipos(ui).includes('CashAccounts'));
});

test('Hoje: o ritmo do dia compara hoje com os dias ANTERIORES do ciclo', () => {
  // ciclo começa 01/09, hoje é 08/09 → 8 dias decorridos, 7 anteriores.
  const ui = screen(hojeFile, {
    saiuHoje: [{ kind: 'expense', total_cents: 200_00 }],
    saiuNoCiclo: [{ kind: 'expense', total_cents: 900_00 }],
  });
  const tile = ui.nodes().find((n: any) => n.type === 'Tile' && n.props.label === 'Saiu hoje');
  assert.ok(tile, 'o ladrilho do dia precisa aparecer');
  // (900 − 200) / 7 = 100 por dia; hoje ficou acima.
  assert.match(String(tile.props.caption), /^acima de R\$ [0-9.,]+\/dia$/);
  assert.match(String(tile.props.caption), /100/, "a média por dia aparece na legenda");
});

test('Hoje: receita não entra no que "saiu"', () => {
  const ui = screen(hojeFile, {
    saiuHoje: [{ kind: 'income', total_cents: 4_000_00 }, { kind: 'expense', total_cents: 30_00 }],
    saiuNoCiclo: [{ kind: 'expense', total_cents: 100_00 }],
  });
  const tile = ui.nodes().find((n: any) => n.type === 'Tile' && n.props.label === 'Saiu hoje');
  assert.equal(tile.props.value.props.cents, 30_00);
});

test('Financeiro: os atalhos do mosaico levam aos mesmos destinos de antes', () => {
  const ui = screen(financeiroFile);
  const tiles = ui.nodes().filter((n: any) => n.type === 'Tile' && n.props.onPress);
  for (const t of tiles) t.props.onPress();
  const destinos = JSON.stringify(ui.navigations);
  for (const d of ['/finance/transactions', '/finance/accounts', '/finance/budgets', '/finance/forecast', '/finance/manage']) {
    assert.ok(destinos.includes(d), `o mosaico perdeu ${d}`);
  }
});

test('Financeiro: Entra e Sai abrem o ciclo filtrado pelo lado', () => {
  const ui = screen(financeiroFile);
  const entra = ui.nodes().find((n: any) => n.type === 'Tile' && n.props.label === 'Entra');
  const sai = ui.nodes().find((n: any) => n.type === 'Tile' && n.props.label === 'Sai');
  entra.props.onPress();
  sai.props.onPress();
  assert.equal(ui.navigations.at(-2).params.tipo, 'entra');
  assert.equal(ui.navigations.at(-1).params.tipo, 'sai');
  assert.equal(ui.navigations.at(-1).pathname, '/finance/cycle');
});

test('Financeiro: o FAB continua oferecendo as três formas de lançar', () => {
  const ui = screen(financeiroFile);
  const tela = ui.nodes().find((n: any) => n.type === 'Screen');
  tela.props.overlay.props.onPress();
  assert.deepEqual(
    ui.actions.map((a) => a.label),
    ['Gasto ou receita', 'Recorrente', 'Financiamento']
  );
});

test('Hoje tablet reuses its real blocks and retains their destinations', () => {
  const ui = screen(hojeFile, { tablet: true, balances: [saldo('Conta', 'checking', 120_00)] });
  const tela = ui.nodes().find((n: any) => n.type === 'Screen');
  assert.equal(tela.props.wide, true);
  const canvas = ui.nodes().find((n: any) => n.type === 'TodayTabletCanvas');
  assert.ok(canvas);
  assert.ok(tipos(ui).includes('CashAccounts'));
  assert.ok(ui.nodes().some((n: any) => n.type === 'Tile' && n.props.label === 'Saiu hoje'));
});

test('Financeiro tablet keeps the cycle, analysis and all management actions', () => {
  const ui = screen(financeiroFile, { tablet: true });
  const tela = ui.nodes().find((n: any) => n.type === 'Screen');
  assert.equal(tela.props.wide, true);
  const canvas = ui.nodes().find((n: any) => n.type === 'FinanceTabletCanvas');
  assert.ok(canvas);
  assert.ok(ui.nodes().some((n: any) => n.type === 'Tile' && n.props.label === 'Entra'));
  assert.ok(ui.nodes().some((n: any) => n.type === 'Tile' && n.props.label === 'Sai'));
  tela.props.overlay.props.onPress();
  assert.deepEqual(ui.actions.map((a) => a.label),
    ['Gasto ou receita', 'Recorrente', 'Financiamento']);
});

test('Cartões: "Importar fatura" se alcança com o DEDO (toque longo), não só pelo leitor de tela', () => {
  const ui = screen('src/app/finance/cards.tsx', { cards: [{ account_id: 'card-1', name: 'Nubank Cartão', invoice_id: 'invoice-1', invoice_total_cents: 10000, unpaid_total_cents: 10000, closing_date: '2026-10-03', due_date: '2026-10-10', overdue_count: 0 }] });
  const card = ui.nodes().find((n: any) => typeof n.type === 'function' && n.type.name === 'PressCard');
  assert.ok(card, 'o card do cartão');
  // O PressCard devolve o Deslizavel (arrasto) em volta do tocável.
  const raiz = card.type(card.props);
  const tocavel = raiz.type === 'Deslizavel' ? raiz.props.children : raiz;
  assert.equal(typeof tocavel.props.onLongPress, 'function', 'o card abre as ações no toque longo');
  tocavel.props.onLongPress();
  const importar = ui.actions.find((a: any) => a.label === 'Importar fatura');
  assert.ok(importar, 'Importar fatura entre as ações');
  importar.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { pathname: '/import', params: { conta: 'card-1' } });
});

const importFile = 'src/app/import.tsx';
const contasDoImport = [{ id: 'card-1', name: 'Nubank Cartão', type: 'credit_card' }, { id: 'conta-1', name: 'Nubank', type: 'checking' }];
const temTexto = (ui: any, texto: string) => ui.nodes().some((n: any) => n.type === 'ThemedText' && n.props.children === texto);

test('Importar: no Free o aviso do Pro É a etapa — sem conta, sem arquivo, "Ver planos" leva ao paywall', () => {
  const ui = screen(importFile, { params: {}, plan: 'free', forecastAccounts: contasDoImport });
  assert.ok(temTexto(ui, 'Importar é do plano Pro'));
  assert.equal(ui.nodes().some((n: any) => n.type === 'Button' && n.props.label === 'Escolher arquivo'), false, 'nada de botão que nunca liga');
  assert.equal(ui.nodes().some((n: any) => n.type === 'AccountPicker'), false, 'nada de escolher conta que não leva a lugar nenhum');
  ui.press('Ver planos');
  assert.equal(ui.navigations.at(-1), '/paywall');
});

test('Importar: enquanto o plano carrega, esqueleto — o botão não nasce ligado para o aviso entrar depois', () => {
  const ui = screen(importFile, { params: {}, planPending: true, forecastAccounts: contasDoImport });
  assert.equal(ui.nodes().some((n: any) => n.type === 'Button' && n.props.label === 'Escolher arquivo'), false);
  assert.ok(ui.nodes().some((n: any) => n.type === 'SkeletonRow'));
});

test('Importar: ?conta= de uma conta da pessoa já nasce escolhida e o arquivo está liberado', () => {
  const ui = screen(importFile, { params: { conta: 'card-1' }, forecastAccounts: contasDoImport });
  assert.equal(ui.nodes().find((n: any) => n.type === 'AccountPicker').props.value, 'card-1');
  assert.equal(ui.button('Escolher arquivo').props.disabled, false);
});

test('Importar: ?conta= que não é da pessoa é ignorado — nada pré-escolhido, o arquivo espera a conta', () => {
  const ui = screen(importFile, { params: { conta: 'de-outra-pessoa' }, forecastAccounts: contasDoImport });
  assert.equal(ui.nodes().find((n: any) => n.type === 'AccountPicker').props.value, null);
  assert.equal(ui.button('Escolher arquivo').props.disabled, true);
});

/*
  Arrastar o card para os lados (spec 2026-09-23-arrastar-card): o card declara as ações UMA vez
  e o `Deslizavel` divide. Os testes leem o que cada card entrega a ele.
*/
const ladosDe = (node: any) => {
  const l = ladosDoArrasto(node.props.acoes);
  // Ícone em TODA ação revelada: sem ele, o rótulo fica numa altura e o do "Mais" (que tem ícone)
  // noutra — medido no Android em 23/09/2026 ("Arquivar" desalinhado de "Mais").
  const semIcone = [...l.direita, ...l.esquerda].filter((a: any) => !a.icon).map((a: any) => a.label);
  assert.deepEqual(JSON.parse(JSON.stringify(semIcone)), [], `ação do arrasto sem ícone: ${semIcone.join(', ')}`);
  // O botão revelado tem 88dp: rótulo de uma palavra, como no WhatsApp ("Apagar a compra inteira"
  // partia em três linhas). A frase inteira continua no menu; no arrasto vale `curto`.
  const longos = [...l.direita, ...l.esquerda].map((a: any) => a.curto ?? a.label).filter((t: string) => t.length > 10);
  assert.deepEqual(JSON.parse(JSON.stringify(longos)), [], `rótulo longo no arrasto: ${longos.join(', ')}`);
  // JSON: o harness roda a tela noutro contexto (vm), e arrays de lá não são `deepStrictEqual` daqui.
  return JSON.parse(JSON.stringify({ direita: l.direita.map((a: any) => a.label), esquerda: l.esquerda.map((a: any) => a.label), mais: l.mais, pontaDireita: l.pontaDireita?.label ?? null, pontaEsquerda: l.pontaEsquerda?.label ?? null }));
};
const deslizaveis = (ui: any) => ui.nodes().filter((n: any) => n.type === 'Deslizavel');

test('Lembretes: arrastar à direita pausa (até o fim, com Desfazer), à esquerda apaga', () => {
  const ui = screen('src/app/reminders.tsx', { reminders: [{ id: 'r1', title: 'Aluguel', active: true, next_run_at: '2026-10-05T12:00:00Z', recurrence: null }] });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'o lembrete está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Pausar'], esquerda: ['Apagar'], mais: false, pontaDireita: 'Pausar', pontaEsquerda: 'Apagar' });
  // o toque longo continua com todas as ações
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Row' && n.props.onLongPress).props.onLongPress());
  assert.deepEqual(JSON.parse(JSON.stringify(ui.actions.map((a: any) => a.label))), ['Editar', 'Pausar', 'Apagar']);
  // Apagar ficou a um arrasto: ele confirma antes, como em toda outra tela.
  const apagar = card.props.acoes.find((x: any) => x.label === 'Apagar');
  ui.interact(() => apagar.onPress());
  assert.deepEqual(ui.writes, [], 'nada apagado antes da confirmação');
  assert.equal(ui.confirmations.length, 1);
});

const itemLinks = (ui: any) => ui.nodes().filter((n: any) => n.type === 'ItemLink');
const ladosDoLink = (node: any) => ladosDe({ props: { acoes: node.props.actions } });

test('Lançamentos: pendente arrasta Paguei à direita; efetivado arrasta Editar; Apagar à esquerda', () => {
  const pendente = itemLinks(screen(transacoesFile, { txStatus: 'pending' }))[0];
  assert.deepEqual(ladosDoLink(pendente), { direita: ['Paguei'], esquerda: ['Apagar'], mais: true, pontaDireita: 'Paguei', pontaEsquerda: 'Apagar' });
  const efetivado = itemLinks(screen(transacoesFile))[0];
  assert.deepEqual(ladosDoLink(efetivado), { direita: ['Editar'], esquerda: ['Apagar'], mais: false, pontaDireita: 'Editar', pontaEsquerda: 'Apagar' });
});

test('Financeiro: o último lançamento arrasta Editar e Apagar (Ver detalhe é o toque)', () => {
  const ui = screen(financeiroFile, { recent: [{ id: 't1', kind: 'expense', amount_cents: 4500, occurred_at: '2026-09-15', description: 'Mercado', status: 'cleared' }] });
  assert.deepEqual(ladosDoLink(itemLinks(ui)[0]), { direita: ['Editar'], esquerda: ['Apagar'], mais: false, pontaDireita: 'Editar', pontaEsquerda: 'Apagar' });
});

test('Fatura: a compra arrasta Editar e Apagar', () => {
  const ui = screen('src/app/finance/invoice/[id].tsx');
  assert.deepEqual(ladosDoLink(itemLinks(ui)[0]), { direita: ['Editar'], esquerda: ['Apagar'], mais: false, pontaDireita: 'Editar', pontaEsquerda: 'Apagar' });
});

test('Contas: a conta arrasta Editar e Arquivar (Ver extrato é o toque)', () => {
  const ui = screen('src/app/finance/accounts.tsx', {
    balances: [{ account_id: 'a1', name: 'Nubank', type: 'checking', balance_cents: 10000, cleared_cents: 10000, pending_in_cents: 0, pending_out_cents: 0 }],
    forecastAccounts: [{ id: 'a1', name: 'Nubank', type: 'checking', archived: false }],
  });
  const [link] = itemLinks(ui);
  assert.ok(link, 'a conta está num ItemLink');
  assert.deepEqual(ladosDoLink(link), { direita: ['Editar'], esquerda: ['Arquivar'], mais: false, pontaDireita: 'Editar', pontaEsquerda: 'Arquivar' });
});

test('Projeção: a conta prevista arrasta Paguei à direita e Editar à esquerda', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], bills: [{ ref_id: 'b1', title: 'Aluguel', kind: 'expense', amount_cents: 180000, due_date: '2026-10-05', overdue: false }] });
  const card = deslizaveis(ui).find((n: any) => n.props.titulo === 'Aluguel');
  assert.ok(card, 'a conta prevista está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Paguei'], esquerda: ['Editar'], mais: false, pontaDireita: 'Paguei', pontaEsquerda: 'Editar' });
});

test('Regras: a regra arrasta Editar e Apagar', () => {
  const ui = screen('src/app/finance/rules.tsx', { rules: [{ id: 'r1', pattern: 'ifood', category: 'restaurante', match_type: 'contains', account_id: null, hits: 3, source: 'user' }] });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'a regra está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Editar'], esquerda: ['Apagar'], mais: false, pontaDireita: 'Editar', pontaEsquerda: 'Apagar' });
});

test('Dívidas: arrasta Pagar parcela à direita; Arquivar à esquerda vai até o fim (tem Desfazer)', () => {
  const ui = screen(debtsFile, { create: false, debts: [carro] });
  assert.deepEqual(ladosDe(deslizaveis(ui)[0]), { direita: ['Pagar parcela'], esquerda: ['Arquivar'], mais: true, pontaDireita: 'Pagar parcela', pontaEsquerda: 'Arquivar' });
});

test('Cartões: fatura aberta arrasta Importar fatura; a carteira fica à esquerda', () => {
  const ui = screen('src/app/finance/cards.tsx', { cards: [{ account_id: 'card-1', name: 'Nubank Cartão', invoice_id: 'invoice-1', invoice_total_cents: 10000, unpaid_total_cents: 10000, closing_date: '2026-10-03', due_date: '2026-10-10', overdue_count: 0 }] });
  const card = ui.nodes().find((n: any) => typeof n.type === 'function' && n.type.name === 'PressCard');
  const raiz = card.type(card.props);
  assert.equal(raiz.type, 'Deslizavel', 'o cartão está num Deslizavel');
  assert.deepEqual(ladosDe(raiz), { direita: ['Importar fatura'], esquerda: ['Abrir na carteira'], mais: false, pontaDireita: 'Importar fatura', pontaEsquerda: 'Abrir na carteira' });
});

test('Cartões: "Paguei" abre a fatura já no pagamento, não só a fatura', () => {
  const ui = screen('src/app/finance/cards.tsx', { cards: [{ account_id: 'card-1', name: 'Nubank Cartão', invoice_id: 'invoice-1', invoice_total_cents: 10000, invoice_open_cents: 10000, unpaid_total_cents: 10000, closing_date: '2026-09-03', due_date: '2026-09-10', overdue_count: 1 }] });
  const card = ui.nodes().find((n: any) => typeof n.type === 'function' && n.type.name === 'PressCard');
  const raiz = card.type(card.props);
  const paguei = raiz.props.acoes.find((x: any) => x.label === 'Paguei');
  assert.ok(paguei, 'fatura fechada tem Paguei');
  ui.interact(() => paguei.onPress());
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { pathname: '/finance/invoice/[id]', params: { id: 'invoice-1', acao: 'pagar' } });
});

test('Recorrentes: arrasta Pausar (até o fim, com Desfazer) e Apagar; o resto no Mais', () => {
  const ui = screen('src/app/finance/recurring.tsx', { recurring: [{ id: 'rec-1', description: 'Academia', kind: 'expense', amount_cents: 12000, rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', dtstart: '2026-01-15', next_run_at: '2026-10-15T12:00:00Z', active: true, account_id: null, category: 'saúde' }] });
  const card = deslizaveis(ui)[0];
  assert.ok(card, 'a série está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Pausar'], esquerda: ['Apagar'], mais: true, pontaDireita: 'Pausar', pontaEsquerda: 'Apagar' });
  // O Desfazer é a rede do "até o fim": se ele falhar, a pessoa precisa saber (design.md §6).
  ui.interact(() => card.props.acoes.find((x: any) => x.label === 'Pausar').onPress());
  ui.interact(() => ui.pedidos.at(-1).opts.onSuccess());
  const desfazer = ui.toasts.at(-1).action;
  assert.equal(desfazer?.label, 'Desfazer');
  ui.interact(() => desfazer.onPress());
  const volta = ui.pedidos.at(-1);
  assert.equal(typeof volta.opts?.onError, 'function', 'o Desfazer avisa quando falha');
  ui.interact(() => volta.opts.onError());
  assert.equal(ui.toasts.at(-1).tone, 'error');
});

test('Metas: arrasta Guardar à direita e Arquivar à esquerda', () => {
  const ui = screen('src/app/finance/goals.tsx', { goals: [{ id: 'g1', name: 'Viagem', target_cents: 500000, saved_cents: 100000, deadline: null, archived: false }] });
  const card = deslizaveis(ui)[0];
  assert.ok(card, 'a meta está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Guardar'], esquerda: ['Arquivar'], mais: true, pontaDireita: 'Guardar', pontaEsquerda: 'Arquivar' });
});

test('Nota: arrasta Fixar à direita e Arquivar à esquerda (os dois até o fim); o resto no Mais', () => {
  const vazio = () => {};
  const ui = screen('src/components/notes/note-card.tsx', {
    componente: 'NoteCard',
    props: {
      note: { id: 'n1', content: 'Ideias para o app', pinned: false, source: 'app', updated_at: '2026-09-01T12:00:00Z', created_at: '2026-09-01T12:00:00Z', color: null, folder_id: null, tags: [] },
      actions: { onPin: vazio, onColor: vazio, onMove: vazio, onArchive: vazio, onTrash: vazio },
    },
  });
  const [link] = itemLinks(ui);
  assert.ok(link, 'a nota está num ItemLink');
  assert.deepEqual(ladosDoLink(link), { direita: ['Fixar'], esquerda: ['Arquivar'], mais: true, pontaDireita: 'Fixar', pontaEsquerda: 'Arquivar' });
});

test('Nota colorida: o cartão INTEIRO é da cor, e sem cor própria herda a da pasta', () => {
  // 25/09/2026: *"o card inteiro tem que ficar daquela cor e não somente um detalhe quase
  // imperceptível"*. Era um trilho de 3px.
  const vazio = () => {};
  const cartao = (color: string | null, folderColor: string | null = null, pressed = false) => {
    const ui = screen('src/components/notes/note-card.tsx', {
      componente: 'NoteCard',
      props: {
        note: { id: 'n1', content: 'Mercado', pinned: false, source: 'app', updated_at: '2026-09-01T12:00:00Z', created_at: '2026-09-01T12:00:00Z', color, folder_id: null, tags: [] },
        folderColor,
        actions: { onPin: vazio, onColor: vazio, onMove: vazio, onArchive: vazio, onTrash: vazio },
      },
    });
    const [link] = itemLinks(ui);
    const view = link.props.children({ onLongPress: vazio }).props.children({ pressed });
    const estilo = Object.assign({}, ...view.props.style.flat().filter(Boolean));
    const tingida = [view.props.children].flat().find((n: any) => n?.type === 'PaletaTingida');
    return { fundo: estilo.backgroundColor, borda: estilo.borderColor, tingida: tingida?.props.cores ?? null };
  };
  assert.deepEqual(cartao('oceano'), { fundo: 'fundo-oceano', borda: 'borda-oceano', tingida: { surface: 'fundo-oceano', backgroundSelected: 'forte-oceano', cardBorder: 'borda-oceano', accentSoft: 'forte-oceano' } });
  assert.equal(cartao('oceano', null, true).fundo, 'forte-oceano', 'tocado: o tom forte da mesma cor, não o cinza');
  assert.equal(cartao(null, 'musgo').fundo, 'fundo-musgo', 'sem cor própria, a da pasta');
  assert.equal(cartao(null).tingida, null, 'sem cor nenhuma, o tema comum');
});

test('Pasta: arrasta Fixar à direita e Arquivar à esquerda (os dois até o fim); o resto no Mais', () => {
  const ui = screen('src/app/notes/folders.tsx', { folders: [{ id: 'f1', name: 'trabalho', icon: 'folder', color: null, pinned: false, parent_id: null, notes_count: 2, tags: [] }] });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'a pasta está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Fixar'], esquerda: ['Arquivar'], mais: true, pontaDireita: 'Fixar', pontaEsquerda: 'Arquivar' });
});

test('Lixeira: arrasta só Apagar de vez à esquerda (Ver conteúdo é o toque)', () => {
  const ui = screen('src/app/notes/trash.tsx', { notes: [{ id: 'n1', content: 'Teste', deleted_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z', pinned: false }] });
  const [card] = deslizaveis(ui).length ? deslizaveis(ui) : itemLinks(ui).map((l: any) => ({ props: { acoes: l.props.actions } }));
  assert.ok(card, 'a nota da lixeira arrasta');
  assert.deepEqual(ladosDe(card), { direita: [], esquerda: ['Apagar de vez'], mais: false, pontaDireita: null, pontaEsquerda: 'Apagar de vez' });
});

test('Conversa: arrasta Renomear à direita e Apagar à esquerda', () => {
  const ui = screen('src/app/agent/history.tsx', { conversations: [{ id: 'c1', title: 'gastei 45 no mercado', last_message: 'Ok', updated_at: '2026-09-21T12:00:00Z' }] });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'a conversa está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Renomear'], esquerda: ['Apagar'], mais: false, pontaDireita: 'Renomear', pontaEsquerda: 'Apagar' });
  assert.equal(card.props.fundo, 'groupedBackground', 'lista chapada: a linha tem o fundo da tela');
});

test('Importação: arrasta só Apagar registro à esquerda (retomar é o toque)', () => {
  const ui = screen('src/app/import-history.tsx', { batches: [{ id: 'b1', filename: 'nubank.ofx', source: 'ofx', created_at: '2026-09-20T12:00:00Z', account_id: null, pendentes: 0, aprovados: 3, total: 3, status: 'done' }] });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'o lote está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: [], esquerda: ['Apagar registro'], mais: false, pontaDireita: null, pontaEsquerda: 'Apagar registro' });
});

test('Orçamento: arrasta Editar limite à direita; o resto no Mais', () => {
  const ui = screen('src/app/finance/budgets.tsx', { budgets: [{ category: 'mercado', limit_cents: 100_00, base_limit_cents: 100_00, rollover_cents: 0, spent_cents: 40_00, committed_cents: 0, month: null }] });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'o orçamento está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Editar limite'], esquerda: [], mais: true, pontaDireita: 'Editar limite', pontaEsquerda: null });
});

test('Aporte: no extrato da meta arrasta Desfazer à esquerda, e ele confirma antes de mover dinheiro', () => {
  const ui = screen('src/app/finance/goals.tsx', {
    goals: [{ id: 'g1', name: 'Viagem', target_cents: 500000, saved_cents: 100000, deadline: null, archived: false }],
    contributions: [{ id: 'c1', goal_id: 'g1', amount_cents: 100000, occurred_at: '2026-09-01', note: null }],
  });
  const meta = deslizaveis(ui)[0];
  ui.interact(() => meta.props.acoes.find((x: any) => x.label === 'Ver extrato').onPress());
  const aporte = deslizaveis(ui).find((d: any) => d.props.acoes.some((x: any) => x.label === 'Desfazer'));
  assert.ok(aporte, 'o aporte do extrato está num Deslizavel');
  assert.deepEqual(ladosDe(aporte), { direita: [], esquerda: ['Desfazer'], mais: false, pontaDireita: null, pontaEsquerda: 'Desfazer' });
  ui.interact(() => aporte.props.acoes[0].onPress());
  assert.deepEqual(ui.writes, [], 'nada move antes da confirmação');
  assert.equal(ui.confirmations.length, 1);
});

test('Parcelada: arrasta Editar a compra à direita e Apagar a compra inteira à esquerda; o resto no Mais', () => {
  const parcelas = [1, 2, 3].map((n) => ({ id: `t${n}`, installment_no: n, amount_cents: 30000, occurred_at: `2026-0${6 + n}-10`, status: n === 1 ? 'cleared' : 'pending', invoice_id: null }));
  const ui = screen('src/app/finance/installments.tsx', {
    plans: [{ id: 'p1', title: 'tv', description: 'tv', merchant: null, category: 'casa', account_id: null, total_cents: 90000, installments: 3, installment_cents: 30000, first_occurred_at: '2026-07-10', active: true, paid: 1, remaining_cents: 60000, locked: 1, locked_cents: 30000, locked_paid: 1, parcels: parcelas }],
  });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'a compra está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Editar a compra'], esquerda: ['Apagar a compra inteira'], mais: true, pontaDireita: 'Editar a compra', pontaEsquerda: 'Apagar a compra inteira' });
});

/**
 * Na linha de extrato o valor sobe para a linha do título e, sem espaço, desce para baixo dele.
 * Ele NÃO encolhe a fonte: no iOS o `adjustsFontSizeToFit` que encolhe numa passada de layout
 * estreita (a troca de tema re-layouta a lista) não cresce de volta — "pc gamer (6/8)" ficou com
 * o valor minúsculo até sair da tela (medido no simulador em 23/09/2026).
 */
test('Lançamentos: o valor da linha não encolhe a fonte', () => {
  const [link] = itemLinks(screen(transacoesFile));
  const linha = link.props.children({ onLongPress() {} });
  assert.equal(linha.props.inlineValue, true, 'a linha do extrato usa o valor na linha do título');
  // Não encolher é o padrão do `Money` desde 24/09/2026; a linha só não pode LIGAR o encolher.
  assert.notEqual(linha.props.trailing.props.encolhe, true);
});

/**
 * Quem já está no Pro via o card do Pro marcado e, embaixo, "Começar 7 dias grátis" — oferta de
 * teste para o plano que a pessoa já tem (visto no iPhone em 24/09/2026). O botão diz o que é.
 */
test('Paywall: no plano que a pessoa já tem, o botão não oferece dias grátis', () => {
  const noPro = screen('src/app/paywall.tsx', { plan: 'pro' });
  const botaoPro = noPro.nodes().find((n: any) => n.type === 'Button');
  assert.ok(botaoPro, 'o botão existe');
  assert.equal(botaoPro.props.label, 'Seu plano atual');
  const noFree = screen('src/app/paywall.tsx', { plan: 'free' });
  assert.match(String(noFree.nodes().find((n: any) => n.type === 'Button').props.label), /dias grátis/);
});

test('Ciclo: dentro de cada grupo, do mais recente para o mais antigo, e 20 por vez com "Ver mais"', () => {
  const linhas = Array.from({ length: 25 }, (_, i) => ({
    day: `2026-09-${String(11 + i).padStart(2, '0')}`.replace(/-(3[2-9]|4\d)$/, (m) => `-${m.slice(1)}`),
    in_cents: 0, out_cents: 1000 + i, title: `gasto ${i + 1}`, origin: 'transaction', ref_id: `t${i}`,
    method_label: null, atrasada: false,
  })).map((l, i) => ({ ...l, day: i < 20 ? `2026-09-${String(11 + i)}` : `2026-10-0${i - 19}` }));
  const ui = screen('src/app/finance/cycle.tsx', { cycleLines: linhas });
  const dias = () => ui.nodes().filter((n: any) => typeof n.type === 'function' && n.type.name === 'Linha').map((n: any) => n.props.linha.day);
  assert.equal(dias().length, 20, 'só o primeiro passo');
  assert.equal(dias()[0], '2026-10-05', 'o mais recente primeiro');
  assert.deepEqual([...dias()].sort().reverse(), dias(), 'em ordem decrescente');
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais');
  assert.equal(mais.props.restantes, 5);
  ui.interact(() => mais.props.onPress());
  assert.equal(dias().length, 25);
  assert.equal(dias().at(-1), '2026-09-11', 'o mais antigo por último');
});

test('Importar: a prévia desenha cada grupo aos poucos, e "Marcar todos" continua valendo para o grupo inteiro', () => {
  const itens = Array.from({ length: 45 }, (_, i) => ({
    id: `i${i}`, status: 'pending', kind: 'expense', nature: 'compra', amount_cents: 1000 + i,
    occurred_at: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, description: `compra ${i}`, suggested_category: 'mercado',
  }));
  const ui = screen(importFile, { params: { batch: 'b1' }, forecastAccounts: contasDoImport, importItems: itens });
  const linhas = () => ui.nodes().filter((n: any) => n.type === 'ImportRow');
  assert.equal(linhas().length, 20);
  const cabecalho = ui.nodes().find((n: any) => n.type === 'SectionHead' && /^Novos/.test(n.props.title));
  assert.match(cabecalho.props.title, /45$/, 'o título conta o grupo inteiro');
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais');
  assert.equal(mais.props.restantes, 25);
  ui.interact(() => mais.props.onPress());
  assert.equal(linhas().length, 40);
});

test('Importar: "Está no app e não veio no arquivo" vem do mais recente para o mais antigo, aos poucos', () => {
  const sobrando = Array.from({ length: 25 }, (_, i) => ({
    id: `t${i}`, description: `lanç ${i}`, category: null, amount_cents: 100,
    occurred_at: `2026-09-${String(i + 1).padStart(2, '0')}`,
  }));
  const ui = screen(importFile, {
    params: { batch: 'b1' }, forecastAccounts: contasDoImport,
    importBatch: { status: 'done', account_id: 'conta-1', accounts: { type: 'checking' } }, unmatched: sobrando,
  });
  const linhas = ui.nodes().filter((n: any) => n.type === 'Row' && /^lanç /.test(n.props.title));
  assert.equal(linhas.length, 20);
  assert.equal(linhas[0].props.title, 'lanç 24', 'o mais recente primeiro');
  assert.ok(ui.nodes().some((n: any) => n.type === 'VerMais' && n.props.restantes === 5));
});

test('Projeção: "Atrasado" e os meses aparecem aos poucos, com "Ver mais"', () => {
  const atrasadas = Array.from({ length: 25 }, (_, i) => ({
    kind: 'bill', ref_id: `b${i}`, title: `conta ${i}`, amount_cents: 1000, due_date: `2026-08-${String(i + 1).padStart(2, '0')}`, overdue: true,
  }));
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], bills: atrasadas });
  assert.equal(ui.nodes().filter((n: any) => n.type === 'Deslizavel').length, 20);
  assert.ok(ui.nodes().some((n: any) => n.type === 'VerMais' && n.props.restantes === 5));

  const meses = Array.from({ length: 30 }, (_, i) => ({
    mes: `${2026 + Math.floor((8 + i) / 12)}-${String(((8 + i) % 12) + 1).padStart(2, '0')}-01`,
    entra: 0, sai: 0, saldo: 1000, parcial: false, primeiroNegativo: null, de: '2026-09-01', ate: '2026-09-30',
  }));
  const ui2 = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], forecastMonths: meses });
  ui2.interact((nodes: any[]) => nodes.find((n) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'mes')).props.onChange('mes'));
  const mais = ui2.nodes().find((n: any) => n.type === 'VerMais' && n.props.restantes === 10);
  assert.ok(mais, 'os 30 meses em passos de 20');
});

test('Recorrentes: cada seção aparece aos poucos, com "Ver mais"', () => {
  const series = Array.from({ length: 25 }, (_, i) => ({
    id: `rec-${i}`, description: `série ${i}`, kind: 'expense', amount_cents: 1000, rrule: 'FREQ=MONTHLY;BYMONTHDAY=15',
    dtstart: '2026-01-15', next_run_at: '2026-10-15T12:00:00Z', active: true, account_id: null, category: 'casa',
  }));
  const ui = screen('src/app/finance/recurring.tsx', { recurring: series });
  assert.equal(ui.nodes().filter((n: any) => n.type === 'Deslizavel').length, 20);
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais' && n.props.restantes === 5);
  assert.ok(mais);
  ui.interact(() => mais.props.onPress());
  assert.equal(ui.nodes().filter((n: any) => n.type === 'Deslizavel').length, 25);
});

test('Metas: o extrato vem aos poucos, e o total do mês continua sendo o do mês inteiro', () => {
  // 25 aportes em setembro, do mais recente para o mais antigo (a consulta já ordena assim).
  const aportes = Array.from({ length: 25 }, (_, i) => ({
    id: `c${i}`, goal_id: 'g1', amount_cents: 1000, occurred_at: `2026-09-${String(25 - i).padStart(2, '0')}`, note: null,
  }));
  const ui = screen('src/app/finance/goals.tsx', {
    goals: [{ id: 'g1', name: 'Viagem', target_cents: 500000, saved_cents: 25000, deadline: null, archived: false }],
    contributions: aportes,
  });
  ui.interact(() => deslizaveis(ui)[0].props.acoes.find((x: any) => x.label === 'Ver extrato').onPress());
  const doExtrato = () => deslizaveis(ui).filter((d: any) => d.props.acoes.some((x: any) => x.label === 'Desfazer'));
  assert.equal(doExtrato().length, 20);
  const secao = ui.nodes().find((n: any) => n.type === 'Section' && /setembro/.test(n.props.title ?? ''));
  assert.match(secao.props.title, /R\$ 250\.00$/, 'o total do mês conta os 25');
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais' && n.props.restantes === 5);
  ui.interact(() => mais.props.onPress());
  assert.equal(doExtrato().length, 25);
});

test('Parcelada aberta: "A seguir" a partir da próxima, e "Pagas" da mais recente para a mais antiga', () => {
  const parcelas = [1, 2, 3, 4].map((n) => ({ id: `t${n}`, installment_no: n, amount_cents: 30000, occurred_at: `2026-0${6 + n}-10`, status: n <= 2 ? 'cleared' : 'pending', invoice_id: null }));
  const ui = screen('src/app/finance/installments.tsx', {
    plans: [{ id: 'p1', title: 'tv', description: 'tv', merchant: null, category: 'casa', account_id: null, total_cents: 120000, installments: 4, installment_cents: 30000, first_occurred_at: '2026-07-10', active: true, paid: 2, remaining_cents: 60000, locked: 2, locked_cents: 60000, locked_paid: 2, parcels: parcelas }],
  });
  ui.interact((nodes: any[]) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.accessibilityState?.expanded === false).props.onPress());
  const ordem = ui.nodes()
    .filter((n: any) => n.type === 'Pressable' && /^Parcela \d/.test(n.props.accessibilityLabel ?? ''))
    .map((n: any) => Number(n.props.accessibilityLabel.match(/^Parcela (\d+)/)[1]));
  assert.deepEqual(JSON.parse(JSON.stringify(ordem)), [3, 4, 2, 1]);
});

test('Regras: a lista vem aos poucos, com "Ver mais"', () => {
  const regras = Array.from({ length: 23 }, (_, i) => ({ id: `r${i}`, pattern: `loja ${i}`, category: 'casa', priority: i, hits: 0, active: true }));
  const ui = screen('src/app/finance/rules.tsx', { rules: regras });
  assert.equal(ui.nodes().filter((n: any) => n.type === 'Deslizavel').length, 20);
  assert.ok(ui.nodes().some((n: any) => n.type === 'VerMais' && n.props.restantes === 3));
});

test('Categoria: a folha de "Todas…" mostra aos poucos, e a busca recomeça', () => {
  const usadas = Array.from({ length: 30 }, (_, i) => ({ category: `categoria ${String(i).padStart(2, '0')}`, uses: 30 - i }));
  const ui = screen('src/components/finance/category-picker.tsx', { componente: 'CategoryPicker', props: { value: null, onChange: () => {} }, categoriasUsadas: usadas });
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Chip' && n.props.label === 'Todas…').props.onPress());
  const opcoes = () => ui.nodes().filter((n: any) => n.type === 'Row' && n.props.icon === 'tag');
  assert.equal(opcoes().length, 20);
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais');
  assert.ok(mais.props.restantes > 0);
});

test('Lembretes: vêm do servidor em páginas; "Ver mais" busca a próxima', () => {
  const ui = screen('src/app/reminders.tsx', {
    reminders: [{ id: 'r1', title: 'Aluguel', active: true, next_run_at: '2026-10-05T12:00:00Z', recurrence: null }],
    maisPaginas: true,
  });
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais');
  assert.ok(mais, 'tem mais no servidor: o botão aparece');
  ui.interact(() => mais.props.onPress());
  assert.ok(ui.refetches.includes('proxima-pagina'));
});

test('Alertas e importações: o servidor manda 20; "Ver mais" pede mais 20', () => {
  const alertas = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, workspace_id: 'w', kind: 'bill_due', ref: `r${i}`, sent_on: '2026-09-20', channel: 'push', created_at: `2026-09-20T10:${String(i).padStart(2, '0')}:00Z` }));
  const ui = screen('src/app/profile/alerts.tsx', { alerts: alertas });
  assert.equal(ui.pedidosDeLimite.at(-1)?.[1], 20);
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais');
  assert.equal(mais.props.restantes, null, 'veio a página cheia: pode ter mais');
  ui.interact(() => mais.props.onPress());
  assert.equal(ui.pedidosDeLimite.at(-1)?.[1], 40);

  const lotes = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, filename: `f${i}.ofx`, source: 'ofx', account_id: null, status: 'done', error: null, created_at: '2026-09-20T10:00:00Z', total: 1, pendentes: 0, aprovados: 1, descartados: 0, duplicados: 0 }));
  const ui2 = screen('src/app/import-history.tsx', { batches: lotes });
  const mais2 = ui2.nodes().find((n: any) => n.type === 'VerMais');
  assert.equal(mais2.props.restantes, null);
  ui2.interact(() => mais2.props.onPress());
  assert.equal(ui2.pedidosDeLimite.filter((p: any) => p[0] === 'batches').at(-1)?.[1], 40);
});

test('Notas arquivadas: com mais no servidor, "Ver mais" busca a próxima página', () => {
  const notas = [{ id: 'n1', content: 'Reunião', archived_at: '2026-09-20T10:00:00Z', pinned: false, color: null }];
  const ui = screen('src/app/notes/archived.tsx', { notes: notas, maisPaginas: true });
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais');
  assert.equal(mais.props.restantes, null);
  ui.interact(() => mais.props.onPress());
  assert.ok(ui.refetches.includes('proxima-pagina'));
});

test('Hoje: "Agora" com muito atrasado mostra aos poucos, com "Ver mais"', () => {
  const contas = Array.from({ length: 25 }, (_, i) => ({ ref_id: `c${i}`, title: `conta ${i}`, due_date: `2026-08-${String(i + 1).padStart(2, '0')}`, amount_cents: 1000, kind: 'transaction', overdue: true }));
  const ui = screen(hojeFile, { bills: contas });
  assert.equal(ui.nodes().filter((n: any) => n.type === 'AgendaItem').length, 20);
  assert.ok(ui.nodes().some((n: any) => n.type === 'VerMais' && n.props.restantes === 5));
});

test('Busca: em "Tudo" cada tipo mostra 5 e "Ver mais" abre o tipo; dentro dele, "Ver mais" pede mais 20', () => {
  // 21 = o limite (20) + 1: o servidor tem mais.
  const notas = Array.from({ length: 21 }, (_, i) => ({ id: `n${i}`, content: `mercado ${i}`, folder_id: null, source: 'app', updated_at: '2026-09-20T10:00:00Z' }));
  const ui = screen('src/app/search.tsx', { buscaNotas: notas });
  const linhas = () => ui.nodes().filter((n: any) => n.type === 'Row' && /^mercado /.test(n.props.title));
  assert.equal(linhas().length, 5);
  const chip = ui.nodes().find((n: any) => n.type === 'Chip' && /^Notas/.test(n.props.label));
  assert.equal(chip.props.label, 'Notas 20+', 'o chip não finge que 20 é o total');
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'VerMais').props.onPress());
  assert.equal(linhas().length, 20, 'abriu o tipo');
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'VerMais').props.onPress());
  assert.equal(ui.pedidosDeLimite.at(-1)?.[1], 40);
});

test('Contas: dentro de cada seção, a conta mais recente primeiro', () => {
  const saldo = (id: string, name: string) => ({ account_id: id, name, type: 'checking', balance_cents: 0, cleared_cents: 0, pending_in_cents: 0, pending_out_cents: 0 });
  const ui = screen('src/app/finance/accounts.tsx', {
    // `useAccounts` vem por ordem de criação (a mais antiga primeiro); o saldo vem sem ordem.
    forecastAccounts: [
      { id: 'velha', name: 'Beta', type: 'checking', created_at: '2026-08-01T10:00:00Z' },
      // No empate a POSIÇÃO diz Zeta antes de Alfa; quem decide é o nome.
      { id: 'empate', name: 'Alfa', type: 'checking', created_at: '2026-09-01T10:00:00Z' },
      { id: 'nova', name: 'Zeta', type: 'checking', created_at: '2026-09-01T10:00:00Z' },
    ],
    balances: [saldo('velha', 'Beta'), saldo('nova', 'Zeta'), saldo('empate', 'Alfa')],
  });
  const ordem = ui.nodes().filter((n: any) => n.type === 'ItemLink').map((n: any) => n.props.title);
  // A mais recente primeiro; no empate (criadas juntas), o nome.
  assert.deepEqual(JSON.parse(JSON.stringify(ordem)), ['Alfa', 'Zeta', 'Beta']);
});

test('Faturas: fatura FUTURA sem compra nenhuma não aparece em "Próximas faturas"', () => {
  const fatura = (id: string, mes: string, n: number) => ({ id, reference_month: `${mes}-01`, closing_date: `${mes}-03`, due_date: `${mes}-10`, status: 'open', paid_at: null, payment_transaction_id: null, rolled_into_invoice_id: null, total_cents: n * 1000, tx_count: n });
  const ui = screen('src/app/finance/invoices.tsx', {
    forecastAccounts: [{ id: 'card-1', name: 'Nubank Cartão', type: 'credit_card' }],
    faturas: [fatura('f3', '2028-01', 0), fatura('f2', '2027-02', 2), fatura('f1', '2026-09', 3)],
  });
  const proximas = ui.nodes().find((n: any) => n.type === 'Section' && n.props.title === 'Próximas faturas');
  const titulos = ui.nodes().filter((n: any) => n.type === 'Row' && n.props.icon === 'calendar').map((n: any) => n.props.title);
  assert.ok(proximas);
  assert.equal(titulos.length, 1, 'só a que tem compra');
});

test('Dinheiro não encolhe por padrão; encolhe só onde o bloco tem geometria fixa (24/09/2026)', () => {
  // No iPhone o `adjustsFontSizeToFit` encolhe numa passada de layout estreita e não volta a
  // crescer: "Comecei com" e a parcela do macbook ficaram minúsculos no ciclo.
  const solto = screen('src/components/ui/money.tsx', { componente: 'Money', props: { cents: 4890500 } });
  assert.equal(solto.nodes().find((n: any) => n.type === 'ThemedText').props.adjustsFontSizeToFit, false);
  const noBloco = screen('src/components/ui/money.tsx', { componente: 'Money', props: { cents: 4890500, encolhe: true } });
  assert.equal(noBloco.nodes().find((n: any) => n.type === 'ThemedText').props.adjustsFontSizeToFit, true);
  // Quem tem geometria fixa liga o encolher para o valor que recebe.
  for (const arquivo of ['src/components/ui/tile.tsx', 'src/components/ui/hero-panel.tsx', 'src/components/finance/card-face.tsx']) {
    assert.match(readFileSync(arquivo, 'utf8'), /DinheiroEncolhe\.Provider value|<Money[^>]*\bencolhe\b/, arquivo);
  }
});

test('Importações: apagar o registro diz o que fica no financeiro sem "Os 0 lançamentos"', () => {
  const lote = (aprovados: number) => ({ id: `b${aprovados}`, filename: 'f.csv', source: 'csv', account_id: null, status: 'done', error: null, created_at: '2026-09-20T10:00:00Z', total: 3, pendentes: 0, aprovados, descartados: 3 - aprovados, duplicados: 0 });
  for (const [n, esperado] of [[0, /Nada desta importação entrou no financeiro/], [1, /^O lançamento que você confirmou continua/], [3, /^Os 3 lançamentos que você confirmou continuam/]] as const) {
    const ui = screen('src/app/import-history.tsx', { batches: [lote(n)] });
    const linha = ui.nodes().find((x: any) => x.type === 'Deslizavel');
    ui.interact(() => linha.props.acoes.find((a: any) => a.label === 'Apagar registro').onPress());
    assert.match(ui.avisos.at(-1), esperado, `com ${n} confirmados`);
  }
});

test('Orçamentos: "Sem limite definido" mostra 5 e o resto vem pelo "Ver mais" (era corte calado)', () => {
  const gastos = Array.from({ length: 8 }, (_, i) => ({ category: `cat ${i}`, kind: 'expense', total_cents: 10000 - i * 100, count: 1 }));
  const ui = screen('src/app/finance/budgets.tsx', { saiuNoCiclo: gastos });
  const sugestoes = () => ui.nodes().filter((n: any) => n.type === 'Button' && n.props.label === 'Definir limite');
  assert.equal(sugestoes().length, 5);
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais');
  assert.equal(mais?.props.restantes, 3);
  ui.interact(() => mais.props.onPress());
  assert.equal(sugestoes().length, 8);
});

test('Últimos lançamentos: a linha recebe o toque do Link do iOS (24/09/2026)', () => {
  // No iOS o `ItemLink` é `<Link asChild>`, que INJETA `onPress` no filho, e o filho vem sem
  // `onLongPress` (quem abre o menu lá é o `Link.Menu`). O `LedgerRow` desenhava uma `View` sem
  // `onLongPress` e jogava o `onPress` fora: tocar no lançamento não abria nada.
  let tocou = 0;
  const ui = screen('src/components/ui/ledger-row.tsx', {
    componente: 'LedgerRow',
    props: { title: 'Ferramentas', icon: 'house', cents: -44300, signed: true, tone: 'text', date: '11/09/2026', accessibilityLabel: 'Ferramentas', onPress: () => { tocou += 1; } },
  });
  const tocavel = ui.nodes().find((n: any) => n.type === 'Pressable' && typeof n.props.onPress === 'function');
  assert.ok(tocavel, 'a linha é tocável quando o Link injeta onPress');
  tocavel.props.onPress();
  assert.equal(tocou, 1);
});

test('Todo filho de ItemLink repassa o onPress que o Link do iOS injeta', () => {
  // Contrato de `ItemLink` (iOS): o filho recebe `onPress` do `<Link asChild>`. Componente novo
  // que não o repassa fica mudo no iPhone e funciona no Android — foi o `LedgerRow`.
  const repassam = new Set(['Row', 'Pressable', 'LedgerRow']);
  const arquivos = ['src/app/(tabs)/finance/index.tsx', 'src/app/finance/accounts.tsx', 'src/app/finance/transactions.tsx', 'src/app/finance/invoice/[id].tsx', 'src/components/notes/note-card.tsx'];
  for (const arquivo of arquivos) {
    const fonte = readFileSync(arquivo, 'utf8');
    for (const m of fonte.matchAll(/\{\(\{ onLongPress \}\) => \(\s*<([A-Z][A-Za-z]*)/g)) {
      assert.ok(repassam.has(m[1]), `${arquivo}: <${m[1]}> como filho de ItemLink precisa repassar onPress`);
    }
  }
  for (const [comp, arquivo] of [['Row', 'src/components/ui/row.tsx'], ['LedgerRow', 'src/components/ui/ledger-row.tsx']]) {
    assert.match(readFileSync(arquivo, 'utf8'), /\bonPress\b[\s\S]*<Pressable[\s\S]*onPress=\{onPress\}/, `${comp} repassa onPress ao Pressable`);
  }
});

test('Lançamentos: a linha diz a data da COMPRA, nunca o vencimento da fatura (24/09/2026)', () => {
  // "o wardogs mostra na data que vai entrar na fatura ao invés de mostrar a data que o
  // lançamento foi feito de fato" — a linha escrevia "na fatura de 10/10" e nada da compra.
  const base = { kind: 'expense', amount_cents: 5250, category: 'jogos', account_id: 'c1', status: 'pending', invoice_id: 'f1', source: 'app' };
  const ui = screen('src/app/finance/transactions.tsx', {
    txs: [
      { ...base, id: 'w1', description: 'wardogs (1/2)', occurred_at: '2026-09-14', due_at: '2026-10-10', installment_no: 1, installment_plan_id: 'p', installment_plans: { first_occurred_at: '2026-09-14' } },
      { ...base, id: 'w2', description: 'wardogs (2/2)', occurred_at: '2026-10-14', due_at: '2026-11-10', installment_no: 2, installment_plan_id: 'p', installment_plans: { first_occurred_at: '2026-09-14' } },
      { ...base, id: 'b1', description: 'Boleto', occurred_at: '2026-10-08', due_at: '2026-10-08', invoice_id: null, installment_no: null, installment_plans: null },
    ],
  });
  // A linha mora no render prop do `ItemLink`, que o harness não desce sozinho.
  const legenda = (titulo: string) => {
    const link = ui.nodes().find((n: any) => n.type === 'ItemLink' && n.props.title === titulo);
    assert.ok(link, `linha ${titulo}`);
    return link.props.children({}).props.subtitle as string;
  };
  for (const t of ['wardogs (1/2)', 'wardogs (2/2)']) assert.doesNotMatch(legenda(t), /fatura/, t);
  assert.match(legenda('wardogs (2/2)'), /compra em 14\/09/);
  assert.doesNotMatch(legenda('wardogs (1/2)'), /compra em/, 'a parcela 1 já está no dia da compra');
  // Conta a pagar fora do cartão: o vencimento É a data dela.
  // (o `formatDateBR` do harness é um dublê de data fixa — o que se prende aqui é o rótulo)
  assert.match(legenda('Boleto'), /^vence /);
});

test('Lista principal vazia com seção secundária: a secundária em cima e o vazio COMPACTO embaixo', () => {
  // "A tela de arquivadas quando não tem nenhum financiamento e tem uma arquivada está horrível…
  // tem que mostrar o arquivadas em cima e depois embaixo mostrar que não tem nenhuma dívida
  // ativa. Esse layout tem que ser em todas as telas que tiver coisas assim." (24/09/2026)
  const ordem = (ui: any, secundaria: (n: any) => boolean) => {
    const nos = ui.nodes();
    const iSec = nos.findIndex(secundaria);
    const iVazio = nos.findIndex((n: any) => n.type === 'EmptyState');
    assert.ok(iSec >= 0, 'seção secundária na tela');
    assert.ok(iVazio >= 0, 'a tela diz que não há nada ativo');
    assert.ok(iSec < iVazio, 'secundária antes do vazio');
    assert.equal(nos[iVazio].props.compacto, true, 'o vazio é compacto quando há outra coisa na tela');
  };
  const carro = { id: 'd1', name: 'Carro', kind: 'financing', calculation_mode: 'fixed_installments', principal_cents: 100, remaining_cents: 100, installments: 10, installments_paid: 0, installment_cents: 10, due_day: 10, archived: true };
  ordem(screen(debtsFile, { create: false, debts: [], archivedDebts: [carro] }), (n: any) => n.type === 'Row' && /^Arquivadas/.test(n.props.title ?? ''));
  const meta = { id: 'g1', name: 'Viagem', target_cents: 1000, saved_cents: 1000, deadline: null, archived: false };
  ordem(screen('src/app/finance/goals.tsx', { goals: [meta] }), (n: any) => n.type === 'SectionHead' && /^Concluídas/.test(n.props.title ?? ''));
  const plano = { id: 'p1', title: 'tv', description: 'tv', merchant: null, category: null, account_id: null, total_cents: 1000, installments: 2, installment_cents: 500, first_occurred_at: '2026-01-01', active: false, paid: 2, remaining_cents: 0, locked: 2, locked_cents: 1000, locked_paid: 2, parcels: [] };
  ordem(screen('src/app/finance/installments.tsx', { plans: [plano] }), (n: any) => n.type === 'Section' && n.props.title === 'Terminadas');
  const serie = { id: 's1', description: 'Academia', kind: 'expense', amount_cents: 100, rrule: 'FREQ=MONTHLY;BYMONTHDAY=5', active: false, next_run_at: '2026-10-05T12:00:00Z', dtstart: '2026-01-05', category: null, account_id: null };
  ordem(screen('src/app/finance/recurring.tsx', { recurring: [serie] }), (n: any) => n.type === 'SectionHead' && n.props.title === 'Pausadas');
  ordem(screen('src/app/reminders.tsx', { reminders: [{ id: 'r1', title: 'Remédio', active: false, next_run_at: null, rrule: null }] }), (n: any) => n.type === 'Section' && n.props.title === 'Pausados');
});

const dicas = (ui: ReturnType<typeof screen>) =>
  ui.nodes().filter((n: any) => n.type === 'Dica').map((n: any) => n.props.id);

test('Hoje: a dica do painel mora no herói, e tocar nele a encerra', () => {
  const ui = screen(hojeFile, { balances: [saldo('Nubank', 'checking', 120_00)] });
  assert.deepEqual(dicas(ui), ['hoje-painel', 'conta-extrato']);
  ui.nodes().find((n: any) => n.type === 'HeroPanel').props.onPress();
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'usarDica', value: 'hoje-painel' });
});

test('Hoje: sem conta na tela, a dica das contas não é montada', () => {
  assert.deepEqual(dicas(screen(hojeFile)), ['hoje-painel']);
});

test('Lançamentos: a dica do arrasto aponta para a primeira linha, e some com a lista vazia', () => {
  assert.deepEqual(dicas(screen(transacoesFile)), ['lista-arrasto']);
  assert.deepEqual(dicas(screen(transacoesFile, { txs: [] })), []);
});

const guiaFile = 'src/app/guia.tsx';

test('Guia: "Mostrar" de um gesto acende a dica e leva à tela dela', () => {
  const ui = screen(guiaFile);
  const pilha = ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'Todos os cartões');
  assert.ok(pilha, 'o item precisa estar no guia');
  pilha.props.onPress();
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'reacenderDica', value: 'fin-pilha' });
  assert.equal(ui.navigations.at(-1), '/finance');
});

test('Guia: item sem dica só leva à tela, sem acender nada', () => {
  const ui = screen(guiaFile);
  ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'Importar fatura ou extrato').props.onPress();
  assert.equal(ui.writes.length, 0);
  assert.equal(ui.navigations.at(-1), '/import');
});

const notasFile = 'src/app/(tabs)/notes/index.tsx';
const nota = (id: string, pinned = false) => ({ id, content: `Nota ${id}`, pinned, updated_at: '2026-09-20T12:00:00Z', folder_id: null, color: null });

test('Notas: a dica do arrasto aparece com notas na tela, e some com a lista vazia', () => {
  assert.deepEqual(dicas(screen(notasFile, { notes: [nota('n1')] })), ['lista-arrasto']);
  assert.deepEqual(dicas(screen(notasFile, { notes: [] })), []);
});

test('Notas: o arquivado tem porta no fim da aba, com a contagem, e ela some sem nada arquivado', () => {
  const ui = screen(notasFile, { notes: [nota('n1')], arquivadas: 2 });
  const porta = ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'Arquivadas · 2');
  assert.ok(porta, 'a linha "Arquivadas · 2" precisa aparecer');
  porta.props.onPress();
  assert.equal(ui.navigations.at(-1), '/notes/archived');
  const sem = screen(notasFile, { notes: [nota('n1')] });
  assert.ok(!sem.nodes().some((n: any) => n.type === 'Row' && String(n.props.title).startsWith('Arquivadas')));
});

test('Card: os filhos têm respiro entre si — o texto e o botão não colam (design.md §2)', () => {
  // "É pagamento de uma dívida." colado no "Ver dívidas" (24/09/2026): o `Card` não punha espaço
  // entre filhos, e cada tela que esquecia do `gap` no próprio estilo saía assim.
  const ui = screen('src/components/ui/card.tsx', { componente: 'Card', props: { children: ['a', 'b'] } });
  const caixa = ui.nodes().find((n: any) => n.type === 'View');
  assert.ok(caixa, 'o card desenha uma View');
  const base = [caixa.props.style].flat(Infinity).find((s: any) => s && 'padding' in s);
  assert.ok(base && 'gap' in base, 'a base do Card tem `gap`');
});
