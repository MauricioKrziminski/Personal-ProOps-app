import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { QueryClient } from '@tanstack/react-query';

const require = createRequire(import.meta.url);
const input = { name: 'F02 Conta', type: 'checking', initial_balance_cents: -5000 };
const active = { id: 'account-1', availability: 'active', account: { id: 'account-1', name: 'F02 Conta', type: 'checking', initial_balance_cents: -5000, archived: false } };

// Execute the real hook, replacing only React's renderer and the network boundary.
function harness(rpc: (name: string, args: any) => Promise<any>) {
  const client = new QueryClient();
  const slots: any[] = [];
  let cursor = 0;
  let sequence = 0;
  const load = (file: string): any => {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(code, { module, exports: module.exports, console, setTimeout, clearTimeout, require: (name: string) => {
      if (name === 'react') return {
        useCallback: (fn: unknown) => fn,
        useRef: (value: unknown) => { const index = cursor++; return slots[index] ??= { current: value }; },
        useState: (value: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value; return [slots[index], (next: unknown) => { slots[index] = next; }]; },
      };
      if (name === '@tanstack/react-query') return { ...require(name), useQueryClient: () => client, useMutation: (options: unknown) => options };
      if (name === '@/lib/agent-chat') return { newClientMessageId: () => `request-${++sequence}` };
      if (name === '@/lib/agent-api') return {};
      if (name === '@/lib/supabase') return { supabase: { rpc, auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) }, from: () => ({ insert: async () => ({ error: null }) }) } };
      if (name.startsWith('@/lib/') && existsSync(`src/lib/${name.slice(6)}.ts`)) return load(`src/lib/${name.slice(6)}.ts`);
      if (name.startsWith('./') && file.startsWith('src/lib/') && existsSync(`src/lib/${name.slice(2)}`)) return load(`src/lib/${name.slice(2)}`);
      return {};
    } });
    return module.exports;
  };
  const hooks = load('src/hooks/use-finance.ts');
  return { client, render: () => { cursor = 0; return (hooks.useCreateAccount ?? hooks.useSaveAccount)(); } };
}

test('F02: a lost response freezes the original request; changing fields cannot create a second account', async () => {
  const calls: any[] = [];
  const h = harness(async (name, args) => {
    calls.push({ name, args });
    return calls.length === 1 ? { error: new Error('response lost') } : { data: active, error: null };
  });
  try {
    await assert.rejects(h.render().mutationFn(input), /response lost/);
    assert.deepEqual(JSON.parse(JSON.stringify(h.render().unconfirmedInput)), input);
    await assert.rejects(h.render().mutationFn({ ...input, name: 'Another name' }), /confirma|tentativa/i);
    assert.equal(calls.length, 1, 'changed input never dispatches a new creation');
    const result = await h.render().mutationFn({ initial_balance_cents: -5000, type: 'checking', name: 'F02 Conta' });
    assert.equal(result.id, 'account-1');
    assert.equal(calls[0].name, 'create_account');
    assert.equal(calls[1].args.p_request_id, calls[0].args.p_request_id);
    assert.equal(h.render().unconfirmedInput, null);
    await h.render().mutationFn({ ...input, name: 'Second explicit creation' });
    assert.notEqual(calls[2].args.p_request_id, calls[1].args.p_request_id);
  } finally { h.client.clear(); }
});

test('F02: concurrent identical submissions share one request and a frozen input snapshot', async () => {
  const calls: any[] = [];
  let finish!: (value: any) => void;
  const h = harness(async (name, args) => { calls.push({ name, args }); return new Promise(resolve => { finish = resolve; }); });
  try {
    const original = { ...input };
    const mutation = h.render();
    const first = mutation.mutationFn(original);
    const second = mutation.mutationFn({ ...input });
    original.name = 'mutated caller object';
    await assert.rejects(mutation.mutationFn(original), /confirma|tentativa/i);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.p_input.name, 'F02 Conta');
    finish({ data: active, error: null });
    assert.equal((await first).id, 'account-1');
    assert.equal((await second).id, 'account-1');
  } finally { h.client.clear(); }
});

test('F02: proven SQL rollbacks release the attempt; transport and malformed responses retain it', async () => {
  for (const code of ['23505', '23514', '22023', '42501', 'P0001']) {
    const calls: any[] = [];
    const refusal = { code, message: 'server refused' };
    const h = harness(async (_name, args) => { calls.push(args); return calls.length === 1 ? { error: refusal } : { data: active, error: null }; });
    try {
      await assert.rejects(h.render().mutationFn(input), error => error === refusal);
      assert.equal(h.render().unconfirmedInput, null, code);
      await h.render().mutationFn({ ...input, name: 'Corrected' });
      assert.notEqual(calls[0].p_request_id, calls[1].p_request_id, code);
    } finally { h.client.clear(); }
  }
  for (const error of [{ code: 'PGRST000', message: 'connection unavailable' }, { code: '08006', message: 'connection lost' }, null]) {
    const calls: any[] = [];
    const h = harness(async (_name, args) => { calls.push(args); return calls.length === 1 ? { data: null, error } : { data: active, error: null }; });
    try {
      await assert.rejects(h.render().mutationFn(input));
      assert.equal(h.render().unconfirmedInput.name, input.name);
      await h.render().mutationFn(input);
      assert.equal(calls[0].p_request_id, calls[1].p_request_id);
    } finally { h.client.clear(); }
  }
});

test('F02: archived/unavailable acknowledgments retain identity and invalidate financial caches without clearing others', async () => {
  for (const result of [
    { ...active, availability: 'archived', account: { ...active.account, archived: true } },
    { id: 'account-1', availability: 'unavailable', account: null },
  ]) {
    const h = harness(async () => ({ data: result, error: null }));
    try {
      h.client.setQueryData(['accounts'], ['old']);
      h.client.setQueryData(['account-balances'], [0]);
      h.client.setQueryData(['notes'], ['retain']);
      const mutation = h.render();
      assert.deepEqual(await mutation.mutationFn(input), result);
      assert.equal(h.render().unconfirmedInput, null);
      await mutation.onSuccess(result);
      assert.equal(h.client.getQueryState(['accounts'])?.isInvalidated, true);
      assert.equal(h.client.getQueryState(['account-balances'])?.isInvalidated, true);
      assert.deepEqual(h.client.getQueryData(['notes']), ['retain']);
      assert.equal(h.client.getQueryState(['notes'])?.isInvalidated, false);
    } finally { h.client.clear(); }
  }
});

test('F02: incomplete or invalid current account rows retain the original attempt for replay', async () => {
  for (const availability of ['active', 'archived']) {
    const archived = availability === 'archived';
    for (const account of [
      { id: 'account-1', archived },
      { ...active.account, archived, name: undefined },
      { ...active.account, archived, name: '  ' },
      { ...active.account, archived, name: 1 },
      { ...active.account, archived, type: undefined },
      { ...active.account, archived, type: 'unknown' },
      { ...active.account, archived, initial_balance_cents: undefined },
      { ...active.account, archived, initial_balance_cents: '100' },
      { ...active.account, archived, initial_balance_cents: 1.5 },
      { ...active.account, archived, initial_balance_cents: Number.MAX_SAFE_INTEGER + 1 },
      { ...active.account, archived, initial_balance_cents: Infinity },
      { ...active.account, archived, type: 'credit_card', closing_day: 3 },
      { ...active.account, archived, type: 'credit_card', closing_day: 32, due_day: 10 },
      { ...active.account, archived, type: 'credit_card', closing_day: 3, due_day: 1.5 },
      { ...active.account, archived, type: 'credit_card', closing_day: 3, due_day: '10' },
    ]) {
      const calls: any[] = [];
      const h = harness(async (_name, args) => {
        calls.push(args);
        return { data: calls.length === 1 ? { id: 'account-1', availability, account } : active, error: null };
      });
      try {
        await assert.rejects(h.render().mutationFn(input), /confirmar/i);
        assert.equal(h.render().unconfirmedInput.name, input.name);
        const result = await h.render().mutationFn(input);
        assert.equal(result.id, 'account-1');
        assert.equal(calls[0].p_request_id, calls[1].p_request_id, 'malformed account row must not release the receipt');
      } finally { h.client.clear(); }
    }
  }
});

test('F02: acknowledgment validates current shape without undoing a later rename, type or signed balance edit', async () => {
  for (const account of [
    { ...active.account, name: 'Renamed', type: 'savings', initial_balance_cents: -2000 },
    { ...active.account, name: 'Later card', type: 'credit_card', initial_balance_cents: 300, closing_day: 31, due_day: 1 },
    { ...active.account, initial_balance_cents: -Number.MAX_SAFE_INTEGER },
  ]) {
    const result = { ...active, account };
    const h = harness(async () => ({ data: result, error: null }));
    try {
      assert.deepEqual(await h.render().mutationFn(input), result);
      assert.equal(h.render().unconfirmedInput, null);
    } finally { h.client.clear(); }
  }
});

test('F02: replay confirms current nullable card days after a lost response without replacing the original payload', async () => {
  for (const availability of ['active', 'archived']) {
    for (const [closing_day, due_day] of [[null, 10], [3, null], [null, null]]) {
      const calls: any[] = [];
      const result = { id: active.id, availability, account: {
        ...active.account, name: 'Edited after creation', type: 'credit_card',
        archived: availability === 'archived', closing_day, due_day,
      } };
      const h = harness(async (_name, args) => {
        calls.push(args);
        return calls.length === 1 ? { error: new Error('response lost') } : { data: result, error: null };
      });
      try {
        await assert.rejects(h.render().mutationFn(input), /response lost/);
        assert.deepEqual(await h.render().mutationFn(input), result);
        assert.equal(calls[0].p_request_id, calls[1].p_request_id);
        assert.deepEqual(JSON.parse(JSON.stringify(calls[1].p_input)), input);
        assert.equal(h.render().unconfirmedInput, null);
      } finally { h.client.clear(); }
    }
  }
});

test('F02: rollback de um retry não descarta a intenção de um envio anterior sem confirmação', async () => {
  for (const original of [{ error: new Error('response lost') }, { data: null, error: null }]) {
    for (const code of ['42501', '23505', '22023', 'P0001']) {
      const calls: any[] = [];
      const h = harness(async (_name, args) => {
        calls.push(args);
        return calls.length === 1 ? original : calls.length === 2 ? { error: { code, message: 'retry refused' } } : { data: active, error: null };
      });
      try {
        await assert.rejects(h.render().mutationFn(input));
        await assert.rejects(h.render().mutationFn(input));
        assert.equal(h.render().unconfirmedInput?.name, input.name);
        await assert.rejects(h.render().mutationFn({ ...input, name: 'Changed' }), /confirma|tentativa/i);
        assert.equal((await h.render().mutationFn(input)).id, active.id);
        assert.equal(calls.length, 3);
        assert.ok(calls.every(call => call.p_request_id === calls[0].p_request_id));
        assert.equal(h.render().unconfirmedInput, null);
      } finally { h.client.clear(); }
    }
  }
});
