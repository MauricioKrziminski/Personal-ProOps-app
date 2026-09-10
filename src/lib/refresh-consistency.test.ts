import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

import * as settleLabels from './settle-labels.ts';

const require = createRequire(import.meta.url);
function loadHooks(client: QueryClient, entry = 'src/hooks/use-finance.ts', dependencies: Record<string, unknown> = {}) {
  const load = (file: string): any => {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(code, { module, exports: module.exports, require: (name: string) => {
      if (name in dependencies) return dependencies[name];
      if (name === '@tanstack/react-query') return { ...require(name), useQueryClient: () => client, useMutation: (options: unknown) => options };
      if (name === 'react') return { useCallback: (fn: unknown) => fn };
      if (name === '@/lib/agent-api' || name === '@/lib/agent-chat') return {};
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
    'useApproveImportItems', 'useSaveDebt', 'usePayDebtInstallment', 'useArchiveDebt',
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
  const finance = { useCycle: () => ({ ...query, data: null }), useCashFlowForecast: () => query, useUpcomingBills: () => ({ ...query, data: [{ ...bill, title: 'Fatura teste', amount_cents: 147000, due_date: '2026-01-20', overdue: true }] }), useBudgetsStatus: () => query, useRecentTransactions: () => query, useMarkPaid: () => ({ mutate: (...args: unknown[]) => writes.push(args) }) };
  const code = ts.transpileModule(readFileSync('src/app/(tabs)/today/index.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { module, exports: module.exports, require: (name: string) => {
    if (name === 'react') return { useMemo: (fn: () => unknown) => fn(), useState: (value: unknown) => [value, () => {}] };
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return { Platform: { OS: 'android' }, StyleSheet: { create: (v: unknown) => v }, useWindowDimensions: () => ({ width: 400 }), View: 'View', ScrollView: 'ScrollView', RefreshControl: 'RefreshControl' };
    if (name === 'expo-router') return { router: { push: (route: unknown) => routes.push(route) } };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
    if (name === '@/hooks/use-finance') return finance;
    if (name === '@/hooks/use-items') return { useTodayReminders: () => query, localISODate: () => '2026-09-08', formatDateBR: (s: string) => s };
    if (name === '@/hooks/use-profile') return { useProfile: () => query };
    if (name === '@/hooks/use-session') return { useSession: () => ({ session: null }) };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    if (name === '@/components/ui/toast') return { useToast: () => () => {} };
    if (name === '@/components/ui/app-header') return { AppHeader: 'AppHeader', useAppHeaderHeight: () => 80 };
    if (name === '@/design/tokens') return { Space: {}, Radius: {}, tabular: {} };
    if (name === '@/constants/theme') return { Fonts: {} };
    // O módulo REAL, não o Proxy: o fallback devolve uma string para cada chave, e a tela
    // chama `settleLabel(...)` — o que dava "is not a function" no minuto em que a Hoje
    // parou de cravar "Paguei". `settle-labels` é puro, então carregá-lo aqui é de graça e
    // faz o teste conferir o rótulo de verdade em vez de um dublê que sempre concorda.
    if (name === '@/lib/settle-labels') return settleLabels;
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
  const button = nodes.find((n) => n.type === 'Button');
  button.props.onPress();
  assert.equal(writes.length, 0, 'an invoice UUID is not a transaction UUID');
  assert.equal(routes.length, 1);
  assert.equal((routes[0] as any).pathname, '/finance/invoice/[id]');
  assert.equal((routes[0] as any).params.id, 'invoice-1');
  assert.equal(button.props.label, 'Pagar fatura');
});

test('Today still marks a standalone transaction paid and exposes pull to refresh', () => {
  const { nodes, routes, writes } = renderToday({ kind: 'transaction', ref_id: 'transaction-1' });
  nodes.find((n) => n.type === 'Button').props.onPress();
  assert.equal(routes.length, 0);
  assert.equal((writes[0] as any[])[0].id, 'transaction-1');
  const scroll = nodes.find((n) => n.type === 'ScrollView');
  assert.equal(typeof scroll.props.refreshControl.props.onRefresh, 'function');
});

test('mark paid rejects a zero-row write instead of reporting success', async () => {
  const client = new QueryClient();
  const result = { data: null, error: null };
  const chain: any = { update: () => chain, eq: () => chain, select: () => chain, single: async () => result, then: (resolve: any) => Promise.resolve(result).then(resolve) };
  const hook = loadHooks(client, 'src/hooks/use-finance.ts', { '@/lib/supabase': { supabase: { from: () => chain } } }).useMarkPaid();
  try { await assert.rejects(hook.mutationFn({ id: 'missing', paidAt: '2026-09-08' })); }
  finally { client.clear(); }
});
