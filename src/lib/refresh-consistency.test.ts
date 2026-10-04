import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

import * as settleLabels from './settle-labels.ts';
import * as dates from './dates.ts';
import * as todaySections from './today-sections.ts';
import * as aosPoucos from './aos-poucos.ts';
import * as budgetTight from './budget-tight.ts';
import * as accountCash from './account-cash.ts';
import * as todaySpend from './today-spend.ts';
import * as activityFeed from './activity-feed.ts';
import * as widgetSnapshot from './widget-snapshot.ts';

const require = createRequire(import.meta.url);
function loadHooks(client: QueryClient, entry = 'src/hooks/use-finance.ts', dependencies: Record<string, unknown> = {}) {
  // All modules share one JS realm, as they do in Metro. SQL inputs are plain data in that realm.
  const context = createContext({ console, setTimeout, clearTimeout });
  const copyInput = runInContext(`(function copy(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(copy);
    const result = {};
    for (const key of Object.keys(value)) result[key] = copy(value[key]);
    return result;
  })`, context);
  const load = (file: string): any => {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const evaluate = runInContext(`(function(require, module, exports) { ${code}\n})`, context);
    evaluate((name: string) => {
      if (name in dependencies) return dependencies[name];
      if (name === '@tanstack/react-query') return { ...require(name), useQueryClient: () => client,
        useMutation: (options: any) => ({ ...options, mutationFn: (input: unknown) => options.mutationFn(copyInput(input)) }) };
      if (name === 'react') return { useCallback: (fn: unknown) => fn, useRef: (value: unknown) => ({ current: value }) };
      if (name === '@/lib/agent-api') return {};
      if (name === '@/lib/supabase') return { supabase: { rpc: async () => ({ error: null }) } };
      if (name.startsWith('@/lib/') && existsSync(`src/lib/${name.slice(6)}.ts`)) return load(`src/lib/${name.slice(6)}.ts`);
      // `import` relativo de dentro de `src/lib` (`./dates.ts`): sem isto o módulo carregado recebe
      // `{}` e quebra quando usa o helper na carga (`serie.ts` monta `SERIE_VAZIA` com a data).
      if (name.startsWith('./') && file.startsWith('src/lib/') && existsSync(`src/lib/${name.slice(2)}`)) return load(`src/lib/${name.slice(2)}`);
      return {};
    }, module, module.exports);
    return module.exports;
  };
  return load(entry);
}

test('F06: padrões de categoria leem todas as páginas do workspace e não aceitam leitura incompleta', async () => {
  const client = new QueryClient();
  const ranges: number[][] = [];
  const scopes: string[] = [];
  let truncated = false;
  const hook = loadHooks(client, 'src/hooks/use-finance.ts', {
    '@tanstack/react-query': { useQuery: (options: any) => options },
    '@/hooks/use-items': { useRealtimeInvalidate: () => undefined },
    '@/lib/supabase': { supabase: { from: (table: string) => {
      assert.equal(table, 'categories');
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => { assert.equal(column, 'workspace_id'); scopes.push(value); return builder; },
        order: () => builder,
        range: async (from: number, to: number) => {
          ranges.push([from, to]);
          return { data: Array.from({ length: truncated || from === 0 ? 1000 : 1 }, (_, i) => ({
            name: `categoria-${from + i}`, default_expense_pattern: 'fixed', default_expense_necessity: null,
          })), error: null };
        },
      };
      return builder;
    } } },
  }).useCategoryClassificationDefaults('workspace-do-registro');
  try {
    const rows = await hook.queryFn();
    assert.equal(rows.length, 1001);
    assert.equal(rows[1000].category, 'categoria-1000');
    assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
    assert.equal(scopes.every(value => value === 'workspace-do-registro'), true);
    truncated = true;
    await assert.rejects(hook.queryFn(), /Leitura truncada/);
  } finally { client.clear(); }
});

test('F06: edição de parcela exige as duas revisões e envia snapshot no comando idempotente', async () => {
  const client = new QueryClient();
  const calls: any[] = [];
  const mutation = loadHooks(client, 'src/hooks/use-finance.ts', {
    '@/lib/supabase': { supabase: { rpc: async (name: string, args: any) => {
      calls.push({ name, args }); return { data: 2, error: null };
    } } },
  }).useSaveInstallmentOccurrence();
  const patch = { expense_pattern: null, expense_pattern_source: 'explicit' };
  try {
    await assert.rejects(mutation.mutationFn({ id: 'part', scope: 'future', patch }), /versão|revisão/i);
    assert.equal(calls.length, 0);
    const input = { id: 'part', scope: 'future', patch, expectedPlanRevision: 8,
      expectedAnchorRevision: 3, requestId: 'intent-1', lastDay: true };
    assert.equal(await mutation.mutationFn(input), 2);
    await mutation.mutationFn(input);
    assert.equal(calls[0].name, 'update_installment_scope_checked');
    assert.equal(calls[0].args.p_expected_plan_revision, 8);
    assert.equal(calls[0].args.p_expected_anchor_revision, 3);
    assert.equal(calls[0].args.p_last_day, true);
    assert.equal(calls[0].args.p_request_id, calls[1].args.p_request_id);
    assert.equal(calls[0].args.p_patch.expense_pattern_source, 'explicit');
    assert.equal('expense_necessity' in calls[0].args.p_patch, false);
  } finally { client.clear(); }
});

test('F06: categoria salva configuração, rename e período numa única RPC e devolve contagem real', async () => {
  const client = new QueryClient();
  const calls: any[] = [];
  const mutation = loadHooks(client, 'src/hooks/use-finance.ts', {
    '@/lib/supabase': { supabase: { rpc: async (name: string, args: any) => {
      calls.push({ name, args }); return { data: { category: 'casa', backfill_updated: 4, juntou: false }, error: null };
    } } },
  }).useSalvarCategoria();
  try {
    const result = await mutation.mutationFn({ name: ' Casa ', icon: 'house', color: null,
      renomearDe: 'moradia', configurationId: 'cat', expectedRevision: 7,
      default_expense_pattern: 'fixed', default_expense_necessity: null,
      backfill: { from: '2026-09-01', to: '2026-09-30' }, requestId: 'intent-cat' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'save_category_configuration');
    assert.equal(calls[0].args.p_request_id, 'intent-cat');
    assert.equal(calls[0].args.p_input.name, 'casa');
    assert.equal(calls[0].args.p_input.rename_from, 'moradia');
    assert.equal(calls[0].args.p_input.category_id, 'cat');
    assert.equal(calls[0].args.p_input.expected_revision, 7);
    assert.equal(calls[0].args.p_input.default_expense_necessity, null);
    assert.equal(calls[0].args.p_input.backfill_to, '2026-09-30');
    assert.equal(result.backfill_updated, 4);
  } finally { client.clear(); }
});

test('F06: edição estrutural de compra não perde patch parcial nem muda nonce no retry', async () => {
  const client = new QueryClient();
  const calls: any[] = [];
  let sequence = 0;
  const mutation = loadHooks(client, 'src/hooks/use-finance.ts', {
    '@/lib/agent-chat': { newClientMessageId: () => `request-${++sequence}` },
    '@/lib/supabase': { supabase: { rpc: async (name: string, args: any) => {
      calls.push({ name, args }); return { data: 3, error: null };
    } } },
  }).useUpdateInstallmentPlan();
  const input = { planId: 'plan', totalCents: 30000, installments: 3, firstOccurredAt: '2026-10-03',
    description: 'Compra', category: 'casa', merchant: null, accountId: 'bank', expectedRevision: 2,
    expense_necessity: 'essential', expense_necessity_source: 'explicit' };
  try {
    await mutation.mutationFn(input); await mutation.mutationFn(input);
    assert.equal(calls[0].args.p_input.expense_necessity, 'essential');
    assert.equal('expense_pattern' in calls[0].args.p_input, false);
    assert.equal(calls[0].args.p_input.p_request_id, calls[1].args.p_input.p_request_id);
    await mutation.mutationFn({ ...input, expense_necessity: null });
    assert.notEqual(calls[1].args.p_input.p_request_id, calls[2].args.p_input.p_request_id);
  } finally { client.clear(); }
});

test('F01: compra e taxa usam uma RPC atômica; perda da resposta repete a mesma intenção', async () => {
  const client = new QueryClient();
  const calls: any[] = [];
  let sequence = 0;
  const mutation = loadHooks(client, 'src/hooks/use-finance.ts', {
    '@/lib/agent-chat': { newClientMessageId: () => `request-${++sequence}` },
    '@/lib/supabase': { supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
      from: () => ({ insert: async () => ({ error: null }) }),
      rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      return calls.length === 1 ? { error: new Error('response lost') } : { data: { id: 'tx-1', revision: 1, fee_id: 'fee-1' }, error: null };
    } } },
  }).useSaveTransaction();
  const input = { kind: 'expense', amount_cents: 10000, category: 'mercado', description: 'Mercado',
    account_id: 'card', counterparty_account_id: null, occurred_at: '2026-10-02', payment_method: 'pix', fee_cents: 500 };
  try {
    await assert.rejects(mutation.mutationFn(input), /response lost/);
    const result = await mutation.mutationFn(input);
    assert.equal(result.id, 'tx-1');
    assert.equal(calls[0].name, 'save_transaction_payment');
    assert.equal(calls[0].args.p_input.payment_method, 'pix');
    assert.equal(calls[0].args.p_fee_cents, 500);
    assert.equal(calls[0].args.p_request_id, calls[1].args.p_request_id);
    await mutation.mutationFn({ ...input, fee_cents: 600 });
    assert.notEqual(calls[1].args.p_request_id, calls[2].args.p_request_id);
  } finally { client.clear(); }
});

test('F01: edição envia a revisão lida e distingue método omitido de limpeza explícita', async () => {
  const client = new QueryClient();
  const calls: any[] = [];
  const mutation = loadHooks(client, 'src/hooks/use-finance.ts', {
    '@/lib/agent-chat': { newClientMessageId: () => `request-${calls.length}` },
    '@/lib/supabase': { supabase: {
      from: () => ({ update: () => ({ eq: () => ({ select: () => ({ single: async () => ({ error: null }) }) }) }) }),
      rpc: async (name: string, args: any) => {
      calls.push({ name, args }); return { data: { id: 'tx-1', revision: 8, fee_id: null }, error: null };
    } } },
  }).useSaveTransaction();
  const input = { id: 'tx-1', expectedRevision: 7, kind: 'income', amount_cents: 10000, category: null,
    description: 'Freela', account_id: 'bank', counterparty_account_id: null, occurred_at: '2026-10-02' };
  try {
    await mutation.mutationFn(input);
    await mutation.mutationFn({ ...input, payment_method: null });
    assert.equal(calls.length, 2, 'cada intenção é enviada à operação atômica');
    assert.equal(calls[0].args.p_expected_revision, 7);
    assert.equal('payment_method' in calls[0].args.p_input, false);
    assert.equal(calls[1].args.p_input.payment_method, null);
    assert.equal(calls[0].args.p_fee_cents, null, 'campo omitido preserva taxa vinculada');
    assert.equal('expectedRevision' in calls[0].args.p_input, false);
  } finally { client.clear(); }
});

test('F01: editar compra inteira envia forma e revisão e reutiliza a intenção no retry', async () => {
  const client = new QueryClient();
  const calls: any[] = [];
  let sequence = 0;
  const mutation = loadHooks(client, 'src/hooks/use-finance.ts', {
    '@/lib/agent-chat': { newClientMessageId: () => `request-${++sequence}` },
    '@/lib/supabase': { supabase: { rpc: async (name: string, args: any) => {
      calls.push({ name, args }); return calls.length === 1 ? { error: new Error('lost') } : { data: 3, error: null };
    } } },
  }).useUpdateInstallmentPlan();
  const input = { planId: 'plan-1', totalCents: 10000, installments: 3, firstOccurredAt: '2026-10-02',
    description: 'Compra', category: null, merchant: null, accountId: 'card', paymentMethod: 'credit', expectedRevision: 4 };
  try {
    await assert.rejects(mutation.mutationFn(input), /lost/);
    await mutation.mutationFn(input);
    assert.equal(calls[0].name, 'update_installment_plan_payment');
    assert.equal(calls[0].args.p_input.p_payment_method, 'credit');
    assert.equal(calls[0].args.p_input.p_expected_revision, 4);
    assert.equal(calls[0].args.p_input.p_request_id, calls[1].args.p_input.p_request_id);
    await mutation.mutationFn({ ...input, paymentMethod: null });
    assert.equal(calls[2].args.p_input.p_payment_method, null);
    assert.notEqual(calls[1].args.p_input.p_request_id, calls[2].args.p_input.p_request_id);
  } finally { client.clear(); }
});

test('F01: duplicar deliberadamente depois do sucesso cria uma nova intenção', async () => {
  const client = new QueryClient();
  const requests: string[] = [];
  let sequence = 0;
  const mutation = loadHooks(client, 'src/hooks/use-finance.ts', {
    '@/lib/agent-chat': { newClientMessageId: () => `request-${++sequence}` },
    '@/lib/supabase': { supabase: { rpc: async (_name: string, args: any) => {
      requests.push(args.p_request_id); return { data: { id: `tx-${requests.length}`, revision: 0, fee_id: null }, error: null };
    } } },
  }).useSaveTransaction();
  const input = { kind: 'expense', amount_cents: 10000, category: null, description: 'Mercado',
    account_id: 'bank', counterparty_account_id: null, occurred_at: '2026-10-02', payment_method: 'pix' };
  try {
    await mutation.mutationFn(input);
    await mutation.mutationFn(input);
    assert.notEqual(requests[0], requests[1], 'um novo toque após confirmação é uma nova criação');
  } finally { client.clear(); }
});

test('F01: criação recorrente repete a intenção após perder resposta e renova após confirmação', async () => {
  const client = new QueryClient();
  const calls: any[] = [];
  let sequence = 0;
  const mutation = loadHooks(client, 'src/hooks/use-finance.ts', {
    '@/lib/agent-chat': { newClientMessageId: () => `request-${++sequence}` },
    '@/lib/supabase': { supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
      from: () => ({ insert: async (args: any) => {
        calls.push({ name: 'insert', args });
        return calls.length === 1 ? { error: new Error('response lost') } : { error: null };
      } }),
      rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      return calls.length === 1 ? { error: new Error('response lost') } : { data: { id: 'rec-1', revision: 0 }, error: null };
    } } },
  }).useCreateRecurring();
  const input = { kind: 'expense', amount_cents: 10000, category: null, description: 'Internet',
    account_id: 'bank', start_date: '2026-10-02', rrule: 'FREQ=MONTHLY;BYMONTHDAY=2', payment_method: 'boleto', auto_confirm: false };
  try {
    await assert.rejects(mutation.mutationFn(input), /response lost/);
    await mutation.mutationFn(input);
    assert.equal(calls[0].name, 'create_recurring_payment');
    assert.equal(calls[0].args.p_input.payment_method, 'boleto');
    assert.equal(calls[0].args.p_request_id, calls[1].args.p_request_id);
    await mutation.mutationFn(input);
    assert.notEqual(calls[1].args.p_request_id, calls[2].args.p_request_id);
  } finally { client.clear(); }
});

test('F01: editar juros consulta somente o vínculo explícito, mesmo com mesma conta e data', async () => {
  const client = new QueryClient();
  const filters: any[] = [];
  const query = loadHooks(client, 'src/hooks/use-finance.ts', {
    '@tanstack/react-query': { useQuery: (options: any) => options },
    '@/lib/supabase': { supabase: { from: () => ({ select: () => ({
      eq: (name: string, value: unknown) => { filters.push([name, value]); return { maybeSingle: async () => ({ data: { id: 'fee-2', amount_cents: 500 }, error: null }) }; },
    }) }) } },
  }).useJurosDoPix({ id: 'purchase-2', invoice_id: 'invoice-1', kind: 'transfer', description: 'Pix', account_id: 'card', occurred_at: '2026-10-02' });
  try {
    assert.equal(query.enabled, true);
    const result = await query.queryFn();
    assert.equal(result.id, 'fee-2');
    assert.deepEqual(filters, [['pix_fee_for_transaction_id', 'purchase-2']]);
  } finally { client.clear(); }
});

test('F01: título de juros no pai não impede carregar sua taxa vinculada; filho explícito não procura outra taxa', async () => {
  const client = new QueryClient();
  const filters: any[] = [];
  const hooks = loadHooks(client, 'src/hooks/use-finance.ts', {
    '@tanstack/react-query': { useQuery: (options: any) => options },
    '@/lib/supabase': { supabase: { from: () => ({ select: () => ({
      eq: (name: string, value: unknown) => { filters.push([name, value]); return { maybeSingle: async () => ({ data: { id: 'fee-linked', amount_cents: 500 }, error: null }) }; },
    }) }) } },
  });
  const parent = { id: 'purchase-renamed', invoice_id: 'invoice-1', kind: 'expense',
    description: 'Juros do Pix no crédito', account_id: 'card', occurred_at: '2026-10-02',
    payment_method: 'pix', pix_fee_for_transaction_id: null };
  try {
    const query = hooks.useJurosDoPix(parent);
    assert.equal(query.enabled, true, 'título editável não é identidade da linha filha');
    const fee = await query.queryFn();
    assert.equal(fee.amount_cents, 500, 'a taxa existente precisa chegar ao formulário ao reabrir');
    assert.deepEqual(filters, [['pix_fee_for_transaction_id', parent.id]]);
  } finally { client.clear(); }
});

test('F01: linha filha de juros com título alterado não consulta como compra pai', () => {
  const client = new QueryClient();
  try {
    const hooks = loadHooks(client, 'src/hooks/use-finance.ts', {
      '@tanstack/react-query': { useQuery: (options: any) => options },
    });
    const query = hooks.useJurosDoPix({ id: 'fee-linked', invoice_id: 'invoice-1', kind: 'expense',
      description: 'Taxa renomeada', pix_fee_for_transaction_id: 'purchase-renamed' });
    assert.equal(query.enabled, false, 'o vínculo explícito identifica a filha mesmo sem o título padrão');
  } finally { client.clear(); }
});

test('conversion retries after a committed response is lost reuse the request and result', async () => {
  const client = new QueryClient();
  const committed = new Map<string, { ids: string[] }>();
  const calls: any[] = [];
  let sequence = 0;
  let responseLost = true;
  const mutation = loadHooks(client, 'src/hooks/use-finance.ts', {
    '@/lib/agent-chat': { newClientMessageId: () => `request-${++sequence}` },
    '@/lib/supabase': { supabase: { rpc: async (name: string, args: any) => {
      assert.equal(name, 'converter_registro'); calls.push(args);
      const key = args.p_request_id ?? `unkeyed-${calls.length}`;
      if (!committed.has(key)) committed.set(key, { ids: [`record-${committed.size + 1}`] });
      if (responseLost) { responseLost = false; return { error: new Error('response lost after commit') }; }
      return { data: committed.get(key), error: null };
    } } },
  }).useConverterRegistro();
  const intent = { origem: { tipo: 'financiamento', id: 'debt-1' }, alcance: 'todas',
    destino: { tipo: 'recorrente', dados: { amount_cents: 100, down_payment: { amount_cents: 200, account_id: 'account-1', occurred_at: '2026-10-01' } } } };
  try {
    await assert.rejects(mutation.mutationFn(intent), /response lost/);
    const recovered = await mutation.mutationFn(intent);
    assert.deepEqual(JSON.parse(JSON.stringify(recovered)), { ids: ['record-1'] });
    assert.equal(committed.size, 1, 'retry cannot create a second destination');
    assert.equal(typeof calls[0].p_request_id, 'string');
    assert.equal(calls[0].p_request_id, calls[1].p_request_id);
    assert.equal(sequence, 1);
  } finally { client.clear(); }
});

test('conversion shares concurrent identical intent but changes request for a new scope or entry', async () => {
  const client = new QueryClient();
  const calls: any[] = [];
  let sequence = 0;
  const mutation = loadHooks(client, 'src/hooks/use-finance.ts', {
    '@/lib/agent-chat': { newClientMessageId: () => `request-${++sequence}` },
    '@/lib/supabase': { supabase: { rpc: async (_name: string, args: any) => { calls.push(args); return { data: { ids: ['created'] }, error: null }; } } },
  }).useConverterRegistro();
  const intent = { origem: { tipo: 'financiamento', id: 'debt-1' }, alcance: 'desta_em_diante',
    destino: { tipo: 'parcelada', dados: { down_payment: { amount_cents: 200 } } } };
  try {
    await Promise.all([mutation.mutationFn(intent), mutation.mutationFn(intent)]);
    await mutation.mutationFn({ ...intent, alcance: 'manter' });
    await mutation.mutationFn({ ...intent, destino: { ...intent.destino, dados: { down_payment: { amount_cents: 300 } } } });
    assert.equal(typeof calls[0].p_request_id, 'string');
    assert.equal(calls[0].p_request_id, calls[1].p_request_id);
    assert.notEqual(calls[0].p_request_id, calls[2].p_request_id);
    assert.notEqual(calls[2].p_request_id, calls[3].p_request_id);
    assert.equal(sequence, 3);
  } finally { client.clear(); }
});

test('converting a transaction to installments with an entry also keys response-loss retries', async () => {
  const client = new QueryClient();
  const calls: any[] = [];
  let sequence = 0;
  const mutation = loadHooks(client, 'src/hooks/use-finance.ts', {
    '@/lib/agent-chat': { newClientMessageId: () => `request-${++sequence}` },
    '@/lib/supabase': { supabase: { rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      return calls.length === 1 ? { error: new Error('lost') } : { data: { ids: ['plan-1'] }, error: null };
    } } },
  }).useConvertToInstallments();
  const input = { transactionId: 'transaction-1', totalCents: 10000, installments: 5, firstOccurredAt: '2026-10-01',
    description: 'Compra', category: null, merchant: null, accountId: 'account-1',
    downPayment: { amount_cents: 1000, account_id: 'account-2', occurred_at: '2026-10-01' } };
  try {
    await assert.rejects(mutation.mutationFn(input), /lost/);
    await mutation.mutationFn(input);
    assert.equal(calls[0].name, 'converter_registro');
    assert.equal(typeof calls[0].args.p_request_id, 'string');
    assert.equal(calls[0].args.p_request_id, calls[1].args.p_request_id);
    assert.equal(sequence, 1);
    await mutation.mutationFn({ ...input, downPayment: { ...input.downPayment, amount_cents: 1500 } });
    assert.notEqual(calls[1].args.p_request_id, calls[2].args.p_request_id);
    await mutation.mutationFn({ ...input, downPayment: undefined });
    assert.equal(calls[3].name, 'convert_transaction_to_installments');
  } finally { client.clear(); }
});

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

for (const terminal of ['save', 'resolved-save', 'resolved-cancellation'] as const) {
  test(`F09: ${terminal} refreshes mounted category counts without realtime`, async () => {
    const client = new QueryClient();
    const workspace = '11111111-1111-4111-8111-111111111111';
    const child = '33333333-3333-4333-8333-333333333333';
    const before = [{ category: 'mercado', uses: 3 }, { category: 'casa', uses: 21 }];
    const after = [{ category: 'mercado', uses: 1 }, { category: 'casa', uses: 23 }];
    let rows = before;
    let reads = 0;
    let categoryInvalidations = 0;
    const originalInvalidate = client.invalidateQueries.bind(client);
    client.invalidateQueries = ((filters: any) => {
      if (filters.queryKey[0] === 'categories-used') categoryInvalidations++;
      return originalInvalidate(filters);
    }) as typeof client.invalidateQueries;
    const query = loadHooks(client, 'src/hooks/use-finance.ts', {
      '@tanstack/react-query': { useQuery: (options: any) => options },
      '@/hooks/use-items': { useRealtimeInvalidate: () => undefined },
      '@/lib/supabase': { supabase: { rpc: async () => { reads++; return { data: rows, error: null }; } } },
    }).useCategoriesUsed();
    const initial = await query.queryFn();
    client.setQueryData(query.queryKey, initial);
    reads = 0;
    const observer = new QueryObserver(client, query);
    const unsubscribe = observer.subscribe(() => {});
    const hooks = loadHooks(client, 'src/hooks/use-subcategories.ts', {
      react: { useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, () => undefined] },
      '@tanstack/react-query': {
        useQueryClient: () => client,
        useMutation: (options: any) => ({ ...options, mutateAsync: async (input: any) => {
          let result;
          try { result = await options.mutationFn(input); }
          catch (error) { await options.onError(error); throw error; }
          await options.onSuccess(result);
          return result;
        } }),
      },
      '@/lib/agent-chat': { newClientMessageId: () => '55555555-5555-4555-8555-555555555555' },
      '@/lib/supabase': { supabase: { rpc: async (name: string) => {
        if (name === 'write_subcategory' && terminal !== 'save') return { data: null, error: new Error('lost response') };
        rows = after;
        return { error: null, data: terminal === 'resolved-cancellation'
          ? { workspace_id: workspace, cancelled: true }
          : { workspace_id: workspace, subcategory_id: child, edit_revision: 8,
            merged: false, deleted: false, affected_records: 2 } };
      } } },
    });
    try {
      const mutation = hooks.useWriteSubcategory();
      const input = { action: 'save', workspace_id: workspace, subcategory_id: child, expected_revision: 7,
        parent_category: 'casa', name: 'feira', merge_into_id: null, expected_merge_revision: null };
      if (terminal === 'save') await mutation.mutateAsync(input);
      else {
        await assert.rejects(mutation.mutateAsync(input), /lost response/);
        assert.equal(reads, 0, 'an ambiguous write must not claim fresh counts');
        assert.equal(categoryInvalidations, 0);
        if (terminal === 'resolved-cancellation') await assert.rejects(mutation.resolveAsync(), { name: 'SubcategoryAttemptCancelledError' });
        else await mutation.resolveAsync();
      }
      assert.equal(reads, 1, 'the mounted categories query must refetch before mutation settles');
      assert.equal(categoryInvalidations, 1, 'one confirmation must invalidate the category key once');
      assert.deepEqual(Array.from(client.getQueryData<any[]>(query.queryKey)!, row => [row.category, row.uses]),
        [['mercado', 1], ['casa', 23]]);
    } finally { unsubscribe(); client.clear(); }
  });
}

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
  const finance = { useCycle: () => ({ ...query, data: null }), useCycleMonth: () => '2026-01', useSpendable: () => ({ ...query, data: { caixa: 72, comprometido_ate_entrada: 0, comprometido_no_ciclo: 832663, a_receber_no_ciclo: 756652, proxima_entrada: '2026-01-20' } }), useCashFlowForecast: () => query, useCycleSeries: () => ({ ...query, data: [] }), useAccountBalances: () => ({ ...query, data: [] }), useUpcomingBills: () => ({ ...query, data: [{ ...bill, title: 'Fatura teste', amount_cents: 147000, due_date: '2026-01-20', overdue: true }] }), useUpcomingCardCharges: () => ({ ...query, data: [] }), useTransactionsSummary: () => ({ ...query, data: [] }), useDailySpending: () => ({ ...query, data: [] }), useBudgetsStatus: () => query, useRecentTransactions: () => query, useMarkPaid: () => ({ mutate: (...args: unknown[]) => writes.push(args) }) };
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
    // A janela de "ver mais" é estado de tela; aqui interessa a ação, então a lista vem inteira.
    if (name === '@/hooks/use-aos-poucos') return {
      useAosPoucos: (itens: unknown[]) => ({ visiveis: itens, restantes: 0, proximos: 0, verMais: () => {} }),
      useJanelasPorGrupo: () => ({ janelaDe: (_g: string, itens: unknown[]) => ({ visiveis: itens, restantes: 0, proximos: 0 }), verMais: () => {} }),
    };
    if (name === '@/hooks/use-bool-pref') return { useBoolPref: () => [false, () => {}] };
    if (name === '@/hooks/use-agora') return { useAgora: () => new Date(2026, 8, 8, 12, 0).getTime() };
    if (name === '@/hooks/use-notes') return { useNotesList: () => ({ ...query, data: { pages: [[]] } }), useNoteFolders: () => query };
    if (name === '@/hooks/use-agent-activity') return { useAgentActivity: () => query };
    // "Paguei" abre a confirmação do valor (25/09/2026): o que importa aqui é QUAL id ela abre.
    if (name === '@/components/finance/confirmar-baixa') return { useConfirmarBaixa: () => ({ abrir: (id: string) => writes.push([{ id }]), folha: null }) };
    // Puros, carregados de verdade pelo mesmo motivo de `dates` e `settle-labels` (abaixo).
    if (name === '@/lib/today-sections') return todaySections;
    // `PASSO` é a janela do atrasado: pelo Proxy ele viraria a string 'PASSO' e a lista, vazia.
    if (name === '@/lib/aos-poucos') return aosPoucos;
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

test('Today opens the pay confirmation for the standalone transaction and exposes pull to refresh', () => {
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
  // As ocorrências das hipóteses do rascunho no ciclo: aritmética do rascunho, não lê lançamento.
  'draft-lines': 'não lê lançamento, só o rascunho',
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
  // Pagamentos de dívida derivam de `pay_debt_installment`.
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

test('a simulação é marcada velha na escrita, mas NÃO recalcula ali (o rascunho ainda tem a hipótese aplicada)', async () => {
  // 29/09/2026: ao Aplicar, a invalidação refazia `simular` com a hipótese ainda no rascunho E já
  // gravada de verdade — o número contado duas vezes aparecia por ~2 s. Ela recalcula quando o
  // rascunho muda (chave nova) ou a tela volta.
  const { invalidateFinance } = await import('./query-invalidation.ts');
  const chamadas: any[] = [];
  const client = { invalidateQueries: async (f: any) => { chamadas.push(f); } } as any;
  await invalidateFinance(client);
  const sim = chamadas.find((f) => f.queryKey[0] === 'simular');
  assert.equal(sim?.refetchType, 'none');
  assert.equal(chamadas.find((f) => f.queryKey[0] === 'forecast')?.refetchType, undefined);
});

test('excluir compra chama exclusão atômica de entrada e plano; erro do banco é propagado', async () => {
  const client = new QueryClient();
  const calls: any[] = [];
  const refusal = { message: 'Fatura paga' };
  let fail = false;
  try {
    const hooks = loadHooks(client, 'src/hooks/use-finance.ts', {
      '@/lib/supabase': { supabase: { rpc: async (name: string, args: any) => {
        calls.push({ name, args }); return { data: fail ? null : 1, error: fail ? refusal : null };
      } } },
    });
    await hooks.useDeleteInstallmentPlan().mutationFn('plano-1');
    assert.deepEqual(calls.map(c => [c.name, c.args.p_plan_id]), [['delete_installment_purchase', 'plano-1']]);
    fail = true;
    await assert.rejects(hooks.useDeleteInstallmentPlan().mutationFn('plano-1'), error => error === refusal);
  } finally { client.clear(); }
});


function f07ReadFixture(ws: string): any {
  const asOf = dates.localISODate();
  const start = new Date(`${asOf.slice(0,7)}-01T12:00:00`);
  return { workspace_id: ws, workspace_name: 'QA reserva', as_of: asOf, config: null, sources: [],
    months: [3,2,1].map(n => {
      const d = new Date(start.getFullYear(),start.getMonth()-n,1);
      return { month: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`,expense_count:0,
        essential_cents:'0',unclassified_count:0,unclassified_cents:'0',fingerprint:'a'.repeat(32),reviewed:false };
    }),unassigned_goals_cents:'0' };
}
test('F07 hooks: consulta escopa workspace/data e resposta de outro workspace nunca vira reserva', async () => {
  const client = new QueryClient();const ws='10000000-0000-4000-8000-000000000001';
  const subscriptions: string[]=[];const calls:any[]=[];let foreign=false;
  const hooks=loadHooks(client,'src/hooks/use-emergency-reserve.ts',{
    '@tanstack/react-query':{useQuery:(opts:any)=>opts},
    '@/hooks/use-items':{workspaceId:async()=>ws,useRealtimeInvalidate:(table:string)=>subscriptions.push(table)},
    '@/lib/supabase':{supabase:{rpc:async(name:string,args:any)=>{calls.push({name,args});return{data:f07ReadFixture(foreign?'10000000-0000-4000-8000-000000000009':ws),error:null};}}},
  });
  try {
    const query=hooks.useEmergencyReserve();const state=await query.queryFn();
    assert.equal(state.workspace_id,ws);assert.equal(state.unassigned_goals_cents,0);
    assert.equal(calls[0].name,'emergency_reserve_state');assert.equal(calls[0].args.p_workspace_id,ws);
    assert.equal(Object.hasOwn(calls[0].args, 'p_as_of'), false);
    for(const table of ['accounts','assets','asset_valuations','transactions','goals','goal_contributions','emergency_reserves','financial_allocations','reserve_month_reviews'])assert.ok(subscriptions.includes(table), `a reserva acompanha ${table}`);
    foreign=true;await assert.rejects(query.queryFn(),/workspace|reserva|espaço/i);
  }finally{client.clear();}
});
test('F07 hooks: retry da escrita usa mesmo recibo e confirmação invalida a reserva', async()=>{
  const client=new QueryClient();const calls:any[]=[];const published:any[]=[];let sequence=0;
  const ws='10000000-0000-4000-8000-000000000001';
  client.setQueryData(['emergency-reserve','default'],{previous:true});
  const hooks=loadHooks(client,'src/hooks/use-emergency-reserve.ts',{
    react:{useState:(value:any)=>[typeof value==='function'?value():value,(next:any)=>published.push(next)]},
    '@/lib/agent-chat':{newClientMessageId:()=>`10000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`},
    '@/lib/supabase':{supabase:{rpc:async(name:string,args:any)=>{calls.push({name,args});return calls.length===1?{data:null,error:new Error('response lost')}:{data:{workspace_id:ws,edit_revision:1},error:null};}}},
  });
  const input={workspace_id:ws,expected_revision:null,base_mode:'manual',manual_monthly_cents:10000,target_months:6,
    unassigned_goals_ack_cents:0,allocations:[],reviewed_months:[]};
  try{
    const mutation=hooks.useSaveEmergencyReserve();
    await assert.rejects(mutation.mutationFn(input),/response lost/);
    assert.equal(calls[0].name,'save_emergency_reserve');assert.equal(published.at(-1)?.manual_monthly_cents,10000);
    const result=await mutation.mutationFn(input);assert.equal(result.edit_revision,1);
    assert.equal(calls[0].args.p_request_id,calls[1].args.p_request_id);assert.equal(published.at(-1),null);
    await mutation.onSuccess();assert.equal(client.getQueryState(['emergency-reserve','default'])?.isInvalidated,true);
  }finally{client.clear();}
});

test('F07 hooks: o dia validado pelo servidor não depende do fuso ou relógio do aparelho', async () => {
  const client = new QueryClient(); const ws = '10000000-0000-4000-8000-000000000001'; const calls: any[] = [];
  const hooks = loadHooks(client, 'src/hooks/use-emergency-reserve.ts', {
    '@tanstack/react-query': { useQuery: (opts: any) => opts },
    '@/lib/dates': { ...dates, localISODate: () => '2099-01-01' },
    '@/hooks/use-items': { workspaceId: async () => ws, useRealtimeInvalidate: () => {} },
    '@/lib/supabase': { supabase: { rpc: async (_name: string, args: any) => {
      calls.push(args); return { data: f07ReadFixture(ws), error: null };
    } } },
  });
  try {
    const state = await hooks.useEmergencyReserve().queryFn();
    assert.equal(state.as_of, dates.localISODate());
    assert.equal(Object.hasOwn(calls[0], 'p_as_of'), false, 'a RPC determina hoje em America/Sao_Paulo');
  } finally { client.clear(); }
});

test('F07 hooks: resolução usa identidade original e cancelamento selado invalida a reserva sem gravar', async () => {
  const client = new QueryClient(); const calls: any[] = []; const published: any[] = []; const mutations: any[] = [];
  const ws = '10000000-0000-4000-8000-000000000001';
  client.setQueryData(['emergency-reserve', 'default'], { previous: true });
  const hooks = loadHooks(client, 'src/hooks/use-emergency-reserve.ts', {
    react: { useState: (value: any) => [typeof value === 'function' ? value() : value, (next: any) => published.push(next)] },
    '@tanstack/react-query': { useQueryClient: () => client, useMutation: (options: any) => {
      mutations.push(options); return { ...options, mutateAsync: options.mutationFn, isPending: false };
    } },
    '@/lib/agent-chat': { newClientMessageId: () => '10000000-0000-4000-8000-000000000002' },
    '@/lib/supabase': { supabase: { rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      return name === 'save_emergency_reserve' ? { data: null, error: new Error('response lost') }
        : { data: { workspace_id: ws, cancelled: true }, error: null };
    } } },
  });
  const input = { workspace_id: ws, expected_revision: null, base_mode: 'manual', manual_monthly_cents: 10000,
    target_months: 6, unassigned_goals_ack_cents: 0, allocations: [], reviewed_months: [] };
  try {
    const mutation = hooks.useSaveEmergencyReserve();
    await assert.rejects(mutation.mutateAsync(input), /response lost/);
    let cancellation: any;
    await assert.rejects(mutation.resolveAsync(), error => { cancellation = error; return (error as any).name === 'EmergencyReserveAttemptCancelledError'; });
    assert.equal(calls.length, 2); assert.equal(calls[1].name, 'resolve_emergency_reserve_attempt');
    assert.equal(calls[0].args.p_request_id, calls[1].args.p_request_id);
    assert.deepEqual(calls[0].args.p_input, calls[1].args.p_input);
    assert.equal(published.at(-1), null);
    await mutations[1].onError(cancellation);
    assert.equal(client.getQueryState(['emergency-reserve', 'default'])?.isInvalidated, true);
  } finally { client.clear(); }
});

function f08ReadFixture(ws: string, mode = 'month') {
  return { workspace_id: ws, workspace_name: 'F08 QA workspace', cycle_close_day: 15, as_of: dates.localISODate(), days: 3650, view: 'cycle', mode,
    edit_revision: null, goals_fingerprint: 'a'.repeat(32), goals: [], reserved_cash_cents: '0',
    unassigned_goals_cents: '0', income_present: false, incomplete_goal_ids: [], excluded_goal_ids: [],
    missed_deadline_goal_ids: [], points: [], months: [], first_pressure_on: null, minimum_available_cents: '0' };
}
test('F08 hooks: one workspace RPC owns the complete horizon and previous query data is not a placeholder', async () => {
  const client = new QueryClient();const ws = '10000000-0000-4000-8000-000000000001';
  const subscriptions: string[] = [];const calls: any[] = [];let foreign = false;
  const hooks = loadHooks(client, 'src/hooks/use-goal-planning.ts', {
    '@tanstack/react-query': { useQuery: (options: any) => options },
    '@/hooks/use-items': { workspaceId: async () => ws, useRealtimeInvalidate: (table: string) => subscriptions.push(table) },
    '@/lib/supabase': { supabase: { rpc: async (name: string, args: any) => {
      calls.push({ name, args });return { data: f08ReadFixture(foreign ? '10000000-0000-4000-8000-000000000009' : ws), error: null };
    } } },
  });
  try {
    const query = hooks.useGoalPlanning(3650, 'cycle', 'month');const state = await query.queryFn();
    assert.equal(state.workspace_id, ws);assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'goal_planning_state');assert.equal(calls[0].args.p_workspace_id, ws);
    assert.equal(calls[0].args.p_days, 3650);assert.equal(calls[0].args.p_view, 'cycle');assert.equal(calls[0].args.p_mode, 'month');
    assert.equal(calls[0].args.p_preview, null);assert.equal(query.placeholderData, undefined);
    const preview = { goals_fingerprint: 'a'.repeat(32), items: [] };
    assert.notDeepEqual(query.queryKey, hooks.useGoalPlanning(3650, 'cycle', 'month', preview).queryKey);
    assert.notDeepEqual(query.queryKey, hooks.useGoalPlanning(3650, 'civil', 'day').queryKey);
    assert.notDeepEqual(query.queryKey, hooks.useGoalPlanning(3650, 'cycle', 'month', null, false, ws).queryKey);
    assert.equal(hooks.useGoalPlanning(3650, 'cycle', 'month', null, false).enabled, false);
    for (const table of ['transactions', 'accounts', 'card_invoices', 'recurring_transactions', 'debts', 'goals',
      'goal_contributions', 'financial_allocations', 'emergency_reserves', 'goal_plans', 'goal_plan_items']) assert.ok(subscriptions.includes(table), `planning follows ${table}`);
    foreign = true;await assert.rejects(query.queryFn(), /workspace|espaço|plano/i);
  } finally { client.clear(); }
});

test('F10 hooks: versioned source/initial/date participates in key and the scoped complete RPC owns capacity', async () => {
  const client = new QueryClient();const ws = '10000000-0000-4000-8000-000000000001';
  const calls: any[] = [];const subscriptions: string[] = [];let foreign = false;
  const hooks = loadHooks(client, 'src/hooks/use-goal-horizon.ts', {
    '@tanstack/react-query': { useQuery: (options: any) => options },
    '@/hooks/use-goal-planning': { useGoalPlanningSources: () => subscriptions.push('shared-finance-sources') },
    '@/hooks/use-items': { workspaceId: async () => ws },
    '@/lib/supabase': { supabase: { rpc: async (name: string, args: any) => {
      calls.push({ name, args });return { data: { state: f08ReadFixture(foreign ? '10000000-0000-4000-8000-000000000009' : ws), horizons: [] }, error: null };
    } } },
  });
  try {
    const query = hooks.useGoalHorizonPlanning(3650, 'cycle', 'month');const state = await query.queryFn();
    assert.equal(state.workspace_id, ws);assert.equal(calls.length, 1);assert.equal(calls[0].name, 'goal_planning_state_v2');
    assert.equal(calls[0].args.p_workspace_id, ws);assert.equal(calls[0].args.p_days, 3650);
    assert.equal(calls[0].args.p_preview, null);assert.equal(query.placeholderData, undefined);
    assert.equal(query.queryKey[1], 'v2');assert.ok(subscriptions.includes('shared-finance-sources'));
    const preview = { goals_fingerprint: 'a'.repeat(32), items: [] };
    assert.notDeepEqual(query.queryKey, hooks.useGoalHorizonPlanning(3650, 'cycle', 'month', preview).queryKey);
    assert.notDeepEqual(query.queryKey, hooks.useGoalHorizonPlanning(3650, 'civil', 'day').queryKey);
    assert.equal(hooks.useGoalHorizonPlanning(3650, 'cycle', 'month', null, false, ws).enabled, false);
    foreign = true;await assert.rejects(query.queryFn(), /workspace|espaço|plano/i);
  } finally { client.clear(); }
});
test('F08 hooks: ambiguous outcomes do not invalidate a scenario; sealed cancellation and success do', async () => {
  const client = new QueryClient();const calls: any[] = [];const mutations: any[] = [];
  const ws = '10000000-0000-4000-8000-000000000001';
  client.setQueryData(['goal-planning', 'default'], { previous: true });
  const hooks = loadHooks(client, 'src/hooks/use-goal-planning.ts', {
    react: { useState: (value: any) => [typeof value === 'function' ? value() : value, () => undefined] },
    '@tanstack/react-query': { useQueryClient: () => client, useMutation: (options: any) => {
      mutations.push(options);return { ...options, mutateAsync: options.mutationFn, isPending: false };
    } },
    '@/lib/agent-chat': { newClientMessageId: () => '10000000-0000-4000-8000-000000000002' },
    '@/lib/supabase': { supabase: { rpc: async (name: string, args: any) => {
      calls.push({ name, args });return name === 'save_goal_plan' ? { error: new Error('response lost'), data: null }
        : { error: null, data: { workspace_id: ws, cancelled: true } };
    } } },
  });
  const input = { workspace_id: ws, expected_revision: null, goals_fingerprint: 'a'.repeat(32), items: [] };
  try {
    const mutation = hooks.useSaveGoalPlan();let lost: unknown;let cancelled: unknown;
    await assert.rejects(mutation.mutateAsync(input), error => { lost = error;return true; });
    await mutations[0].onError(lost);assert.equal(client.getQueryState(['goal-planning', 'default'])?.isInvalidated, false);
    await assert.rejects(mutation.resolveAsync(), error => { cancelled = error;return (error as any).name === 'GoalPlanAttemptCancelledError'; });
    assert.equal(calls.length, 2);assert.equal(calls[0].name, 'save_goal_plan');assert.equal(calls[1].name, 'resolve_goal_plan_attempt');
    assert.equal(calls[0].args.p_request_id, calls[1].args.p_request_id);assert.deepEqual(calls[0].args.p_input, calls[1].args.p_input);
    await mutations[1].onError(cancelled);assert.equal(client.getQueryState(['goal-planning', 'default'])?.isInvalidated, true);
    client.setQueryData(['goal-planning', 'default'], { previous: true });
    await mutations[0].onSuccess();assert.equal(client.getQueryState(['goal-planning', 'default'])?.isInvalidated, true);
  } finally { client.clear(); }
});
test('F08 fresh editor read preserves explicit workspace, draft and cancellation signal', async () => {
  const client = new QueryClient();const ws = '10000000-0000-4000-8000-000000000007';
  const calls: any[] = [];const signals: AbortSignal[] = [];let defaults = 0;let offline = false;
  const hooks = loadHooks(client, 'src/hooks/use-goal-planning.ts', {
    '@/hooks/use-items': { workspaceId: async () => { defaults++;return '10000000-0000-4000-8000-000000000001'; } },
    '@/lib/supabase': { supabase: { rpc: (name: string, args: any) => {
      calls.push({ name, args });
      const response = () => Promise.resolve(offline ? { error: new Error('read failed'), data: null }
        : { error: null, data: f08ReadFixture(ws) });
      return { then: (yes: any, no: any) => response().then(yes, no),
        abortSignal: (signal: AbortSignal) => { signals.push(signal);return response(); } };
    } } },
  });
  const preview = { goals_fingerprint: 'a'.repeat(32), items: [] };const signal = new AbortController().signal;
  try {
    const state = await hooks.fetchGoalPlanning(3650, 'cycle', 'month', preview, ws, signal);
    assert.equal(state.workspace_id, ws);assert.equal(defaults, 0);assert.equal(calls.length, 1);
    assert.equal(calls[0].args.p_workspace_id, ws);assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args.p_preview)), preview);assert.equal(signals[0], signal);
    offline = true;await assert.rejects(hooks.fetchGoalPlanning(3650, 'cycle', 'month', null, ws), /read failed/);
  } finally { client.clear(); }
});
