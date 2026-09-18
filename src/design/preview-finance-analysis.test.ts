import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';

import { seedFinanceAnalysisPreview } from './preview-finance-analysis.ts';

test('analysis QA seeds exact hook keys and internally consistent money', () => {
  const client = new QueryClient();
  client.setQueryData(['month-summary', '2026-09'], { recurring_covered_until: null });
  seedFinanceAnalysisPreview(client, new Date(2026, 8, 17, 12));

  const forecast = client.getQueryData<{ balance_cents: number; in_cents: number; out_cents: number }[]>(['forecast', '90'])!;
  assert.equal(forecast.length, 91);
  assert.equal(forecast[0].balance_cents, 391_000);
  for (let i = 1; i < forecast.length; i++) {
    assert.equal(
      forecast[i].balance_cents,
      forecast[i - 1].balance_cents + forecast[i].in_cents - forecast[i].out_cents,
    );
  }
  assert.ok(client.getQueryData(['cash-history', '90']));
  assert.ok(client.getQueryData(['upcoming-bills', '30']));
  assert.ok(client.getQueryData(['month-summary', '2026-09', '']));

  const worth = client.getQueryData<{
    cash_cents: number;
    investments_cents: number;
    other_assets_cents: number;
    liabilities_cents: number;
    net_cents: number;
  }>(['net-worth'])!;
  assert.equal(worth.net_cents,
    worth.cash_cents + worth.investments_cents + worth.other_assets_cents - worth.liabilities_cents);
  assert.equal(client.getQueryData<{ net_cents: number }[]>(['net-worth-series', '12'])!.at(-1)!.net_cents, worth.net_cents);
  assert.ok(client.getQueryData(['financial-health']));
  assert.ok(client.getQueryData(['assets']));
});
