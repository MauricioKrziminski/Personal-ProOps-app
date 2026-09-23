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
function screen(file: string, options: { tablet?: boolean; debts?: any[]; archivedDebts?: any[]; debtSchedule?: any[]; invoiceStatus?: string; create?: boolean; monthLines?: any[]; monthSummary?: any; cycleLines?: any[]; cycleRow?: any; rangeError?: boolean; rangePending?: boolean; rangePendingMonths?: string[]; bills?: any[]; billsError?: boolean; charges?: any[]; reminders?: any[]; budgets?: any[]; setupPassos?: any[]; proximo?: any; activity?: any[]; activityError?: boolean; forecastAccounts?: any[]; anticipation?: any[] | ((pagarEm: string) => any[]); cards?: any[]; params?: Record<string, string>; plan?: string; planPending?: boolean; txStatus?: string; recent?: any[]; rules?: any[] } = {}) {
  const state: any[] = [];
  let cursor = 0;
  let nodes: any[] = [];
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
  const mutation = (operation: string) => ({ isPending: false, reset() {}, mutate(value: any) { writes.push({ operation, value }); } });
  const animation = { duration: () => animation, delay: () => animation };
  const finance = new Proxy({
    DEBT_KINDS: [{ value: 'financing', label: 'Financiamento' }, { value: 'loan', label: 'Empréstimo' }],
    SUGGESTED_CATEGORIES: [],
    ACCOUNT_TYPES: [{ value: 'checking', label: 'Conta corrente', icon: 'building.columns' }],
    INCOME_CATEGORIES: [],
    ASSET_CLASSES: [{ value: 'investment', label: 'Investimento', icon: 'chart.line.uptrend.xyaxis' }],
    useDebts: () => ({ ...query, data: options.debts ?? [] }),
    useCardSummary: () => ({ ...query, isSuccess: true, data: options.cards ?? [] }),
    // Só responde quando o teste dá os lançamentos: respondido e vazio, o Financeiro afirmaria
    // "Ainda não tem movimento", e o teste das bordas falhando depende de ele NÃO afirmar.
    useRules: () => ({ ...query, isSuccess: true, data: options.rules ?? [] }),
    useRecentTransactions: () => (options.recent ? { ...query, isSuccess: true, data: options.recent } : query),
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
      : { ...query, data: { pages: [[{ id: 'tx-1', kind: 'expense', amount_cents: 4500, occurred_at: '2026-09-15', description: 'Mercado', category: 'mercado', account_id: null, status: options.txStatus ?? 'cleared' }]], pageParams: [] }, isPending: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: () => {}, refetch: async () => { refetches.push('list'); } },
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
    useForecastMonths: () => ({ ...query, data: { hoje: 10000, meses: [] }, isPlaceholderData: false }),
    // O mês é uma STRING (`2026-09`); sem este dublê o Proxy devolvia um objeto-consulta.
    useCycleMonth: () => '2026-09',
    useMonthBreakdown: () => ({ ...query, data: [] }),
    useSaveDebt: () => mutation('saveDebt'),
    useArchiveDebt: () => mutation('archiveDebt'),
    useUnarchiveDebt: () => mutation('unarchiveDebt'),
    useDeleteDebt: () => mutation('deleteDebt'),
    useArchivedDebts: () => ({ ...query, data: options.archivedDebts ?? [] }),
    useDebtSchedule: () => ({ ...query, data: options.debtSchedule ?? [] }),
    useDebtPayments: () => ({ ...query, isSuccess: true, data: [] }),
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
        useState(initial: any) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], (value: any) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
        useMemo: (fn: () => unknown) => fn(),
        useCallback: (fn: unknown) => fn,
        useRef: (v: unknown) => ({ current: v }),
        useEffect: () => {},
      };
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return { StyleSheet: { create: (value: unknown) => value }, View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', FlatList: 'FlatList', useWindowDimensions: () => ({ width: 384, height: 800 }), Platform: { OS: 'android', select: (o: any) => o.android ?? o.default } };
      if (name === 'react-native-reanimated') return { default: { View: 'AnimatedView' }, FadeInDown: animation, FadeOut: animation, FadeIn: animation, LinearTransition: animation };
      if (name === 'expo-haptics') return { selectionAsync() {}, notificationAsync() {}, NotificationFeedbackType: { Success: 'success', Warning: 'warning' } };
      // `back` é navegação como qualquer outra e ENTRA na lista: é o que prende o "fechar um
      // formulário que outra tela abriu devolve para ela" (`useVoltarQuandoFechar`).
      if (name === 'expo-router') return { Stack: { Screen: 'StackScreen' }, useLocalSearchParams: () => options.params ?? ({ id: 'invoice-1', ...(options.create !== false ? { create: 'financing' } : {}) }), router: { push: (to: any) => navigations.push(to), back: () => navigations.push({ back: true }) } };
      if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
      if (name === '@/hooks/use-finance') return finance;
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
      if (name === '@/hooks/use-theme') return { useTheme: () => ({}), useScheme: () => 'light' };
      // portão de "a tela está pronta": no harness nada carrega, então ele já nasce aberto
      if (name === '@/hooks/use-tela-pronta') return { useTelaPronta: (...consultas: any[]) => { gates.push(consultas); return true; } };
      // Carregado DE VERDADE: ele é a regra que se quer testar, não um arredor da tela.
      if (name === '@/hooks/use-voltar-quando-fechar') return load('src/hooks/use-voltar-quando-fechar.ts');
      if (name === '@/hooks/use-items') return { localISODate: () => '2026-09-08', formatDateBR: () => '08/09/2026', formatBRL: load('src/lib/dates.ts').formatBRL, useRealtimeInvalidate: () => {}, useTodayReminders: () => ({ ...query, isSuccess: true, data: options.reminders ?? [] }), useReminders: () => ({ ...query, isSuccess: true, data: options.reminders ?? [] }), useToggleReminder: () => mutation('toggleReminder'), useDeleteReminder: () => mutation('deleteReminder') };
      if (name === '@/hooks/use-session') return { useSession: () => ({ session: { user: { id: 'user-1' } } }) };
      if (name === '@/hooks/use-profile') return { useProfile: () => ({ ...query, isSuccess: true, data: { display_name: 'Gabriel Almeida', phone: null } }) };
      if (name === '@/hooks/use-proximo-passo') return { useProximoPasso: () => ({ passo: options.proximo ?? null, dispensar: (id: string) => writes.push({ operation: 'dispensarProximo', value: id }), consultas: [] }) };
      if (name === '@/hooks/use-setup-progress') return { useSetupProgress: () => ({ passos: options.setupPassos ?? [], pronto: true, consultas: [] }) };
      if (name === '@/hooks/use-bool-pref') return { useBoolPref: () => [false, () => {}] };
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
      if (name === '@tanstack/react-query') return { useQuery: () => query };
      if (name === '@/lib/finance-form' || name === '@/lib/dates' || name === '@/lib/forecast-months' || name === '@/lib/month-view' || name === '@/lib/settle-labels' || name === '@/lib/accounts' || name === '@/lib/cycle-label' || name === '@/lib/card-status' || name === '@/lib/today-sections' || name === '@/lib/runway' || name === '@/lib/budget-tight' || name === '@/lib/setup-steps' || name === '@/lib/activity-feed' || name === '@/lib/account-cash' || name === '@/lib/today-spend' || name === '@/lib/anticipation' || name === '@/lib/widget-snapshot' || name === '@/lib/debt-history' || name === '@/lib/import-preview' || name === '@/lib/arrasto') return load(`src/lib/${name.split('/').at(-1)}.ts`);
      if (name === '@/hooks/use-debounced') return { useDebounced: (value: unknown) => value };
      if (name === '@/design/category-icons') return { categoryIcon: () => 'circle' };
      if (name === '@/design/adaptive-window') return load('src/design/adaptive-window.ts');
      // import relativo DENTRO de um módulo puro já carregado (month-view → ./dates.ts)
      if (name === './dates.ts' || name === './dates') return load('src/lib/dates.ts');
      if (name === './debt-history.ts' || name === './debt-history') return load('src/lib/debt-history.ts');
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
      if (name === '@/lib/item-actions') return { confirmDestructive: (_title: string, _label: string, callback: () => void) => confirmations.push(callback), showItemActions: (_title: string, entries: any[]) => actions.push(...entries) };
      if (name === '@/components/ui/toast') return { useToast: () => () => {} };
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
  const Component = load(file).default;
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
  const render = () => { cursor = 0; nodes = []; visit(Component()); };
  render();
  return {
    writes, confirmations, actions, navigations, refetches, gates,
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
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Pressable' && n.props.onLongPress).props.onLongPress());
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
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Pressable' && n.props.onLongPress).props.onLongPress());
  assert.deepEqual(ui.actions.map((a: any) => a.label), ['Ver as parcelas', 'Editar', 'Arquivar', 'Excluir por completo']);
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

test('without archived debts there is no empty "Arquivadas" row', () => {
  const ui = screen(debtsFile, { create: false, debts: [carro] });
  assert.equal(ui.nodes().some((n) => n.type === 'Row' && String(n.props.title).startsWith('Arquivadas')), false);
});

test('delete for good asks with the consequence first, then deletes', async () => {
  const ui = screen(debtsFile, { create: false, debts: [carro] });
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Pressable' && n.props.onLongPress).props.onLongPress());
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Excluir por completo').onPress());
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ui.writes.some((w: any) => w.operation === 'deleteDebt'), false, 'nada sai antes do SIM');
  assert.equal(ui.confirmations.length, 1);
  ui.interact(() => ui.confirmations[0]());
  assert.deepEqual(ui.writes.at(-1), { operation: 'deleteDebt', value: 'd1' });
});

test('the detail has the "…" with the same actions as the long press', () => {
  const ui = screen(debtsFile, { create: false, debts: [carro] });
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Pressable' && n.props.onLongPress).props.onPress());
  const menu = ui.nodes().find((n) => n.type === 'HeaderIconButton' && n.props.label === 'Mais ações');
  assert.ok(menu, 'o detalhe tem o "…" no alto');
  ui.interact(() => menu.props.onPress());
  // no detalhe "Ver as parcelas" sai: é o que já se está vendo
  assert.deepEqual(ui.actions.map((a: any) => a.label), ['Editar', 'Arquivar', 'Excluir por completo']);
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

test('editing a legacy amortized financing preserves its mode and remaining-term semantics', () => {
  const ui = screen(debtsFile, { create: false, debts: [{ id: 'old-debt', name: 'Carro', kind: 'financing', calculation_mode: 'amortized', principal_cents: 7056000, remaining_cents: 5880000, installments: 48, installments_paid: 8, installment_cents: 147000, interest_rate_monthly: 0.0199, account_id: null, due_day: 10 }] });
  ui.interact((nodes) => nodes.find((n) => n.type === 'Pressable' && n.props.onLongPress).props.onLongPress());
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

const passoImportar = { id: 'importar', titulo: 'Traga a fatura do cartão', texto: 'x', acao: 'Importar fatura', icon: 'square.and.arrow.down', href: '/import?conta=c1' };

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
  assert.match(String(tile.props.caption), /acima do ritmo/);
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
    ['Gasto ou receita', 'Gasto ou receita que se repete', 'Financiamento']
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
    ['Gasto ou receita', 'Gasto ou receita que se repete', 'Financiamento']);
});

test('Cartões: "Importar fatura" se alcança com o DEDO (toque longo), não só pelo leitor de tela', () => {
  const ui = screen('src/app/finance/cards.tsx', { cards: [{ account_id: 'card-1', name: 'Nubank Cartão', invoice_id: 'invoice-1', invoice_total_cents: 10000, unpaid_total_cents: 10000, closing_date: '2026-10-03', due_date: '2026-10-10', overdue_count: 0 }] });
  const card = ui.nodes().find((n: any) => typeof n.type === 'function' && n.type.name === 'PressCard');
  assert.ok(card, 'o card do cartão');
  const tocavel = card.type(card.props);
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
  // JSON: o harness roda a tela noutro contexto (vm), e arrays de lá não são `deepStrictEqual` daqui.
  return JSON.parse(JSON.stringify({ direita: l.direita.map((a: any) => a.label), esquerda: l.esquerda.map((a: any) => a.label), mais: l.mais, pontaDireita: l.pontaDireita?.label ?? null, pontaEsquerda: l.pontaEsquerda?.label ?? null }));
};
const deslizaveis = (ui: any) => ui.nodes().filter((n: any) => n.type === 'Deslizavel');

test('Lembretes: arrastar à direita pausa (até o fim, com Desfazer), à esquerda apaga', () => {
  const ui = screen('src/app/reminders.tsx', { reminders: [{ id: 'r1', title: 'Aluguel', active: true, next_run_at: '2026-10-05T12:00:00Z', recurrence: null }] });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'o lembrete está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Pausar'], esquerda: ['Apagar'], mais: false, pontaDireita: 'Pausar', pontaEsquerda: null });
  // o toque longo continua com todas as ações
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Row' && n.props.onLongPress).props.onLongPress());
  assert.deepEqual(JSON.parse(JSON.stringify(ui.actions.map((a: any) => a.label))), ['Editar', 'Pausar', 'Apagar']);
});

const itemLinks = (ui: any) => ui.nodes().filter((n: any) => n.type === 'ItemLink');
const ladosDoLink = (node: any) => ladosDe({ props: { acoes: node.props.actions } });

test('Lançamentos: pendente arrasta Paguei à direita; efetivado arrasta Editar; Apagar à esquerda', () => {
  const pendente = itemLinks(screen(transacoesFile, { txStatus: 'pending' }))[0];
  assert.deepEqual(ladosDoLink(pendente), { direita: ['Paguei'], esquerda: ['Apagar'], mais: true, pontaDireita: null, pontaEsquerda: null });
  const efetivado = itemLinks(screen(transacoesFile))[0];
  assert.deepEqual(ladosDoLink(efetivado), { direita: ['Editar'], esquerda: ['Apagar'], mais: false, pontaDireita: null, pontaEsquerda: null });
});

test('Financeiro: o último lançamento arrasta Editar e Apagar (Ver detalhe é o toque)', () => {
  const ui = screen(financeiroFile, { recent: [{ id: 't1', kind: 'expense', amount_cents: 4500, occurred_at: '2026-09-15', description: 'Mercado', status: 'cleared' }] });
  assert.deepEqual(ladosDoLink(itemLinks(ui)[0]), { direita: ['Editar'], esquerda: ['Apagar'], mais: false, pontaDireita: null, pontaEsquerda: null });
});

test('Fatura: a compra arrasta Editar e Apagar', () => {
  const ui = screen('src/app/finance/invoice/[id].tsx');
  assert.deepEqual(ladosDoLink(itemLinks(ui)[0]), { direita: ['Editar'], esquerda: ['Apagar'], mais: false, pontaDireita: null, pontaEsquerda: null });
});

test('Contas: a conta arrasta Editar e Arquivar (Ver extrato é o toque)', () => {
  const ui = screen('src/app/finance/accounts.tsx', {
    balances: [{ account_id: 'a1', name: 'Nubank', type: 'checking', balance_cents: 10000, cleared_cents: 10000, pending_in_cents: 0, pending_out_cents: 0 }],
    forecastAccounts: [{ id: 'a1', name: 'Nubank', type: 'checking', archived: false }],
  });
  const [link] = itemLinks(ui);
  assert.ok(link, 'a conta está num ItemLink');
  assert.deepEqual(ladosDoLink(link), { direita: ['Editar'], esquerda: ['Arquivar'], mais: false, pontaDireita: null, pontaEsquerda: null });
});

test('Projeção: a conta prevista arrasta Paguei à direita e Editar à esquerda', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], bills: [{ ref_id: 'b1', title: 'Aluguel', kind: 'expense', amount_cents: 180000, due_date: '2026-10-05', overdue: false }] });
  const card = deslizaveis(ui).find((n: any) => n.props.titulo === 'Aluguel');
  assert.ok(card, 'a conta prevista está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Paguei'], esquerda: ['Editar'], mais: false, pontaDireita: null, pontaEsquerda: null });
});

test('Regras: a regra arrasta Editar e Apagar', () => {
  const ui = screen('src/app/finance/rules.tsx', { rules: [{ id: 'r1', pattern: 'ifood', category: 'restaurante', match_type: 'contains', account_id: null, hits: 3, source: 'user' }] });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'a regra está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Editar'], esquerda: ['Apagar'], mais: false, pontaDireita: null, pontaEsquerda: null });
});
