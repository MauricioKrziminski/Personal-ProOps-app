import { focusManager, type QueryClient } from '@tanstack/react-query';

/** Financial writes can change ledger-derived RPCs across months and screens. */
export const FINANCE_KEYS = [
  ['transactions'], ['tx-summary'], ['monthly-cashflow'], ['account-balances'],
  ['budgets-status'], ['accounts'], ['goals'], ['budgets'], ['recurring'],
  ['card-summary'], ['invoice'], ['card-invoices'], ['installments'], ['forecast'], ['forecast-drafts'],
  ['upcoming-bills'], ['debts'], ['debt-schedule'], ['payoff'], ['assets'],
  ['net-worth'], ['net-worth-series'], ['cash-history'], ['financial-health'],
  ['annual-report'], ['goal-contributions'], ['search', 'transactions'],
  ['ai-month-stats'], ['month-lines'], ['month-summary'], ['month-breakdown'], ['default-account'],
] as const;

export function invalidateKeys(client: QueryClient, keys: readonly (readonly string[])[]) {
  return Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
}

export function invalidateFinance(client: QueryClient) {
  return invalidateKeys(client, FINANCE_KEYS);
}

/** The agent response does not identify changed tables; refresh its writable domains. */
export function invalidateAgentData(client: QueryClient) {
  return invalidateKeys(client, [...FINANCE_KEYS, ['notes'], ['reminders'], ['search'], ['plan-status']]);
}

/** Native suspension can lose realtime even while the cache is within staleTime. */
export function createNativeQueryFocusHandler(client: QueryClient, initialState: string | null) {
  let previousState = initialState;
  return (state: string) => {
    const resumed = state === 'active' && (previousState === 'background' || previousState === 'inactive');
    previousState = state;
    focusManager.setFocused(state === 'active');
    // An initial/duplicate active event is not a resume. Query mounts own the initial fetch.
    // Native automatic window-focus refetch is disabled, so only this request owns recovery.
    if (resumed) return client.refetchQueries({ type: 'active' }, { cancelRefetch: true });
    return Promise.resolve();
  };
}

const realtimeRefreshes = new WeakMap<QueryClient, { dirty: boolean; promise: Promise<void> }>();

/** Batch row notifications; a notification during the read always schedules a trailing read. */
export function scheduleRealtimeFinanceRefresh(client: QueryClient): Promise<void> {
  const pending = realtimeRefreshes.get(client);
  if (pending) {
    pending.dirty = true;
    return pending.promise;
  }
  const state = { dirty: true, promise: Promise.resolve() };
  state.promise = (async () => {
    try {
      while (state.dirty) {
        // Fixed window from the first event; ongoing events cannot postpone it indefinitely.
        await new Promise((resolve) => setTimeout(resolve, 50));
        state.dirty = false;
        await invalidateFinance(client);
      }
    } finally {
      realtimeRefreshes.delete(client);
    }
  })();
  realtimeRefreshes.set(client, state);
  return state.promise;
}
