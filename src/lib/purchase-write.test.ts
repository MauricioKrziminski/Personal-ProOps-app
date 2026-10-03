import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

type Input = Record<string, unknown>;
type Reply = { data: unknown; error: unknown };
type MutationOptions = { mutationFn: (input: Input) => Promise<unknown>; onSuccess?: () => unknown };
type Mutation = MutationOptions & { mutateAsync: (input: Input) => Promise<unknown> };
type HookName = 'useCreateInstallmentPlan' | 'useSaveDebt' | 'useAddPurchaseDownPayment';
type RpcCall = { name: string; args: Input };
type UpdateCall = { table: string; values: Input; filters: [string, unknown][]; selection?: string };

// Compara o JSON que sai para a RPC, sem identidade/prototipos do contexto VM nem undefined.
function wire<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

/** Executa os hooks reais; somente React/Query e o transporte Supabase recebem dubles. */
function harness() {
  const rpcCalls: RpcCall[] = [];
  const updates: UpdateCall[] = [];
  const replies: (Reply | Error)[] = [];
  let updateReply: Reply = { data: [{ id: 'debt-existing' }], error: null };
  let generatedIds = 0;
  let frame: { slots: { current: unknown }[]; next: number } | undefined;
  const cache = new Map<string, unknown>();
  const dependencies: Record<string, unknown> = {
    react: {
      useCallback: (fn: unknown) => fn,
      useRef: (initial: unknown) => {
        assert.ok(frame, 'useRef precisa ser chamado durante o render do hook');
        const slot = frame.next++;
        return frame.slots[slot] ?? (frame.slots[slot] = { current: initial });
      },
    },
    '@tanstack/react-query': {
      useQueryClient: () => ({}),
      useMutation: (options: MutationOptions): Mutation => ({
        ...options,
        async mutateAsync(input) {
          const result = await options.mutationFn(input);
          await options.onSuccess?.();
          return result;
        },
      }),
    },
    '@/lib/query-invalidation': { invalidateFinance: async () => {} },
    '@/lib/agent-chat': {
      newClientMessageId: () => `00000000-0000-4000-8000-${String(++generatedIds).padStart(12, '0')}`,
    },
    '@/lib/supabase': { supabase: {
      async rpc(name: string, args: Input) {
        rpcCalls.push({ name, args: wire(args) });
        const reply = replies.shift() ?? { data: 'entry-created', error: null };
        if (reply instanceof Error) throw reply;
        return reply;
      },
      from(table: string) {
        return {
          update(values: Input) {
            const call: UpdateCall = { table, values: wire(values), filters: [] };
            updates.push(call);
            const query = {
              eq(column: string, value: unknown) { call.filters.push([column, value]); return query; },
              async select(selection: string) { call.selection = selection; return updateReply; },
            };
            return query;
          },
        };
      },
    } },
  };
  function load(file: string): unknown {
    const path = resolve(file);
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} };
    cache.set(path, module.exports);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(code, {
      module, exports: module.exports,
      require: (name: string) => {
        if (name in dependencies) return dependencies[name];
        // O mapeamento do formulario para contrato e codigo real, nao um resultado combinado.
        if (name === '@/lib/escrita') return load('src/lib/escrita.ts');
        if (name === '@/lib/finance-write-input') return load('src/lib/finance-write-input.ts');
        if (name === '@/lib/payment-method' || name === './payment-method.ts') return load('src/lib/payment-method.ts');
        if (name.startsWith('./')) return load(resolve(dirname(path), name));
        return {};
      },
    }, { filename: path });
    cache.set(path, module.exports);
    return module.exports;
  }
  return {
    rpcCalls, updates,
    get generatedIds() { return generatedIds; },
    failNextRpc(error: Error, transport = false) {
      replies.push(transport ? error : { data: null, error });
    },
    setUpdateReply(reply: Reply) { updateReply = reply; },
    mount(name: HookName) {
      const file = name === 'useAddPurchaseDownPayment' ? 'src/hooks/use-down-payment.ts' : 'src/hooks/use-finance.ts';
      const hooks = load(file) as Record<HookName, () => Mutation>;
      // Cada montagem tem slots proprios; re-render da MESMA instancia conserva os refs.
      const slots: { current: unknown }[] = [];
      return {
        render() {
          assert.equal(frame, undefined, 'render aninhado nao esperado');
          frame = { slots, next: 0 };
          try { return hooks[name](); }
          finally { frame = undefined; }
        },
      };
    },
  };
}

const payment = { amount_cents: 20000, account_id: 'cash-entry', occurred_at: '2026-09-29' };
const installment = {
  accountId: 'card-contract', totalCents: 100000, installments: 5, paidInstallments: 2,
  occurredAt: '2026-10-10', description: 'Computador', category: 'casa', merchant: 'Loja',
  lastDay: false,
};
const debt = {
  name: 'Carro', kind: 'financing', calculation_mode: 'fixed_installments',
  principal_cents: 100000, remaining_cents: 60000, interest_rate_monthly: 0,
  installments: 5, installments_paid: 2, installment_cents: 20000,
  account_id: 'checking-contract', due_day: 10, first_due_date: '2026-08-10',
};
const cases: { name: HookName; input: Input; change: (input: Input) => Input }[] = [
  { name: 'useCreateInstallmentPlan', input: { ...installment, downPayment: payment },
    change: (input) => ({ ...input, downPayment: { ...payment, amount_cents: 21000 } }) },
  { name: 'useSaveDebt', input: { ...debt, down_payment: payment },
    change: (input) => ({ ...input, down_payment: { ...payment, account_id: 'other-cash-entry' } }) },
  { name: 'useAddPurchaseDownPayment', input: { type: 'financiamento', parentId: 'debt-parent', payment },
    change: (input) => ({ ...input, parentId: 'another-debt-parent' }) },
];

for (const { name, input, change } of cases) {
  test(`${name}: mesmo payload conserva a tentativa entre renders; outra montagem recebe chave propria`, async () => {
    const h = harness();
    const mounted = h.mount(name);
    const first = mounted.render();
    assert.equal(h.generatedIds, 0, 'render sem salvar nao deve criar tentativa');
    await first.mutateAsync(wire(input));
    await mounted.render().mutateAsync(wire(input));
    assert.equal(h.rpcCalls.length, 2);
    assert.equal(h.rpcCalls[0].args.p_request_id, h.rpcCalls[1].args.p_request_id);
    assert.equal(h.generatedIds, 1);
    await h.mount(name).render().mutateAsync(wire(input));
    assert.notEqual(h.rpcCalls[2].args.p_request_id, h.rpcCalls[0].args.p_request_id,
      'outra intencao em outro formulario nao reutiliza o parent antigo');
  });

  test(`${name}: payload diferente recebe nova tentativa sem modificar o input`, async () => {
    const h = harness();
    const mounted = h.mount(name);
    const original = wire(input);
    const changed = change(original);
    await mounted.render().mutateAsync(original);
    await mounted.render().mutateAsync(changed);
    await mounted.render().mutateAsync(wire(changed));
    assert.notEqual(h.rpcCalls[0].args.p_request_id, h.rpcCalls[1].args.p_request_id);
    assert.equal(h.rpcCalls[1].args.p_request_id, h.rpcCalls[2].args.p_request_id);
    assert.equal(h.generatedIds, 2);
    assert.deepEqual(original, input, 'hook nao deve adicionar vinculos/id ao objeto do formulario');
  });

  test(`${name}: erro da RPC e falha de transporte preservam chave no retry`, async () => {
    const h = harness();
    const mounted = h.mount(name);
    const rejected = new Error('RPC recusou');
    h.failNextRpc(rejected);
    await assert.rejects(mounted.render().mutateAsync(wire(input)), (error) => error === rejected);
    const network = new Error('Conexao interrompida depois de enviar');
    h.failNextRpc(network, true);
    await assert.rejects(mounted.render().mutateAsync(wire(input)), (error) => error === network);
    await mounted.render().mutateAsync(wire(input));
    assert.equal(h.rpcCalls.length, 3);
    assert.equal(new Set(h.rpcCalls.map((call) => call.args.p_request_id)).size, 1);
    assert.equal(h.generatedIds, 1, 'retry nao pode criar outro contrato se a primeira escrita foi recebida');
  });
}

for (const { name, input, change } of [
  { name: 'useCreateInstallmentPlan' as const, input: { ...installment, downPayment: payment },
    change: { ...installment, totalCents: 120000, downPayment: payment } },
  { name: 'useSaveDebt' as const, input: { ...debt, down_payment: payment },
    change: { ...debt, name: 'Outro carro', down_payment: payment } },
  { name: 'useAddPurchaseDownPayment' as const, input: { type: 'parcelada', parentId: 'plan-existing', payment },
    change: { type: 'parcelada', parentId: 'plan-existing', payment: { ...payment, amount_cents: 23000 } } },
]) {
  test(`${name}: a chave tambem acompanha o valor/contrato quando a outra parte fica igual`, async () => {
    const h = harness();
    const mounted = h.mount(name);
    await mounted.render().mutateAsync(input);
    await mounted.render().mutateAsync(change);
    assert.notEqual(h.rpcCalls[0].args.p_request_id, h.rpcCalls[1].args.p_request_id);
    assert.equal(h.generatedIds, 2);
  });
}

test('compra com entrada transmite somente contrato remanescente e os tres campos independentes da entrada', async () => {
  const h = harness();
  await h.mount('useCreateInstallmentPlan').render().mutateAsync({ ...installment, downPayment: payment });
  assert.deepEqual(h.rpcCalls, [{ name: 'create_purchase', args: {
    p_tipo: 'parcelada', p_request_id: '00000000-0000-4000-8000-000000000001',
    p_dados: {
      p_account_id: 'card-contract', p_total_cents: 100000, p_installments: 5, p_paid_installments: 2,
      p_occurred_at: '2026-10-10', p_description: 'Computador', p_category: 'casa', p_merchant: 'Loja',
      ultimo_dia: false, down_payment: payment,
    },
  } }]);
  assert.deepEqual(h.updates, [], 'nenhuma despesa/prestacao avulsa e gravada pelo hook');
});

test('compra sem entrada conserva conta, historico, estabelecimento e ultimo dia', async () => {
  const h = harness();
  await h.mount('useCreateInstallmentPlan').render().mutateAsync({ ...installment, lastDay: true });
  assert.deepEqual(h.rpcCalls[0], { name: 'create_purchase', args: {
    p_tipo: 'parcelada', p_request_id: '00000000-0000-4000-8000-000000000001',
    p_dados: {
      p_account_id: 'card-contract', p_total_cents: 100000, p_installments: 5, p_paid_installments: 2,
      p_occurred_at: '2026-10-10', p_description: 'Computador', p_category: 'casa', p_merchant: 'Loja',
      ultimo_dia: true,
    },
  } });
});

test('financiamento com/sem entrada conserva o contrato e nao cria debt_id/installment_plan_id na entrada', async () => {
  const h = harness();
  const mounted = h.mount('useSaveDebt');
  await mounted.render().mutateAsync({ ...debt, down_payment: payment });
  await mounted.render().mutateAsync({ ...debt });
  assert.deepEqual(h.rpcCalls[0], { name: 'create_purchase', args: {
    p_tipo: 'financiamento', p_dados: { ...debt, down_payment: payment },
    p_request_id: '00000000-0000-4000-8000-000000000001',
  } });
  assert.deepEqual(h.rpcCalls[1], { name: 'create_purchase', args: {
    p_tipo: 'financiamento', p_dados: debt,
    p_request_id: '00000000-0000-4000-8000-000000000002',
  } });
  assert.deepEqual(h.updates, []);
});

test('anexar entrada usa o parent escolhido e devolve o id da despesa sem editar o contrato', async () => {
  const h = harness();
  const result = await h.mount('useAddPurchaseDownPayment').render().mutateAsync({
    type: 'parcelada', parentId: 'plan-existing', payment,
  });
  assert.equal(result, 'entry-created');
  assert.deepEqual(h.rpcCalls[0], { name: 'add_purchase_down_payment', args: {
    p_tipo: 'parcelada', p_parent_id: 'plan-existing', p_entrada: payment,
    p_request_id: '00000000-0000-4000-8000-000000000001',
  } });
  assert.deepEqual(h.updates, []);
});

test('editar divida preserva id e versao na consulta; nao cria parent nem grava entrada no contrato', async () => {
  const h = harness();
  await h.mount('useSaveDebt').render().mutateAsync({
    ...debt, name: 'Carro corrigido', id: 'debt-existing', versao: '2026-09-30T12:00:00Z', down_payment: payment,
  });
  assert.deepEqual(h.rpcCalls, []);
  assert.equal(h.generatedIds, 0);
  assert.deepEqual(h.updates, [{
    table: 'debts', values: { ...debt, name: 'Carro corrigido' },
    filters: [['id', 'debt-existing'], ['updated_at', '2026-09-30T12:00:00Z']], selection: 'id',
  }]);
});

test('divida alterada por outra escrita recusa update vazio e nao cria parent como fallback', async () => {
  const h = harness();
  h.setUpdateReply({ data: [], error: null });
  await assert.rejects(h.mount('useSaveDebt').render().mutateAsync({ ...debt, id: 'missing-debt' }),
    (error) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'VERSAO'));
  assert.deepEqual(h.rpcCalls, []);
  assert.equal(h.generatedIds, 0);
  assert.equal(h.updates.length, 1);
});
