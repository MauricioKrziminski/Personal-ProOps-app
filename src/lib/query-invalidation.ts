import { focusManager, type QueryClient } from '@tanstack/react-query';

/** Financial writes can change ledger-derived RPCs across months and screens. */
export const FINANCE_KEYS = [
  ['transactions'], ['tx-summary'], ['daily-spending'], ['monthly-cashflow'], ['account-balances'],
  ['budgets-status'], ['accounts'], ['goals'], ['budgets'], ['recurring'],
  ['card-summary'], ['card-limit-context'], ['invoice'], ['card-invoices'], ['installments'], ['forecast'], ['simular'], ['accounts-horizon'], ['cards-horizon'], ['anticipation-candidates'],
  /*
    ⚠️ **`upcoming-card-charges` faltou aqui no dia em que nasceu** (16/09/2026), e o sintoma foi
    imediato: editar a data do `Wardogs (1/2)` para anteontem gravou certo no banco e a Hoje
    continuou mostrando a compra em "Vai cair no cartão". Toda escrita financeira invalida as 30+
    chaves desta lista; a que não está aqui só se conserta com o app reiniciando.
    `refresh-consistency.test.ts` passou a comparar esta lista com as chaves reais de
    `use-finance.ts` — era a terceira vez que uma chave nova ficava de fora (ver o bloco do CICLO
    abaixo e a nota de `budgets-status` em `finance.md`).
  */
  ['upcoming-bills'], ['upcoming-card-charges'], ['debts'], ['debt-schedule'],
  ['debt-payments'], ['debt-payment-versions'], ['debt-declared-estimates'], ['payoff'], ['assets'],
  ['net-worth'], ['net-worth-series'], ['cash-history'], ['financial-health'],
  ['annual-report'], ['goal-contributions'], ['search', 'transactions'],
  ['ai-month-stats'], ['month-lines'], ['month-summary'], ['month-breakdown'], ['default-account'],
  ['ledger-expected'], ['finance-write-preview'],
  ['category-classification-defaults'],
  /*
    ⚠️ **As chaves de CICLO faltavam aqui, e elas são o número grande das duas raízes.**
    `markPaid` e `pay_invoice` não atualizavam nenhum dos dois heróis pelo caminho otimista —
    funcionava só porque `useRealtimeMonth` reinscreve as chaves no canal de realtime, ou seja,
    dependia de o websocket estar de pé. Dar baixa numa conta offline deixava o número velho na
    tela até o próximo foco.
  */
  ['cycle'], ['cycle-series'], ['cycle-lines'], ['cycle-range'], ['forecast-months'], ['spendable'],
  // A citação do Financeiro (`agent-activity`) mostra o registro ATUAL: editar pelo app a renova.
  ['agent-activity'],
  // O Próximo passo da Hoje conta importações e compras parceladas: importar a fatura ou lançar
  // a parcelada tira o passo na hora (`import_batches` nem está na publicação do realtime).
  ['proximo-passo'],
] as const;

/**
 * Marcadas velhas, mas SEM recalcular ali. A `simular` numa escrita vinda do "Aplicar" ainda tem
 * a hipótese no rascunho E já gravada de verdade: refeita agora, contaria a mesma coisa duas vezes
 * (~2 s na tela, 29/09/2026). Ela recalcula quando o rascunho muda (chave nova) ou a tela volta.
 */
const SEM_RECALCULAR = new Set(['simular']);

export function invalidateKeys(client: QueryClient, keys: readonly (readonly string[])[]) {
  return Promise.all(
    keys.map((queryKey) =>
      client.invalidateQueries(SEM_RECALCULAR.has(queryKey[0]) ? { queryKey, refetchType: 'none' } : { queryKey }),
    ),
  );
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
