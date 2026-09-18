import type { QueryClient } from '@tanstack/react-query';

const iso = (day: Date) =>
  `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

/** Cache-only fixtures for visual QA of the real Projeção and Patrimônio routes. */
export function seedFinanceAnalysisPreview(client: Pick<QueryClient, 'getQueryData' | 'setQueryData'>, today: Date) {
  const month = iso(today).slice(0, 7);
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
