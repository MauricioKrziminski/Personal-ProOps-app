import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

import * as settleLabels from './settle-labels.ts';
import * as dates from './dates.ts';
import * as todaySections from './today-sections.ts';
import * as runway from './runway.ts';
import * as budgetTight from './budget-tight.ts';
import * as accountCash from './account-cash.ts';
import * as todaySpend from './today-spend.ts';
import * as activityFeed from './activity-feed.ts';
import * as widgetSnapshot from './widget-snapshot.ts';

const require = createRequire(import.meta.url);
function loadHooks(client: QueryClient, entry = 'src/hooks/use-finance.ts', dependencies: Record<string, unknown> = {}) {
  const load = (file: string): any => {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(code, { module, exports: module.exports, require: (name: string) => {
      if (name in dependencies) return dependencies[name];
      if (name === '@tanstack/react-query') return { ...require(name), useQueryClient: () => client, useMutation: (options: unknown) => options };
      if (name === 'react') return { useCallback: (fn: unknown) => fn };
      if (name === '@/lib/agent-api') return {};
      if (name === '@/lib/supabase') return { supabase: { rpc: async () => ({ error: null }) } };
      if (name.startsWith('@/lib/') && existsSync(`src/lib/${name.slice(6)}.ts`)) return load(`src/lib/${name.slice(6)}.ts`);
      return {};
    }, console, setTimeout, clearTimeout });
    return module.exports;
  };
  return load(entry);
}

test('settling a historical invoice refreshes history without realtime and invalidates inactive installment/report caches', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const historyKey = ['card-invoices', 'card-1', '60'];
  client.setQueryData(historyKey, 'open');
  const dependent = ['installments', 'annual-report', 'net-worth-series', 'cash-history', 'debt-schedule', 'goal-contributions'];
  for (const key of dependent) client.setQueryData([key, 'old'], 'old');
  const observer = new QueryObserver(client, { queryKey: historyKey, queryFn: async () => 'paid', staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  try {
    const mutation = loadHooks(client).useSettleInvoice();
    await mutation.mutationFn({ invoiceId: 'old-invoice', paidAt: '2025-06-10' });
    await mutation.onSuccess();
    assert.equal(client.getQueryData(historyKey), 'paid');
    for (const key of dependent) assert.equal(client.getQueryState([key, 'old'])?.isInvalidated, true, key);
  } finally { unsubscribe(); client.clear(); }
});

test('financial mutation remains pending until active reads finish', async () => {
  const client = new QueryClient();
  client.setQueryData(['invoice', 'old'], 'open');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const observer = new QueryObserver(client, { queryKey: ['invoice', 'old'], staleTime: Infinity, queryFn: async () => { await gate; return 'paid'; } });
  const unsubscribe = observer.subscribe(() => {});
  try {
    const result = loadHooks(client).useSettleInvoice().onSuccess();
    assert.equal(typeof result?.then, 'function', 'onSuccess must return the refetch promise');
    let finished = false;
    const completion = result.then(() => { finished = true; });
    await Promise.resolve();
    assert.equal(finished, false);
    release();
    await completion;
    assert.equal(client.getQueryData(['invoice', 'old']), 'paid');
  } finally { release(); unsubscribe(); client.clear(); }
});

 test('completed agent turn invalidates writable domains without relying on realtime', async () => {
  const client = new QueryClient();
  const keys = [['card-invoices', 'card'], ['notes', 'list'], ['reminders', 'today'], ['search', 'notes', 'oi']];
  for (const key of keys) client.setQueryData(key, 'old');
  try {
    await loadHooks(client, 'src/hooks/use-agent-chat.ts').useCreateAgentConversation().onSuccess({
      status: 'completed', conversation: { id: 'chat' }, user_message: { id: 'u' }, assistant_message: { id: 'a' },
    });
    for (const key of keys) assert.equal(client.getQueryState(key)?.isInvalidated, true, key.join('/'));
  } finally { client.clear(); }
});

test('every ledger mutation invalidates historical derived reads and search', async () => {
  const client = new QueryClient();
  const hooks = loadHooks(client);
  const mutations = [
    'usePayInvoice', 'useSettleInvoice', 'useCreateInstallmentPlan', 'useMarkPaid',
    'useApproveImportItems', 'useSaveDebt', 'usePayDebtInstallment', 'useArchiveDebt', 'useUnarchiveDebt', 'useDeleteDebt',
    'useSaveAsset', 'useArchiveAsset', 'useSaveTransaction', 'useDeleteTransaction',
    'useDeleteInstallmentPlan', 'useSaveAccount', 'useArchiveAccount', 'useSaveGoal',
    'useGoalDeposit', 'useArchiveGoal', 'useToggleRecurring', 'useDeleteRecurring',
    'useSaveBudget', 'useDeleteBudget',
  ];
  try {
    for (const name of mutations) {
      const key = ['search', 'transactions', 'mercado'];
      client.setQueryData(key, 'old result');
      client.setQueryData(['annual-report', '2025'], 'old totals');
      await hooks[name]().onSuccess();
      assert.equal(client.getQueryState(key)?.isInvalidated, true, name);
      assert.equal(client.getQueryState(['annual-report', '2025'])?.isInvalidated, true, name);
    }
  } finally { client.clear(); }
});

test('import create/approve/discard/update refresh batch history without waiting for realtime', async () => {
  const client = new QueryClient();
  const hooks = loadHooks(client);
  try {
    for (const name of ['useImportStatement', 'useApproveImportItems', 'useDiscardImportItems', 'useUpdateImportItem']) {
      client.setQueryData(['import-batches', '20'], 'old counts');
      await hooks[name]().onSuccess();
      assert.equal(client.getQueryState(['import-batches', '20'])?.isInvalidated, true, name);
    }
  } finally { client.clear(); }
});

test('agent processing response preserves domain caches until completion', async () => {
  const client = new QueryClient();
  client.setQueryData(['card-invoices', 'card'], 'open');
  try {
    await loadHooks(client, 'src/hooks/use-agent-chat.ts').useCreateAgentConversation().onSuccess({
      status: 'processing', conversation: { id: 'chat' }, user_message: { id: 'u' }, assistant_message: null,
    });
    assert.equal(client.getQueryState(['card-invoices', 'card'])?.isInvalidated, false);
  } finally { client.clear(); }
});

test('criar conversa: onMutate volta a local para processing; onError marca failed, invalida a lista e abre o paywall', async () => {
  const client = new QueryClient();
  const pushes: string[] = [];
  class AgentAuthExpiredError extends Error {}
  const hooks = loadHooks(client, 'src/hooks/use-agent-chat.ts', {
    '@/lib/agent-api': { AgentAuthExpiredError },
    'expo-router': { router: { push: (r: string) => pushes.push(r) } },
  });
  const key = ['agent', 'messages', 'conv-1'];
  const v = { id: 'conv-1', clientMessageId: 'c1', content: 'oi' };
  client.setQueryData(key, { pages: [{ items: [{ id: 'local:c1', client_message_id: 'c1', role: 'user', content: 'oi', status: 'failed', error_code: 'network', error_status: 0, created_at: '2020-01-01T00:00:00.000Z' }], next_cursor: null }], pageParams: [null] });
  client.setQueryData(['agent', 'conversations'], 'old');
  try {
    const m = hooks.useCreateAgentConversation();
    m.onMutate(v);
    let item = (client.getQueryData(key) as any).pages[0].items[0];
    assert.equal(item.status, 'processing');
    assert.equal(item.error_code, null);
    // o teto de 5 min recomeça no retry
    assert.ok(Date.now() - Date.parse(item.created_at) < 5_000);

    await m.onError({ status: 402, code: 'plan_limit', policy: { paywall: true } }, v);
    item = (client.getQueryData(key) as any).pages[0].items[0];
    assert.equal(item.status, 'failed');
    assert.equal(item.error_code, 'plan_limit');
    assert.equal(item.error_status, 402);
    assert.equal(client.getQueryState(['agent', 'conversations'])?.isInvalidated, true);
    assert.deepEqual(pushes, ['/paywall']);

    m.onMutate(v);
    await m.onError(new AgentAuthExpiredError(), v);
    assert.equal((client.getQueryData(key) as any).pages[0].items[0].status, 'processing');
    assert.deepEqual(pushes, ['/paywall']);
  } finally { client.clear(); }
});

test('realtime account change refreshes balances/forecast derived reads once per table', async () => {
  const client = new QueryClient();
  const cleanup: (() => void)[] = [];
  const callbacks: (() => unknown)[] = [];
  const supabase = {
    channel: () => ({
      on(_event: unknown, _filter: unknown, callback: () => void) { callbacks.push(callback); return this; },
      subscribe() { return this; },
    }),
    removeChannel: async () => {},
  };
  const hooks = loadHooks(client, 'src/hooks/use-items.ts', {
    react: { useEffect: (effect: () => () => void) => cleanup.push(effect()), useId: () => String(cleanup.length) },
    '@/lib/supabase': { supabase },
  });
  client.setQueryData(['account-balances'], 10);
  client.setQueryData(['forecast', '90'], 10);
  try {
    hooks.useRealtimeInvalidate('accounts', ['accounts']);
    hooks.useRealtimeInvalidate('accounts', ['accounts']);
    await Promise.all(callbacks.map((callback) => callback()));
    assert.equal(client.getQueryState(['account-balances'])?.isInvalidated, true);
    assert.equal(client.getQueryState(['forecast', '90'])?.isInvalidated, true);
    assert.equal(callbacks.length, 1, 'mounted sibling screens share one table subscription');
  } finally { for (const dispose of cleanup) dispose(); client.clear(); }
});

test('native resume reloads fresh active data, skips disabled reads and does not fetch on initial active event', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false } } });
  client.setQueryData(['invoice', 'fresh'], 'open');
  client.setQueryData(['invoice', 'disabled'], 'open');
  let reads = 0;
  const active = new QueryObserver(client, { queryKey: ['invoice', 'fresh'], queryFn: async () => { reads += 1; return 'paid'; } });
  const disabled = new QueryObserver(client, { queryKey: ['invoice', 'disabled'], enabled: false, queryFn: async () => { throw new Error('disabled read was fetched'); } });
  const off = [active.subscribe(() => {}), disabled.subscribe(() => {})];
  try {
    const createHandler = loadHooks(client, 'src/lib/query-invalidation.ts').createNativeQueryFocusHandler;
    assert.equal(typeof createHandler, 'function', 'native resume must have an explicit refetch handler');
    const changeState = createHandler(client, 'active');
    await changeState('active');
    assert.equal(reads, 0);
    await changeState('background');
    await changeState('active');
    assert.equal(client.getQueryData(['invoice', 'fresh']), 'paid');
    assert.equal(client.getQueryData(['invoice', 'disabled']), 'open');
    assert.equal(reads, 1);
    await changeState('active');
    assert.equal(reads, 1, 'duplicate active event must not trigger another fetch');
  } finally { off.forEach((dispose) => dispose()); client.clear(); }
});

test('native resume cancels an old inflight read before fetching current data', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false } } });
  client.setQueryData(['invoice', 'old-request'], 'open');
  let aborted = false;
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const observer = new QueryObserver(client, {
    queryKey: ['invoice', 'old-request'],
    queryFn: async ({ signal }) => {
      calls += 1;
      if (calls === 1) {
        signal.addEventListener('abort', () => { aborted = true; });
        await gate;
        return 'outdated open';
      }
      return 'paid';
    },
  });
  const off = observer.subscribe(() => {});
  try {
    const createHandler = loadHooks(client, 'src/lib/query-invalidation.ts').createNativeQueryFocusHandler;
    assert.equal(typeof createHandler, 'function', 'resume must replace reads started before suspension');
    const changeState = createHandler(client, 'active');
    const oldRequest = observer.refetch();
    await changeState('background');
    await changeState('active');
    assert.equal(aborted, true);
    assert.equal(client.getQueryData(['invoice', 'old-request']), 'paid');
    release();
    await oldRequest;
    assert.equal(client.getQueryData(['invoice', 'old-request']), 'paid');
    assert.equal(calls, 2);
  } finally { release(); off(); client.clear(); }
});

test('realtime remount does not reuse a channel whose asynchronous removal is still pending', () => {
  const client = new QueryClient();
  const cleanup: (() => void)[] = [];
  const names: string[] = [];
  const hooks = loadHooks(client, 'src/hooks/use-items.ts', {
    react: { useEffect: (effect: () => () => void) => cleanup.push(effect()) },
    '@/lib/supabase': { supabase: {
      channel(name: string) { names.push(name); return { on() { return this; }, subscribe() { return this; } }; },
      removeChannel: () => new Promise(() => {}),
    } },
  });
  hooks.useRealtimeInvalidate('accounts', ['accounts']);
  cleanup[0]();
  hooks.useRealtimeInvalidate('accounts', ['accounts']);
  try { assert.notEqual(names[0], names[1], 'old channel may remain registered until unsubscribe finishes'); }
  finally { cleanup[1](); client.clear(); }
});

test('48 realtime row events coalesce and an event during refetch still gets a final fresh read', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['account-balances'], 0);
  let value = 48;
  let calls = 0;
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const observer = new QueryObserver(client, { queryKey: ['account-balances'], queryFn: async () => {
    calls += 1;
    const snapshot = value;
    if (calls === 1) { firstStarted(); await gate; }
    return snapshot;
  } });
  const off = observer.subscribe(() => {});
  try {
    const schedule = loadHooks(client, 'src/lib/query-invalidation.ts').scheduleRealtimeFinanceRefresh;
    assert.equal(typeof schedule, 'function', 'row events need a finite coalescing window');
    const pending = Array.from({ length: 48 }, () => schedule(client));
    await started;
    assert.equal(calls, 1);
    value = 49;
    pending.push(schedule(client));
    release();
    await Promise.all(pending);
    assert.equal(calls, 2, 'one trailing read catches the event during the first request');
    assert.equal(client.getQueryData(['account-balances']), 49);
  } finally { release(); off(); client.clear(); }
});

function renderToday(bill: { kind: 'invoice' | 'transaction'; ref_id: string }) {
  const writes: unknown[] = [];
  const routes: unknown[] = [];
  const module = { exports: {} as any };
  const query = { data: [], isLoading: false, isRefetching: false, refetch: async () => {} };
  const finance = { useCycle: () => ({ ...query, data: null }), useCycleMonth: () => '2026-01', useSpendable: () => ({ ...query, data: { caixa: 72, comprometido_ate_entrada: 0, comprometido_no_ciclo: 832663, a_receber_no_ciclo: 756652, proxima_entrada: '2026-01-20' } }), useCashFlowForecast: () => query, useCycleSeries: () => ({ ...query, data: [] }), useAccountBalances: () => ({ ...query, data: [] }), useUpcomingBills: () => ({ ...query, data: [{ ...bill, title: 'Fatura teste', amount_cents: 147000, due_date: '2026-01-20', overdue: true }] }), useUpcomingCardCharges: () => ({ ...query, data: [] }), useSpendablePath: () => ({ ...query, data: [] }), useTransactionsSummary: () => ({ ...query, data: [] }), useBudgetsStatus: () => query, useRecentTransactions: () => query, useMarkPaid: () => ({ mutate: (...args: unknown[]) => writes.push(args) }) };
  const code = ts.transpileModule(readFileSync('src/app/(tabs)/today/index.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { module, exports: module.exports, require: (name: string) => {
    if (name === 'react') return { useMemo: (fn: () => unknown) => fn(), useState: (value: unknown) => [typeof value === 'function' ? value() : value, () => {}] };
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return { Platform: { OS: 'android' }, StyleSheet: { create: (v: unknown) => v }, useWindowDimensions: () => ({ width: 400 }), View: 'View', ScrollView: 'ScrollView', RefreshControl: 'RefreshControl' };
    if (name === 'expo-router') return { router: { push: (route: unknown) => routes.push(route) } };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
    if (name === '@/hooks/use-finance') return finance;
    if (name === '@/hooks/use-items') return { useTodayReminders: () => query, localISODate: () => '2026-09-08', formatDateBR: (s: string) => s, formatBRL: dates.formatBRL };
    if (name === '@/hooks/use-profile') return { useProfile: () => query };
    if (name === '@/hooks/use-setup-progress') return { useSetupProgress: () => ({ passos: [], pronto: true, consultas: [] }) };
    if (name === '@/hooks/use-proximo-passo') return { useProximoPasso: () => ({ passo: null, dispensar: () => {}, consultas: [] }) };
    if (name === '@/hooks/use-bool-pref') return { useBoolPref: () => [false, () => {}] };
    if (name === '@/hooks/use-agent-activity') return { useAgentActivity: () => query };
    // Puros, carregados de verdade pelo mesmo motivo de `dates` e `settle-labels` (abaixo).
    if (name === '@/lib/today-sections') return todaySections;
    if (name === '@/lib/runway') return runway;
    if (name === '@/lib/budget-tight') return budgetTight;
    if (name === '@/lib/account-cash') return accountCash;
    if (name === '@/lib/today-spend') return todaySpend;
    if (name === '@/lib/activity-feed') return activityFeed;
    if (name === '@/lib/widget-snapshot') return widgetSnapshot;
    /*
      O portão da Fase 5 devolve `true` aqui: este teste existe para conferir o CONTEÚDO da Hoje
      (para onde a fatura atrasada roteia, se o pull-to-refresh está exposto), e com o portão
      fechado a tela renderiza a forma de carregamento — nenhum dos dois apareceria, e a falha
      leria como regressão de produto.
    */
    if (name === '@/hooks/use-tela-pronta') return { useTelaPronta: () => true };
    if (name === '@/hooks/use-adaptive-window') return {
      useAdaptiveWindow: () => ({ width: 400, fontScale: 1, windowClass: 'compact' }),
    };
    if (name === '@/components/finance/month-picker') return { currentMonth: () => '2026-09' };
    if (name === '@/hooks/use-session') return { useSession: () => ({ session: null }) };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    if (name === '@/components/ui/toast') return { useToast: () => () => {} };
    // O provider de "esconder saldo" só existe na árvore real; aqui o valor aparece.
    if (name === '@/components/ui/conceal') return {
      useConceal: () => ({ concealed: false, toggle: () => {} }),
      concealText: () => '••••••',
      useBRL: () => (cents: number) => `R$ ${(cents / 100).toFixed(2)}`,
    };
    if (name === '@/components/ui/app-header') return { AppHeader: 'AppHeader', useAppHeaderHeight: () => 80 };
    if (name === '@/design/tokens') return { Space: {}, Radius: {}, tabular: {}, Motion: { duration: { base: 200 }, stagger: { step: 30, cap: 400 } } };
    // O Reanimated não roda fora do device; aqui só precisa que `Animated.View` seja um nó com
    // props, que é o que o `visit` do teste percorre.
    if (name === 'react-native-reanimated') {
      const anim = (n: string) => ({ duration: () => anim(n), delay: () => anim(n) });
      return {
        /*
          ⚠️ `__esModule: true` é obrigatório: sem ele o `__importDefault` do TS embrulha o dublê
          mais uma vez (`{ default: <tudo isto> }`), e `Animated.createAnimatedComponent` vira
          undefined — com a mensagem "is not a function", que parece dublê incompleto e não é.

          `createAnimatedComponent` devolve o NOME do componente embrulhado: o `visit` do teste
          procura por `type`, então a linha de conta continua sendo achada como 'Pressable'.
        */
        __esModule: true,
        default: { View: 'Animated.View', createAnimatedComponent: (c: string) => c },
        FadeInDown: anim('in'), FadeIn: anim('in'), FadeOut: anim('out'), LinearTransition: anim('layout'),
      };
    }
    if (name === '@/constants/theme') return { Fonts: {} };
    // O módulo REAL, não o Proxy: o fallback devolve uma string para cada chave, e a tela
    // chama `settleLabel(...)` — o que dava "is not a function" no minuto em que a Hoje
    // parou de cravar "Paguei". `settle-labels` é puro, então carregá-lo aqui é de graça e
    // faz o teste conferir o rótulo de verdade em vez de um dublê que sempre concorda.
    if (name === '@/lib/settle-labels') return settleLabels;
    // Mesmo motivo do `settle-labels` logo acima: `dates` é PURO, e o Proxy de fallback devolve
    // uma string por chave — `diasAte(...)` virava "is not a function" no minuto em que o herói
    // passou a calcular quantos dias faltam até a próxima entrada.
    if (name === '@/lib/dates') return dates;
    return new Proxy({}, { get: (_, key) => String(key) });
  } });
  const tree = module.exports.default();
  const nodes: any[] = [];
  const visit = (node: any) => { if (Array.isArray(node)) return node.forEach(visit); if (node && typeof node === 'object' && node.props) { nodes.push(node); visit(node.props.children); } };
  visit(tree);
  return { writes, routes, nodes };
}

test('Today routes an overdue invoice to invoice payment instead of writing its ID into transactions', () => {
  const { nodes, routes, writes } = renderToday({ kind: 'invoice', ref_id: 'invoice-1' });
  // A ação mora no card da agenda (`AgendaItem`), que a desenha como botão.
  const button = { props: nodes.find((n) => n.type === 'AgendaItem').props.action };
  button.props.onPress();
  assert.equal(writes.length, 0, 'an invoice UUID is not a transaction UUID');
  assert.equal(routes.length, 1);
  assert.equal((routes[0] as any).pathname, '/finance/invoice/[id]');
  assert.equal((routes[0] as any).params.id, 'invoice-1');
  assert.equal(button.props.label, 'Pagar fatura');
});

test('Today still marks a standalone transaction paid and exposes pull to refresh', () => {
  const { nodes, routes, writes } = renderToday({ kind: 'transaction', ref_id: 'transaction-1' });
  nodes.find((n) => n.type === 'AgendaItem').props.action.onPress();
  assert.equal(routes.length, 0);
  assert.equal((writes[0] as any[])[0].id, 'transaction-1');
  /*
    O pull-to-refresh mudou de dono: a Hoje deixou de montar o próprio `ScrollView` e passou a
    usar `<Screen>`, que é quem carrega o ritmo vertical do app inteiro. O que este teste protege
    continua sendo o mesmo — a tela EXPÕE atualizar puxando —, só que pelo prop do primitivo.
  */
  const screen = nodes.find((n) => n.type === 'Screen');
  assert.equal(typeof screen.props.onRefresh, 'function');
});

test('mark paid rejects a zero-row write instead of reporting success', async () => {
  const client = new QueryClient();
  const result = { data: null, error: null };
  const chain: any = { update: () => chain, eq: () => chain, select: () => chain, single: async () => result, then: (resolve: any) => Promise.resolve(result).then(resolve) };
  const hook = loadHooks(client, 'src/hooks/use-finance.ts', { '@/lib/supabase': { supabase: { from: () => chain } } }).useMarkPaid();
  try { await assert.rejects(hook.mutationFn({ id: 'missing', paidAt: '2026-09-08' })); }
  finally { client.clear(); }
});

/*
  ⚠️ **Chave de consulta nova que não entra em `FINANCE_KEYS` mostra dado velho até o app
  reiniciar — e isso já aconteceu TRÊS vezes.** As de ciclo faltaram (o comentário está no
  próprio `query-invalidation.ts`), `budgets-status` precisou de uma lista à parte
  (`REGUA_MUDOU`, em `finance.md`), e em 16/09/2026 foi `upcoming-card-charges`: editar a data de
  uma compra para anteontem gravou certo no banco e a Hoje continuou mostrando a compra em "Vai
  cair no cartão".

  O modo de falha é sempre o mesmo e nunca dá erro: a escrita funciona, a tela mente. Este teste
  lê as DUAS fontes — as chaves reais de `use-finance.ts` e a lista — e obriga cada ausência a
  ser uma decisão escrita, não um esquecimento.
*/
const FORA_DE_PROPOSITO: Record<string, string> = {
  // Histórico de alertas enviados: não deriva do ledger, tem vida própria no cron.
  'alerts-sent': 'não é derivada de lançamento',
  // O fluxo de importação é dono do próprio ciclo (lote → itens → conciliação) e invalida sozinho.
  'import-batches': 'o fluxo de importação invalida as próprias etapas',
  'import-batch': 'idem',
  'import-items': 'idem',
  'import-unmatched': 'idem',
  // Cadastro de gente, não de dinheiro.
  invites: 'não é financeira',
  'workspace-members': 'não é financeira',
  // Regras de categorização: mudam quando o usuário edita a regra, não quando lança.
  rules: 'muda com a regra, não com o lançamento',
  // O paywall tem caminho próprio: `invalidateAgentData` a inclui, e o gate lê do servidor.
  'plan-status': 'invalidada por `invalidateAgentData`',
  /*
    ⚠️ Estas duas são DISCUTÍVEIS e ficaram como estavam de propósito — mexer nelas é decisão de
    produto, não consequência de um teste novo. `categories-used` não vê uma categoria inédita até
    o refetch (o seletor mescla com as sugeridas, então o defeito é discreto), e `debt-payments` é
    derivada de `pay_debt_installment`. Quem for mexer, mexa sabendo.
  */
  'categories-used': 'discutível: categoria inédita só aparece no próximo refetch',
  'debt-payments': 'discutível: deriva de pagamento de dívida',
};

test('toda chave de consulta financeira está em FINANCE_KEYS, ou tem motivo escrito', async () => {
  const { readFileSync } = await import('node:fs');
  // O Próximo passo conta importações e compras parceladas: importar a fatura ou lançar a
  // parcelada tem que tirar o passo da Hoje (`import_batches` nem está no realtime).
  const hooks = ['src/hooks/use-finance.ts', 'src/hooks/use-proximo-passo.ts']
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  const invalidation = readFileSync('src/lib/query-invalidation.ts', 'utf8');

  const usadas = new Set([...hooks.matchAll(/queryKey: \['([a-z0-9-]+)'/g)].map((m) => m[1]));
  const bloco = invalidation.split('export const FINANCE_KEYS = [')[1].split('] as const;')[0];
  const listadas = new Set([...bloco.matchAll(/\['([a-z0-9-]+)'\]/g)].map((m) => m[1]));

  // O teste não pode passar por ler ZERO chave — foi assim que contagens já foram dadas por
  // zeradas sem estar (ver `anti-slop.test.ts`).
  assert.ok(usadas.size > 30, `esperava dezenas de chaves, li ${usadas.size}`);
  assert.ok(listadas.size > 30, `esperava dezenas em FINANCE_KEYS, li ${listadas.size}`);

  const esquecidas = [...usadas].filter((k) => !listadas.has(k) && !(k in FORA_DE_PROPOSITO));
  assert.deepEqual(
    esquecidas,
    [],
    `chave(s) de consulta fora de FINANCE_KEYS: ${esquecidas.join(', ')}. ` +
      'Uma escrita financeira não vai atualizar essa tela — acrescente à lista, ou declare o ' +
      'motivo em FORA_DE_PROPOSITO.'
  );

  // O outro lado: motivo escrito para uma chave que não existe mais é lixo que engana quem lê.
  const orfas = Object.keys(FORA_DE_PROPOSITO).filter((k) => !usadas.has(k));
  assert.deepEqual(orfas, [], `motivo escrito para chave inexistente: ${orfas.join(', ')}`);
});
