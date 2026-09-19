import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readRoute = (route: string) => readFileSync(`src/app/finance/${route}.tsx`, 'utf8');

test('task list routes keep compact content and expose measured tablet workspaces', () => {
  for (const [route, testId] of [
    ['installments', 'installments-tablet-workspace'],
    ['recurring', 'recurring-tablet-workspace'],
    ['rules', 'rules-tablet-workspace'],
    ['plan', 'plan-tablet-workspace'],
  ] as const) {
    const source = readRoute(route);
    assert.match(source, /useAdaptiveWindow/);
    assert.match(source, /const tablet = windowClass !== 'compact'/);
    assert.match(source, /<Screen[\s\S]*wide=\{tablet\}/);
    assert.doesNotMatch(source, /headerLargeTitle/);
    assert.match(source, /<AdaptivePanes/);
    assert.match(source, /singlePaneContent=\{compactBody\}/);
    assert.match(source, new RegExp(`testID="${testId}"`));
  }
});

test('task surfaces preserve their mutation and navigation contracts', () => {
  const installments = readRoute('installments');
  assert.match(installments, /useUpdateInstallmentPlan\(\)/);
  assert.match(installments, /useDeleteInstallmentPlan\(\)/);
  assert.match(installments, /label="Salvar"/);
  assert.match(installments, /confirmDestructive/);

  const recurring = readRoute('recurring');
  assert.match(recurring, /useCreateRecurring\(\)/);
  assert.match(recurring, /useSaveRecurringSeries\(\)/);
  assert.match(recurring, /useDeleteRecurring\(\)/);
  assert.match(recurring, /label=\{form\?\.id \? 'Salvar' : 'Criar'\}/);

  const rules = readRoute('rules');
  assert.match(rules, /useSaveRule\(\)/);
  assert.match(rules, /useDeleteRule\(\)/);
  assert.match(rules, /label="Salvar"/);

  const plan = readRoute('plan');
  assert.match(plan, /useCancelSubscription\(\)/);
  assert.match(plan, /confirmarCancelamento/);
  assert.match(plan, /confirmDestructive/);

  const manage = readRoute('manage');
  assert.match(manage, /router\.push\(item\.href\)/);
  assert.match(manage, /href: '\/finance\/plan'/);
});

test('transaction form stays a bounded keyboard aware single column', () => {
  const source = readRoute('transaction-form');
  assert.match(source, /useAdaptiveWindow/);
  assert.match(source, /<Screen scroll=\{false\} wide=\{tablet\}/);
  assert.match(source, /KeyboardAwareScrollView/);
  assert.match(source, /maxWidth: MaxContentWidth/);
  assert.doesNotMatch(source, /<AdaptivePanes/);
  assert.match(source, /showItemActions\(/);
  assert.match(source, /confirmDestructive\(/);
});
