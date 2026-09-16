import { focusManager, type QueryClient } from '@tanstack/react-query';

/** Financial writes can change ledger-derived RPCs across months and screens. */
export const FINANCE_KEYS = [
  ['transactions'], ['tx-summary'], ['monthly-cashflow'], ['account-balances'],
  ['budgets-status'], ['accounts'], ['goals'], ['budgets'], ['recurring'],
  ['card-summary'], ['invoice'], ['card-invoices'], ['installments'], ['forecast'], ['forecast-drafts'],
  /*
    ⚠️ **`upcoming-card-charges` faltou aqui no dia em que nasceu** (16/09/2026), e o sintoma foi
    imediato: editar a data do `Wardogs (1/2)` para anteontem gravou certo no banco e a Hoje
    continuou mostrando a compra em "Vai cair no cartão". Toda escrita financeira invalida as 30+
    chaves desta lista; a que não está aqui só se conserta com o app reiniciando.
    `refresh-consistency.test.ts` passou a comparar esta lista com as chaves reais de
    `use-finance.ts` — era a terceira vez que uma chave nova ficava de fora (ver o bloco do CICLO
    abaixo e a nota de `budgets-status` em `finance.md`).
  */
  ['upcoming-bills'], ['upcoming-card-charges'], ['debts'], ['debt-schedule'], ['payoff'], ['assets'],
  ['net-worth'], ['net-worth-series'], ['cash-history'], ['financial-health'],
  ['annual-report'], ['goal-contributions'], ['search', 'transactions'],
  ['ai-month-stats'], ['month-lines'], ['month-summary'], ['month-breakdown'], ['default-account'],
  /*
    ⚠️ **As chaves de CICLO faltavam aqui, e elas são o número grande das duas raízes.**
    `markPaid` e `pay_invoice` não atualizavam nenhum dos dois heróis pelo caminho otimista —
    funcionava só porque `useRealtimeMonth` reinscreve as chaves no canal de realtime, ou seja,
    dependia de o websocket estar de pé. Dar baixa numa conta offline deixava o número velho na
    tela até o próximo foco.
  */
  ['cycle'], ['cycle-series'], ['cycle-lines'], ['cycle-range'], ['forecast-months'], ['spendable'],
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
