import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expenseClassificationFromRecord, expenseClassificationPatch, expenseClassificationSummary,
  normalizeExpenseClassification, resolveExpenseClassification, selectExpenseClassification,
  UNKNOWN_EXPENSE_CLASSIFICATION,
} from './expense-classification.ts';

const rentDefaults = { default_expense_pattern: 'fixed', default_expense_necessity: 'essential' } as const;
const marketDefaults = { default_expense_pattern: 'variable', default_expense_necessity: 'essential' } as const;

test('classificação desconhecida não inventa previsibilidade, necessidade ou origem', () => {
  for (const input of [undefined, null, {}, UNKNOWN_EXPENSE_CLASSIFICATION]) {
    assert.deepEqual(normalizeExpenseClassification(input), {
      expense_pattern: null, expense_pattern_source: null,
      expense_necessity: null, expense_necessity_source: null,
    });
  }
  assert.deepEqual(expenseClassificationFromRecord({ description: 'assinatura', rrule: 'FREQ=MONTHLY' }), UNKNOWN_EXPENSE_CLASSIFICATION);
});

test('as quatro combinações são decisões independentes', () => {
  for (const pattern of ['fixed', 'variable'] as const) {
    for (const necessity of ['essential', 'discretionary'] as const) {
      const patternOnly = selectExpenseClassification(UNKNOWN_EXPENSE_CLASSIFICATION, 'pattern', pattern);
      assert.equal(patternOnly.expense_necessity, null);
      const both = selectExpenseClassification(patternOnly, 'necessity', necessity);
      assert.deepEqual(both, {
        expense_pattern: pattern, expense_pattern_source: 'explicit',
        expense_necessity: necessity, expense_necessity_source: 'explicit',
      });
    }
  }
});

test('criar gasto aplica snapshots de defaults separados e deixa ausência desconhecida', () => {
  assert.deepEqual(resolveExpenseClassification(undefined, rentDefaults, 'expense', true), {
    expense_pattern: 'fixed', expense_pattern_source: 'category_default',
    expense_necessity: 'essential', expense_necessity_source: 'category_default',
  });
  assert.deepEqual(resolveExpenseClassification(undefined, { default_expense_pattern: 'variable' }, 'expense', true), {
    expense_pattern: 'variable', expense_pattern_source: 'category_default',
    expense_necessity: null, expense_necessity_source: null,
  });
  assert.deepEqual(resolveExpenseClassification(undefined, undefined, 'expense', true), UNKNOWN_EXPENSE_CLASSIFICATION);
});

test('override de uma dimensão vence default sem apagar a outra sugestão', () => {
  const suggested = resolveExpenseClassification(undefined, rentDefaults, 'expense', true);
  const overridden = selectExpenseClassification(suggested, 'necessity', 'discretionary');
  const changedCategory = resolveExpenseClassification(overridden, marketDefaults, 'expense', true);
  assert.deepEqual(changedCategory, {
    expense_pattern: 'variable', expense_pattern_source: 'category_default',
    expense_necessity: 'discretionary', expense_necessity_source: 'explicit',
  });
  assert.equal(suggested.expense_necessity, 'essential');
  assert.equal(overridden.expense_pattern, 'fixed');
});

test('Não classificar explícito impede preenchimento e não limpa a outra dimensão', () => {
  const suggested = resolveExpenseClassification(undefined, rentDefaults, 'expense', true);
  const cleared = selectExpenseClassification(suggested, 'pattern', null);
  assert.deepEqual(resolveExpenseClassification(cleared, marketDefaults, 'expense', true), {
    expense_pattern: null, expense_pattern_source: 'explicit',
    expense_necessity: 'essential', expense_necessity_source: 'category_default',
  });
});

test('editar legado ou registro conhecido não reaplica padrão atual da categoria', () => {
  const old = resolveExpenseClassification(undefined, rentDefaults, 'expense', true);
  assert.deepEqual(resolveExpenseClassification(old, marketDefaults, 'expense', false), old);
  assert.deepEqual(resolveExpenseClassification(undefined, rentDefaults, 'expense', false), UNKNOWN_EXPENSE_CLASSIFICATION);
});

test('trocar/remover defaults só muda sugestões no rascunho de criação', () => {
  const old = resolveExpenseClassification(undefined, rentDefaults, 'expense', true);
  assert.deepEqual(resolveExpenseClassification(old, undefined, 'expense', true), UNKNOWN_EXPENSE_CLASSIFICATION);
  const manual = selectExpenseClassification(old, 'pattern', 'variable');
  assert.deepEqual(resolveExpenseClassification(manual, undefined, 'expense', true), {
    expense_pattern: 'variable', expense_pattern_source: 'explicit',
    expense_necessity: null, expense_necessity_source: null,
  });
});

test('receita e transferência não ganham classificação de consumo', () => {
  const classified = resolveExpenseClassification(undefined, rentDefaults, 'expense', true);
  for (const kind of ['income', 'transfer']) {
    assert.deepEqual(resolveExpenseClassification(classified, rentDefaults, kind, true), UNKNOWN_EXPENSE_CLASSIFICATION);
  }
});

test('patch só publica as duas colunas da dimensão alterada, inclusive limpeza', () => {
  const old = resolveExpenseClassification(undefined, rentDefaults, 'expense', true);
  assert.deepEqual(expenseClassificationPatch(old, old), {});
  const changed = selectExpenseClassification(old, 'pattern', null);
  assert.deepEqual(expenseClassificationPatch(old, changed), { expense_pattern: null, expense_pattern_source: 'explicit' });
  const sameValueExplicit = selectExpenseClassification(old, 'necessity', 'essential');
  assert.deepEqual(expenseClassificationPatch(old, sameValueExplicit), {
    expense_necessity: 'essential', expense_necessity_source: 'explicit',
  });
});

test('resumo usa palavras humanas e distingue desconhecido sem converter null em não essencial', () => {
  assert.equal(expenseClassificationSummary(UNKNOWN_EXPENSE_CLASSIFICATION), 'Não classificado');
  assert.equal(expenseClassificationSummary(resolveExpenseClassification(undefined, rentDefaults, 'expense', true)), 'Fixo · Essencial');
  assert.equal(expenseClassificationSummary(selectExpenseClassification(UNKNOWN_EXPENSE_CLASSIFICATION, 'necessity', 'discretionary')), 'Não essencial');
});

test('valores, origens, pares inválidos e payload aberto são rejeitados', () => {
  const invalid = [
    [], 'fixed', { expense_pattern: 'monthly' },
    { expense_pattern: 'fixed' },
    { expense_pattern: 'fixed', expense_pattern_source: 'recurring' },
    { expense_pattern: null, expense_pattern_source: 'category_default' },
    { expense_necessity: false },
    { expense_necessity: 'essential', expense_necessity_source: null },
    { expense_necessity_source: 'guessed' }, { essential: true },
  ];
  for (const input of invalid) assert.throws(() => normalizeExpenseClassification(input), /classifica/i);
  assert.throws(() => resolveExpenseClassification(undefined, { default_expense_pattern: 'monthly' }, 'expense', true), /classifica/i);
  assert.throws(() => selectExpenseClassification(UNKNOWN_EXPENSE_CLASSIFICATION, 'pattern', 'essential' as never), /classifica/i);
});
