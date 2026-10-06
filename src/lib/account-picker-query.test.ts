import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function queries() {
  const calls: string[] = [];
  const load = (file: string): any => {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(code, { module, exports: module.exports, setTimeout, clearTimeout,
      require: (id: string) => {
        if (id === 'expo-router') return { useIsFocused: () => true };
        if (id === '@tanstack/react-query') return { ...require(id), useQuery: (options: any) => options };
        if (id === '@/hooks/use-items') return { useRealtimeInvalidate() {} };
        if (id === '@/lib/agent-api') return {};
        if (id === '@/lib/agent-chat') return { newClientMessageId: () => 'unused-query-id' };
        if (id === '@/lib/supabase') return { supabase: { rpc: async (name: string) => {
          calls.push(name);
          return { data: [], error: null };
        } } };
        if (id.startsWith('@/lib/') && existsSync(`src/lib/${id.slice(6)}.ts`)) return load(`src/lib/${id.slice(6)}.ts`);
        if (id.startsWith('./') && file.startsWith('src/lib/') && existsSync(`src/lib/${id.slice(2)}`)) return load(`src/lib/${id.slice(2)}`);
        return {};
      },
    });
    return module.exports;
  };
  return { hooks: load('src/hooks/use-finance.ts'), calls };
}

test('F03: muitas instâncias do seletor compartilham uma RPC por recurso no cache real', async () => {
  const { hooks, calls } = queries();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60000 } } });
  const unsubscribe: (() => void)[] = [];
  try {
    for (let i = 0; i < 100; i++) {
      unsubscribe.push(new QueryObserver(client, hooks.useAccountBalances(true)).subscribe(() => {}));
      unsubscribe.push(new QueryObserver(client, hooks.useCardLimitContext(true)).subscribe(() => {}));
    }
    await Promise.all([client.fetchQuery(hooks.useAccountBalances(true)), client.fetchQuery(hooks.useCardLimitContext(true))]);
    assert.deepEqual(calls.sort(), ['account_balances', 'card_limit_context']);
  } finally { unsubscribe.forEach(close => close()); client.clear(); }
});

test('F03: recurso desabilitado não busca nem mesmo quando o outro recurso está montado', async () => {
  const { hooks, calls } = queries();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const closeBank = new QueryObserver(client, hooks.useAccountBalances(true)).subscribe(() => {});
  const closeCard = new QueryObserver(client, hooks.useCardLimitContext(false)).subscribe(() => {});
  try {
    await client.fetchQuery(hooks.useAccountBalances(true));
    assert.deepEqual(calls, ['account_balances']);
    assert.equal(client.getQueryState(['card-limit-context'])?.fetchStatus, 'idle');
  } finally { closeBank(); closeCard(); client.clear(); }
});
