import type { SaldoDeConta } from '../lib/account-cash';

/** Full account_balances shape: preview data must exercise the real cash arithmetic. */
export const previewAccountBalances: SaldoDeConta[] = [
  {
    account_id: 'prev-a1',
    name: 'Conta corrente',
    type: 'checking',
    balance_cents: 892040,
    cleared_cents: 892040,
    pending_in_cents: 0,
    pending_out_cents: 0,
  },
  {
    account_id: 'prev-a2',
    name: 'Carteira',
    type: 'cash',
    balance_cents: 12000,
    cleared_cents: 12000,
    pending_in_cents: 0,
    pending_out_cents: 0,
  },
];
