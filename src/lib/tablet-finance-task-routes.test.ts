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
  assert.match(recurring, /useDeleteRecurring\(\)/);
  // o formulário da série é um corpo à parte (formulário único), hospedado na folha
  assert.match(recurring, /<FormularioDaSerie/);
  const serie = readFileSync('src/components/finance/formulario-da-serie.tsx', 'utf8');
  assert.match(serie, /useCreateRecurring\(\)/);
  assert.match(serie, /useSaveRecurringSeries\(\)/);
  assert.match(serie, /form\.id \|\| converter \? 'Salvar' : 'Criar'/);

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
  // o formulário mora no corpo (`FormularioDoLancamento`); a rota só espera o registro e o monta
  const source = readRoute('transaction-form') + readFileSync('src/components/finance/formulario-do-lancamento.tsx', 'utf8');
  assert.match(source, /useAdaptiveWindow/);
  assert.match(source, /<Screen scroll=\{false\} wide=\{tablet\}/);
  assert.match(source, /KeyboardAwareScrollView/);
  assert.match(source, /maxWidth: MaxContentWidth/);
  assert.doesNotMatch(source, /<AdaptivePanes/);
  assert.match(source, /askEditScope\(/);
  assert.match(source, /confirmDestructive\(/);
});
