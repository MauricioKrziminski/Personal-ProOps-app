import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import ts from 'typescript';
import { lerPrevia } from './finance-write-preview.ts';

const response = { as_of: '2026-10-02', horizon_end: '2026-12-31',
  before: { balances: [], limits: [], accounts: [], cards: [] },
  after: { balances: [], limits: [], accounts: [], cards: [] },
  write: { operation: 'transaction', result: {} }, schedule: [], schedule_total: 0,
  schedule_truncated: false, schedule_scope: 'contract', horizon_days: 90 };

function harness() {
  const calls: { name: string; args: any; signal: AbortSignal; resolve: (data: any) => void }[] = [];
  const module = { exports: {} as any };
  const code = ts.transpileModule(readFileSync('src/hooks/use-finance-write-preview.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, JSON, require: (id: string) => {
    if (id === '@/lib/finance-write-preview') return { lerPrevia };
    if (id === '@/lib/supabase') return { supabase: { rpc: (name: string, args: any) => ({
      abortSignal: (signal: AbortSignal) => new Promise(resolve => calls.push({ name, args, signal, resolve })),
    }) } };
    return {};
  } });
  return { options: module.exports.opcoesDaPrevia, calls };
}
const identity = (amount: number) => JSON.stringify({ operation: 'transaction', args: {
  p_transaction_id: null, p_input: { amount_cents: amount }, p_fee_cents: 0, p_expected_revision: null,
} });

test('incomplete and debouncing drafts do not execute the preview write RPC', () => {
  const { options } = harness();
  assert.equal(options(null, true).enabled, false);
  assert.equal(options(identity(1234), false).enabled, false);
  assert.equal(options(identity(1234), true).enabled, true);
});
test('raw draft switch cancels the old transport before debounce, and late completion never replaces the new result', async () => {
  const { options, calls } = harness();
  const client = new QueryClient();
  const old = identity(1234), next = identity(5678);
  const observer = new QueryObserver(client, options(old, true));
  const close = observer.subscribe(() => {});
  try {
    await Promise.resolve();
    assert.equal(calls.length, 1);
    observer.setOptions(options(next, false));
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(observer.getCurrentResult().data, undefined);
    observer.setOptions(options(next, true));
    await Promise.resolve();
    assert.equal(calls.length, 2);
    calls[1].resolve({ data: response, error: null });
    await client.fetchQuery(options(next, true));
    calls[0].resolve({ data: response, error: null });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal((observer.getCurrentResult().data as any).identity, next);
    assert.equal(calls[1].name, 'preview_finance_write');
    assert.equal(calls[1].args.p_args.p_input.amount_cents, 5678);
    assert.equal(calls[1].args.p_days, 90);
    assert.ok(!('p_request_id' in calls[1].args.p_args));
  } finally { close(); client.clear(); }
});
