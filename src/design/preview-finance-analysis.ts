import type { QueryClient } from '@tanstack/react-query';

const iso = (day: Date) =>
  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

/** Cache-only fixtures for visual QA of the real Projeção and Patrimônio routes. */
export function seedFinanceAnalysisPreview(client: Pick<QueryClient, 'getQueryData' | 'setQueryData'>, today: Date) {
  const month = iso(today).slice(0, 7);
  const year = today.getFullYear();
  client.setQueryData(['transactions', 'first-year'], year - 1);
  client.setQueryData(['annual-report', String(year)], {
    summary: {
      income_cents: 7_200_000, expense_cents: 5_200_000, balance_cents: 2_000_000,
      savings_rate: 27.8, tx_count: 148,
    },
    categories: [
      { category: 'Moradia', kind: 'expense', total_cents: 3_200_000, tx_count: 32 },
      { category: 'Alimentação', kind: 'expense', total_cents: 1_300_000, tx_count: 74 },
      { category: 'Transporte', kind: 'expense', total_cents: 700_000, tx_count: 18 },
      { category: 'Salário', kind: 'income', total_cents: 6_000_000, tx_count: 12 },
      { category: 'Freelance', kind: 'income', total_cents: 1_200_000, tx_count: 12 },
    ],
    yearEnd: [
      { kind: 'account', name: 'Conta corrente', balance_cents: 1_200_000 },
      { kind: 'asset', name: 'Tesouro Selic', balance_cents: 4_500_000 },
    ],
  });
  client.setQueryData(['annual-report', String(year - 1)], {
    summary: {
      income_cents: 6_000_000, expense_cents: 4_800_000, balance_cents: 1_200_000,
      savings_rate: 20, tx_count: 112,
    },
    categories: [
      { category: 'Moradia', kind: 'expense', total_cents: 3_000_000, tx_count: 28 },
      { category: 'Outros', kind: 'expense', total_cents: 1_800_000, tx_count: 64 },
      { category: 'Salário', kind: 'income', total_cents: 6_000_000, tx_count: 12 },
    ],
    yearEnd: [{ kind: 'account', name: 'Conta corrente', balance_cents: 850_000 }],
  });
  let balance = 391_000;
  const forecast = Array.from({ length: 91 }, (_, index) => {
    const income = index > 0 && index % 30 === 0 ? 900_000 : 0;
    const expense = index === 0 ? 0 : index % 7 === 0 ? 120_000 : 1_500;
    balance += income - expense;
    return {
      day: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + index)),
      balance_cents: balance,
      in_cents: income,
      out_cents: expense,
    };
  });
  client.setQueryData(['forecast', '90'], forecast);
  client.setQueryData(['cash-history', '90'], Array.from({ length: 7 }, (_, index) => ({
    day: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7 + index)),
    cents: 370_000 + index * 3_000,
  })));
  client.setQueryData(['upcoming-bills', '30'], [{
    ref_id: 'prev-aluguel', title: 'Aluguel',
    due_date: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7)),
    amount_cents: 120_000, kind: 'transaction', overdue: false,
  }]);

  // The current hook includes the cycle-view suffix; the older QA fixture did not.
  const summary = client.getQueryData(['month-summary', month]);
  if (summary) client.setQueryData(['month-summary', month, ''], summary);

  const cash = 391_000;
  const investments = 850_000;
  const otherAssets = 300_000;
  const liabilities = 251_000;
  const net = cash + investments + otherAssets - liabilities;
  client.setQueryData(['net-worth'], {
    cash_cents: cash,
    investments_cents: investments,
    other_assets_cents: otherAssets,
    liabilities_cents: liabilities,
    net_cents: net,
  });
  client.setQueryData(['net-worth-series', '12'], Array.from({ length: 12 }, (_, index) => ({
    month: iso(new Date(today.getFullYear(), today.getMonth() - 11 + index, 1)).slice(0, 7),
    net_cents: net - (11 - index) * 27_000,
  })));
  client.setQueryData(['financial-health'], {
    score: 74, savings_rate: 22, budget_adherence: 89,
    months_of_reserve: 4.2, debt_ratio: 13,
  });
  client.setQueryData(['assets'], [
    { id: 'prev-investment', name: 'Tesouro Selic', class: 'investment', is_liability: false,
      current_value_cents: investments, acquired_at: null, archived: false },
    { id: 'prev-car', name: 'Carro', class: 'vehicle', is_liability: false,
      current_value_cents: otherAssets, acquired_at: null, archived: false },
  ]);
}
