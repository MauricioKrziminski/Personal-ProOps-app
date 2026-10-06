import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createClient } from '@supabase/supabase-js';
import ts from 'typescript';

process.env.TZ = 'America/Sao_Paulo';

type Filters = Record<string, unknown>;
type Row = { id?: string; ref_id?: string; due_date?: string; [key: string]: unknown };
type Context = { pageParam?: number; signal?: AbortSignal };
type Query = {
  queryKey: unknown[];
  queryFn: (context: Context) => Promise<Row[]>;
  getNextPageParam?: (last: Row[], all: Row[][]) => number | undefined;
  placeholderData?: (previous: Row[] | undefined, query?: { queryKey: unknown[] }) => Row[] | undefined;
  enabled?: boolean;
};
type Request = { url: URL; body: Filters; signal?: AbortSignal | null };
type Reply = { data: unknown; status?: number };
type FinanceHooks = {
  useTransactions: (filters: Filters) => Query;
  useExpectedLedgerLines: (from: string | undefined, to: string | undefined, ready: boolean, recurringId?: string) => Query;
  useTransactionsSummary: (from: string | undefined, to: string | undefined, ready?: boolean) => Query;
  useAccounts: (selectedId?: string | null, includeArchived?: boolean) => Query;
  useImportBatches: (limit?: number, filters?: Filters) => Query;
};
const wire = (value: unknown) => JSON.parse(JSON.stringify(value));
const day = 86_400_000;
function days(from: string, to: string) {
  const dates: string[] = [];
  for (let time = Date.parse(`${from}T00:00:00Z`); time <= Date.parse(`${to}T00:00:00Z`); time += day)
    dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
}

/** Hooks + PostgREST reais; so o transporte e o ciclo React/Query sao substituidos. */
function harness(respond: (request: Request) => Reply | Promise<Reply> = () => ({ data: [] })) {
  const requests: Request[] = [];
  const supabase = createClient('https://finance-filters.test.supabase.co', 'test-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const request = { url: new URL(String(input)), body: init?.body ? JSON.parse(String(init.body)) : {}, signal: init?.signal };
      requests.push(request);
      const reply = await respond(request);
      return new Response(JSON.stringify(reply.data), {
        status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' },
      });
    } },
  });
  const cache = new Map<string, unknown>();
  function load(file: string): unknown {
    const path = resolve(file);
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} };
    cache.set(path, module.exports);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(code, {
      module, exports: module.exports, Date, Map, WeakMap, Set,
      require: (name: string) => {
        if (name === 'react') return { useEffect: () => {}, useCallback: (fn: unknown) => fn, useRef: (value: unknown) => ({ current: value }) };
        if (name === 'expo-router') return { useIsFocused: () => true };
        if (name === '@tanstack/react-query') return {
          useQueryClient: () => ({}), useQuery: (query: Query) => query, useInfiniteQuery: (query: Query) => query,
          keepPreviousData: (data: unknown) => data,
        };
        if (name === '@/lib/supabase') return { supabase };
        if (name === '@/lib/agent-api') return {};
        if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
        if (name.startsWith('.')) return load(resolve(path, '..', name));
        return {};
      },
    }, { filename: path });
    cache.set(path, module.exports);
    return module.exports;
  }
  return { requests, hooks: load('src/hooks/use-finance.ts') as FinanceHooks };
}

test('transactions combinam valor inclusivo, conta recebida e busca no servidor em todas as paginas', async () => {
  const h = harness((request) => ({ data: Array.from({ length: request.url.searchParams.get('offset') === '50' ? 1 : 50 },
    (_, i) => ({ id: `tx-${Number(request.url.searchParams.get('offset')) + i}` })) }));
  const filters = { from: '2026-12-31', to: '2027-01-01', minCents: 0, maxCents: 20000,
    kind: 'expense', category: 'casa', accountId: 'account-received', source: 'import', q: 'loja' };
  const query = h.hooks.useTransactions(filters);
  const first = await query.queryFn({ pageParam: 0 });
  const next = query.getNextPageParam!(first, [first]);
  assert.equal(next, 50);
  const second = await query.queryFn({ pageParam: next });
  assert.equal(second.length, 1);
  assert.equal(query.getNextPageParam!(second, [first, second]), undefined);
  assert.deepEqual(wire(query.queryKey), ['transactions', 'list', filters]);
  for (const { url } of h.requests) {
    const p = url.searchParams;
    assert.deepEqual(p.getAll('amount_cents'), ['gte.0', 'lte.20000']);
    assert.deepEqual(p.getAll('occurred_at'), ['gte.2026-12-31', 'lte.2027-01-01']);
    assert.equal(p.get('kind'), 'eq.expense');
    assert.equal(p.get('category'), 'eq.casa');
    assert.equal(p.get('source'), 'eq.import');
    assert.deepEqual(p.getAll('or'), ['(account_id.eq.account-received,counterparty_account_id.eq.account-received)',
      '(description.ilike.%loja%,merchant.ilike.%loja%,category.ilike.%loja%)']);
    assert.equal(p.get('order'), 'occurred_at.desc,created_at.desc,id.desc');
    assert.equal(p.get('limit'), '50');
  }
  assert.deepEqual(h.requests.map(r => r.url.searchParams.get('offset')), ['0', '50']);
});

test('transactions maximo zero e sem conta nao viram ausencia de filtro; limpar recorte retira limites', async () => {
  const h = harness();
  await h.hooks.useTransactions({ from: '2026-09-30', to: '2026-09-30', accountId: null, maxCents: 0 }).queryFn({ pageParam: 0 });
  assert.deepEqual(h.requests[0].url.searchParams.getAll('amount_cents'), ['lte.0']);
  assert.equal(h.requests[0].url.searchParams.get('account_id'), 'is.null');
  await h.hooks.useTransactions({ from: '2026-09-30', to: '2026-09-30' }).queryFn({ pageParam: 0 });
  assert.deepEqual(h.requests[1].url.searchParams.getAll('amount_cents'), []);
  assert.equal(h.requests[1].url.searchParams.get('account_id'), null);
});

test('transactions com uma borda mantêm o outro lado aberto em todas as páginas', async () => {
  for (const [filters, want] of [
    [{ from: '2026-09-01' }, ['gte.2026-09-01']],
    [{ to: '2026-09-30' }, ['lte.2026-09-30']],
  ] as [Filters, string[]][]) {
    const h = harness(() => ({ data: [] }));
    const query = h.hooks.useTransactions({ ...filters, kind: 'expense', pronto: true });
    await query.queryFn({ pageParam: 0 });
    await query.queryFn({ pageParam: 50 });
    for (const { url } of h.requests) {
      assert.deepEqual(url.searchParams.getAll('occurred_at'), want);
      assert.equal(url.searchParams.get('kind'), 'eq.expense');
      assert.equal(url.searchParams.get('order'), 'occurred_at.desc,created_at.desc,id.desc');
    }
    assert.deepEqual(h.requests.map(r => r.url.searchParams.get('offset')), ['0', '50']);
  }
});

test('previsões e resumo sem ambas as bordas não enviam RPC inválida, inclusive via refetch manual', async () => {
  const h = harness();
  for (const [from, to] of [['2026-09-01', undefined], [undefined, '2026-09-30']] as const) {
    for (const query of [h.hooks.useExpectedLedgerLines(from, to, true), h.hooks.useTransactionsSummary(from, to)]) {
      assert.equal(query.enabled, false);
      assert.deepEqual(wire(await query.queryFn({ signal: new AbortController().signal })), []);
    }
  }
  assert.deepEqual(h.requests, [], 'um refetch que ignora enabled também não pode enviar limites ausentes');
});

test('previsoes de janela longa repartem todos os dias em blocos disjuntos de ate 62 dias', async () => {
  const from = '2027-11-01'; const to = '2028-09-30';
  const h = harness(request => ({ data: days(String(request.body.p_from), String(request.body.p_to))
    .map((due_date, i) => ({ ref_id: 'series-one', due_date, origin: 'recurring', payment_method: i % 2 ? null : 'boleto' })) }));
  const query = h.hooks.useExpectedLedgerLines(from, to, true, 'series-one');
  const controller = new AbortController();
  const rows = await query.queryFn({ signal: controller.signal });
  assert.deepEqual(wire(rows.map(r => r.due_date)), days(from, to));
  assert.equal(new Set(rows.map(r => `${r.ref_id}:${r.due_date}`)).size, rows.length);
  assert.equal(rows[0].payment_method, 'boleto');
  assert.equal(rows[1].payment_method, null, 'metadata desconhecida não é inferida na leitura');
  assert.ok(h.requests.length > 4, 'janela deve exercitar mais de um lote paralelo');
  const windows = h.requests.map(r => r.body);
  assert.equal(windows[0].p_from, from);
  assert.equal(windows.at(-1)!.p_to, to);
  windows.forEach((window, i) => {
    assert.ok(days(String(window.p_from), String(window.p_to)).length <= 62);
    assert.equal(window.p_recurring_id, 'series-one');
    if (i) assert.equal(Date.parse(`${window.p_from}T00:00:00Z`) - Date.parse(`${windows[i - 1].p_to}T00:00:00Z`), day);
  });
  for (const request of h.requests) {
    assert.equal(request.signal, controller.signal);
    assert.equal(request.url.pathname, '/rest/v1/rpc/ledger_expected_lines_transfer');
    assert.equal(request.url.searchParams.get('order'), 'due_date.asc,origin.asc,ref_id.asc');
  }
  assert.equal(query.enabled, true);
  assert.equal(h.hooks.useExpectedLedgerLines(from, to, false).enabled, false);
});

test('previsoes com mais de 1000 linhas buscam paginas seguintes sem perda nem duplicacao', async () => {
  const h = harness(request => {
    const offset = Number(request.url.searchParams.get('offset'));
    return { data: Array.from({ length: offset === 0 ? 1000 : 207 }, (_, i) => ({ ref_id: `ref-${offset + i}`, due_date: '2026-09-30' })) };
  });
  const rows = await h.hooks.useExpectedLedgerLines('2026-09-30', '2026-09-30', true).queryFn({ signal: new AbortController().signal });
  assert.equal(rows.length, 1207);
  assert.equal(new Set(rows.map(r => r.ref_id)).size, 1207);
  assert.deepEqual(h.requests.map(r => r.url.searchParams.get('offset')), ['0', '1000']);
  assert.deepEqual(h.requests.map(r => r.url.searchParams.get('limit')), ['1000', '1000']);
  assert.deepEqual(h.requests[0].body, { p_from: '2026-09-30', p_to: '2026-09-30' });
  assert.deepEqual(h.requests[0].body, h.requests[1].body);
});

test('falha apos um lote de previsoes rejeita periodo completo e nao devolve resultado parcial', async () => {
  let calls = 0;
  const h = harness(request => ++calls === 5
    ? { data: { code: 'XX000', message: 'bloco indisponivel' }, status: 500 }
    : { data: [{ ref_id: 'partial', due_date: request.body.p_from }] });
  await assert.rejects(h.hooks.useExpectedLedgerLines('2026-01-01', '2027-12-31', true)
    .queryFn({ signal: new AbortController().signal }), error => Boolean(error && typeof error === 'object'
      && 'message' in error && error.message === 'bloco indisponivel'));
  assert.equal(h.requests.length, 8, 'falha no segundo lote nao devolve o primeiro nem inicia o terceiro');
});

test('cancelamento de previsoes chega ao fetch e rejeita consulta inteira', async () => {
  let started!: () => void;
  const start = new Promise<void>(resolveStart => { started = resolveStart; });
  let called = 0;
  const h = harness(request => new Promise<Reply>((_resolve, reject) => {
    request.signal?.addEventListener('abort', () => reject(new DOMException('Consulta cancelada', 'AbortError')), { once: true });
    if (++called === 4) started();
  }));
  const controller = new AbortController();
  const pending = h.hooks.useExpectedLedgerLines('2026-01-01', '2026-12-31', true).queryFn({ signal: controller.signal });
  await start;
  controller.abort();
  await assert.rejects(pending, error => Boolean(error && typeof error === 'object' && 'message' in error
    && String(error.message).includes('Consulta cancelada')));
  assert.equal(h.requests.length, 4);
  assert.ok(h.requests.every(request => request.signal === controller.signal && request.signal.aborted));
});

test('accounts paginam alem de 1000 e incluem apenas arquivada selecionada quando nao pedidas todas', async () => {
  const h = harness(request => {
    const offset = Number(request.url.searchParams.get('offset'));
    return { data: Array.from({ length: offset === 0 ? 1000 : 3 }, (_, i) => ({ id: `account-${offset + i}` })) };
  });
  const query = h.hooks.useAccounts('archived-selected');
  const rows = await query.queryFn({});
  assert.equal(rows.length, 1003);
  assert.equal(new Set(rows.map(r => r.id)).size, 1003);
  assert.deepEqual(wire(query.queryKey), ['accounts', 'archived-selected']);
  for (const request of h.requests) {
    assert.equal(request.url.searchParams.get('or'), '(archived.eq.false,id.eq.archived-selected)');
    assert.equal(request.url.searchParams.get('order'), 'created_at.asc,id.asc');
    assert.equal(request.url.searchParams.get('limit'), '1000');
  }
  assert.deepEqual(h.requests.map(r => r.url.searchParams.get('offset')), ['0', '1000']);
});

test('accounts distinguem lista ativa, conta selecionada e todas arquivadas na consulta/cache', async () => {
  const h = harness();
  const active = h.hooks.useAccounts();
  const all = h.hooks.useAccounts(undefined, true);
  await active.queryFn({});
  await all.queryFn({});
  assert.deepEqual(wire(active.queryKey), ['accounts']);
  assert.deepEqual(wire(all.queryKey), ['accounts', 'all']);
  assert.equal(h.requests[0].url.searchParams.get('archived'), 'eq.false');
  assert.equal(h.requests[1].url.searchParams.get('archived'), null);
  assert.equal(h.requests[1].url.searchParams.get('or'), null);
});

test('importacoes combinam datas locais, arquivo, conta e origem antes de limitar historico', async () => {
  const h = harness(request => ({ data: request.url.pathname.endsWith('/import_items')
    ? [{ batch_id: 'found-batch', status: 'approved' }, { batch_id: 'found-batch', status: 'pending' }]
    : [{ id: 'found-batch', filename: 'extrato.csv', account_id: 'card-selected', source: 'csv' }] }));
  const filters = { from: '2026-12-31', to: '2026-12-31', q: 'extrato', selections: { accountId: 'card-selected', source: 'csv' } };
  const rows = await h.hooks.useImportBatches(40, filters).queryFn({});
  const params = h.requests[0].url.searchParams;
  assert.deepEqual(params.getAll('created_at'), ['gte.2026-12-31T03:00:00.000Z', 'lt.2027-01-01T03:00:00.000Z']);
  assert.equal(params.get('filename'), 'ilike.%extrato%');
  assert.equal(params.get('account_id'), 'eq.card-selected');
  assert.equal(params.get('source'), 'eq.csv');
  assert.equal(params.get('limit'), '40');
  assert.equal(params.get('order')?.split(',')[0], 'created_at.desc');
  assert.equal(h.requests[1].url.pathname, '/rest/v1/import_items');
  assert.equal(h.requests[1].url.searchParams.get('batch_id'), 'in.(found-batch)');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total, 2);
  assert.equal(rows[0].aprovados, 1);
  assert.equal(rows[0].pendentes, 1);
});

test('importacoes com sem conta, OFX e datas abertas aplicam so as bordas escolhidas', async () => {
  const h = harness();
  await h.hooks.useImportBatches(20, { to: '2028-02-29', selections: { accountId: 'none', source: 'ofx' } }).queryFn({});
  const first = h.requests[0].url.searchParams;
  assert.deepEqual(first.getAll('created_at'), ['lt.2028-03-01T03:00:00.000Z']);
  assert.equal(first.get('account_id'), 'is.null');
  assert.equal(first.get('source'), 'eq.ofx');
  await h.hooks.useImportBatches(20, { from: '2028-02-29' }).queryFn({});
  assert.deepEqual(h.requests[1].url.searchParams.getAll('created_at'), ['gte.2028-02-29T03:00:00.000Z']);
  assert.equal(h.requests[1].url.searchParams.get('account_id'), null);
  assert.equal(h.requests[1].url.searchParams.get('source'), null);
  await h.hooks.useImportBatches().queryFn({});
  assert.deepEqual(h.requests[2].url.searchParams.getAll('created_at'), []);
});

test('importacoes conservam placeholder ao ver mais somente se o recorte anterior e igual', () => {
  const h = harness();
  const filters = { from: '2026-09-30', q: 'mercado', selections: { accountId: 'card-a', source: 'csv' } };
  const old = h.hooks.useImportBatches(20, filters);
  const more = h.hooks.useImportBatches(40, wire(filters));
  const changed = h.hooks.useImportBatches(40, { ...filters, selections: { ...filters.selections, accountId: 'card-b' } });
  const cleared = h.hooks.useImportBatches(40);
  const previous = [{ id: 'old-batch' }];
  assert.notDeepEqual(wire(old.queryKey), wire(more.queryKey), 'limite maior deve buscar dados novos');
  assert.notDeepEqual(wire(changed.queryKey), wire(more.queryKey), 'filtro precisa participar da chave');
  assert.equal(more.placeholderData?.(previous, { queryKey: old.queryKey }), previous);
  assert.equal(changed.placeholderData?.(previous, { queryKey: old.queryKey }), undefined,
    'trocar conta nao pode mostrar temporariamente importacoes da conta antiga');
  assert.equal(cleared.placeholderData?.(previous, { queryKey: old.queryKey }), undefined,
    'limpar recorte tambem nao conserva uma lista filtrada velha');
});

test('erro remoto de importacao rejeita consulta; retry preserva recorte completo', async () => {
  let fail = true;
  const h = harness(() => fail ? { data: { code: 'XX000', message: 'historico indisponivel' }, status: 500 } : { data: [] });
  const query = h.hooks.useImportBatches(20, { from: '2026-09-30', q: 'extrato', selections: { source: 'csv' } });
  await assert.rejects(query.queryFn({}), error => Boolean(error && typeof error === 'object'
    && 'message' in error && error.message === 'historico indisponivel'));
  fail = false;
  assert.deepEqual(wire(await query.queryFn({})), []);
  assert.equal(h.requests[0].url.search, h.requests[1].url.search);
});

test('transactions aplicam múltiplos meios e null antes de paginar, junto às outras condições OR', async () => {
  const dataset = Array.from({ length: 173 }, (_, i) => ({
    id: `tx-${i}`, payment_method: i % 3 === 0 ? 'pix' : i % 3 === 1 ? null : 'credit',
    account_id: 'sender', counterparty_account_id: 'received', occurred_at: '2026-12-31',
    created_at: '2026-12-31T00:00:00Z', amount_cents: 5000,
  }));
  const matching = dataset.filter(row => row.payment_method === 'pix' || row.payment_method === null);
  const h = harness(request => {
    const p = request.url.searchParams;
    assert.ok(p.getAll('or').includes('(payment_method.in.(pix),payment_method.is.null)'),
      'o servidor precisa receber o recorte antes de devolver qualquer página');
    const offset = Number(p.get('offset'));
    return { data: matching.slice(offset, offset + Number(p.get('limit'))) };
  });
  const input = Object.freeze({ from: '2026-12-31', to: '2027-01-01', paymentMethods: Object.freeze(['not_informed', 'pix', 'pix']),
    status: 'pending', accountId: 'received', source: 'import', recurringId: 'series', kind: 'income',
    q: 'loja', category: 'casa', minCents: 0, maxCents: 5000 });
  const query = h.hooks.useTransactions(input);
  const pages: Row[][] = [];
  let next: number | undefined = 0;
  while (next !== undefined) {
    const page = await query.queryFn({ pageParam: next });
    pages.push(page);
    next = query.getNextPageParam!(page, pages);
  }
  assert.deepEqual(wire(pages.flat()), matching);
  assert.equal(pages.flat().length, 116);
  assert.ok(pages.flat().some(row => row.id === 'tx-171'), 'linha além das primeiras 50 originais também chega');
  assert.deepEqual(h.requests.map(r => r.url.searchParams.get('offset')), ['0', '50', '100']);
  for (const { url } of h.requests) {
    const p = url.searchParams;
    const ors = p.getAll('or');
    assert.equal(ors.length, 4, 'status, pagamento, conta recebida e busca são grupos independentes em AND');
    assert.ok(ors.includes('(invoice_id.is.null,occurred_at.gt.' + new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + ')'));
    assert.ok(ors.includes('(account_id.eq.received,counterparty_account_id.eq.received)'));
    assert.ok(ors.includes('(description.ilike.%loja%,merchant.ilike.%loja%,category.ilike.%loja%)'));
    assert.deepEqual(p.getAll('occurred_at'), ['gte.2026-12-31', 'lte.2027-01-01']);
    assert.deepEqual(p.getAll('amount_cents'), ['gte.0', 'lte.5000']);
    assert.equal(p.get('category'), 'eq.casa');
    assert.equal(p.get('kind'), 'eq.income');
    assert.equal(p.get('source'), 'eq.import');
    assert.equal(p.get('status'), 'eq.pending');
    assert.equal(p.get('recurring_id'), 'eq.series');
    assert.equal(p.get('order'), 'occurred_at.desc,created_at.desc,id.desc');
    assert.equal(p.get('limit'), '50');
  }
  assert.deepEqual(input.paymentMethods, ['not_informed', 'pix', 'pix']);
});

test('transactions distinguem null exclusivo, vários conhecidos, vazio e todos os métodos', async () => {
  const h = harness();
  const cases: [unknown[] | undefined, string | null][] = [
    [['not_informed'], '(payment_method.is.null)'],
    [['boleto', 'pix'], '(payment_method.in.(pix,boleto))'],
    [[], null], [undefined, null],
    [['pix', 'credit', 'debit', 'cash', 'bank_transfer', 'boleto', 'not_informed'],
      '(payment_method.in.(pix,credit,debit,cash,bank_transfer,boleto),payment_method.is.null)'],
  ];
  for (const [paymentMethods, expression] of cases) {
    await h.hooks.useTransactions({ to: '2026-09-30', paymentMethods, accountId: null }).queryFn({ pageParam: 0 });
    const p = h.requests.at(-1)!.url.searchParams;
    assert.equal(p.get('or'), expression);
    assert.equal(p.get('account_id'), 'is.null');
    assert.deepEqual(p.getAll('occurred_at'), ['lte.2026-09-30']);
  }
});

test('transactions normalizam chave por métodos equivalentes e vazio sem alterar filtros antigos', () => {
  const h = harness();
  const base = { from: '2026-09-30', minCents: 0, pronto: false };
  const reordered = Object.freeze({ ...base, paymentMethods: Object.freeze(['boleto', 'pix', 'pix']) });
  const a = h.hooks.useTransactions(reordered);
  const b = h.hooks.useTransactions({ ...base, paymentMethods: ['pix', 'boleto'] });
  assert.deepEqual(wire(a.queryKey), wire(b.queryKey));
  assert.deepEqual(wire(a.queryKey), ['transactions', 'list', { ...base, paymentMethods: ['pix', 'boleto'] }]);
  assert.deepEqual(wire(h.hooks.useTransactions({ ...base, paymentMethods: [] }).queryKey),
    wire(h.hooks.useTransactions(base).queryKey));
  assert.deepEqual(wire(h.hooks.useTransactions({ ...base, paymentMethods: undefined }).queryKey),
    ['transactions', 'list', base]);
  assert.notDeepEqual(wire(a.queryKey), wire(h.hooks.useTransactions({ ...base, paymentMethods: ['not_informed'] }).queryKey));
  assert.deepEqual(reordered.paymentMethods, ['boleto', 'pix', 'pix']);
  assert.equal(a.enabled, false);
});

test('transactions recusam método inesperado antes de qualquer request', () => {
  const h = harness();
  for (const paymentMethods of [['pix', 'bad'], [null], ['pix),id.not.is.null']])
    assert.throws(() => h.hooks.useTransactions({ paymentMethods }), /forma de pagamento válida/i);
  assert.deepEqual(h.requests, []);
});

test('erro remoto de transactions mantém filtro de pagamento e data aberta no retry', async () => {
  let fail = true;
  const h = harness(() => fail ? { data: { code: 'XX000', message: 'pagamentos indisponíveis' }, status: 500 } : { data: [] });
  const query = h.hooks.useTransactions({ from: '2026-09-30', paymentMethods: ['boleto', 'not_informed'] });
  await assert.rejects(query.queryFn({ pageParam: 50 }), error => Boolean(error && typeof error === 'object'
    && 'message' in error && error.message === 'pagamentos indisponíveis'));
  fail = false;
  assert.deepEqual(wire(await query.queryFn({ pageParam: 50 })), []);
  assert.equal(h.requests[0].url.search, h.requests[1].url.search);
  assert.equal(h.requests[1].url.searchParams.get('or'), '(payment_method.in.(boleto),payment_method.is.null)');
  assert.deepEqual(h.requests[1].url.searchParams.getAll('occurred_at'), ['gte.2026-09-30']);
});
