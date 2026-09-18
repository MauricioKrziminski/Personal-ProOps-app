import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readRoute = (route: string) => readFileSync(`src/app/finance/${route}.tsx`, 'utf8');

test('budgets keeps the compact reading order and exposes category context in a measured tablet split', () => {
  const source = readRoute('budgets');

  assert.match(source, /useAdaptiveWindow/);
  assert.match(source, /const tablet = windowClass !== 'compact'/);
  assert.match(source, /<Screen[\s\S]*wide=\{tablet\}/);
  assert.match(source, /headerLargeTitle: !tablet/);
  assert.match(source, /<AdaptivePanes/);
  assert.match(source, /main=\{budgetList\}/);
  assert.match(source, /support=\{[^}]+\? budgetContext : undefined\}/);
  assert.match(source, /singlePaneContent=\{compactBody\}/);
  assert.match(source, /testID="budgets-tablet-workspace"/);
  assert.match(source, /useBudgetsStatus\(month, regua\.view\)/);
  assert.match(source, /useSaveBudget\(\)/);
  assert.match(source, /useDeleteBudget\(\)/);
  assert.match(source, /verLancamentos\(b\.category\)/);
  assert.match(source, /setForm\(null\)/);
});

test('goals keeps contribution and archive actions while placing the aggregate beside the goal list on tablets', () => {
  const source = readRoute('goals');

  assert.match(source, /useAdaptiveWindow/);
  assert.match(source, /const tablet = windowClass !== 'compact'/);
  assert.match(source, /<Screen[\s\S]*wide=\{tablet\}/);
  assert.match(source, /headerLargeTitle: !tablet/);
  assert.match(source, /<AdaptivePanes/);
  assert.match(source, /main=\{goalList\}/);
  assert.match(source, /support=\{[^}]+\? goalSummary : undefined\}/);
  assert.match(source, /singlePaneContent=\{compactBody\}/);
  assert.match(source, /testID="goals-tablet-workspace"/);
  assert.match(source, /useGoalDeposit\(\)/);
  assert.match(source, /label="Guardar"/);
  assert.match(source, /label="Retirar"/);
  assert.match(source, /confirmDestructive/);
  assert.match(source, /setForm\(null\)/);
});

test('debts keeps payment and destructive confirmations while putting payoff strategy beside the debt list on tablets', () => {
  const source = readRoute('debts');

  assert.match(source, /useAdaptiveWindow/);
  assert.match(source, /const tablet = windowClass !== 'compact'/);
  assert.match(source, /<Screen[\s\S]*wide=\{tablet\}/);
  assert.match(source, /headerLargeTitle: !tablet/);
  assert.match(source, /<AdaptivePanes/);
  assert.match(source, /main=\{debtList\}/);
  assert.match(source, /support=\{[^}]+\? debtContext : undefined\}/);
  assert.match(source, /singlePaneContent=\{compactBody\}/);
  assert.match(source, /testID="debts-tablet-workspace"/);
  assert.match(source, /usePayDebtInstallment\(\)/);
  assert.match(source, /pagar\.mutate/);
  assert.match(source, /confirmarPagamento/);
  assert.match(source, /confirmDestructive/);
  assert.match(source, /setForm\(null\)/);
});
