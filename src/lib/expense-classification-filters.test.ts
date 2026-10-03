import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeExpensePatternFilters, normalizeExpenseNecessityFilters,
  parseExpensePatternFilters, parseExpenseNecessityFilters,
  expensePatternFilterExpression, expenseNecessityFilterExpression,
} from './expense-classification-filters.ts';

test('classificação deduplica e ordena cada dimensão sem alterar a escolha original', () => {
  const patterns = Object.freeze(['not_informed', 'variable', 'fixed', 'variable']);
  const necessities = Object.freeze(['not_informed', 'discretionary', 'essential', 'essential']);
  assert.deepEqual(normalizeExpensePatternFilters(patterns), ['fixed', 'variable', 'not_informed']);
  assert.deepEqual(normalizeExpenseNecessityFilters(necessities), ['essential', 'discretionary', 'not_informed']);
  assert.deepEqual(patterns, ['not_informed', 'variable', 'fixed', 'variable']);
  assert.deepEqual(necessities, ['not_informed', 'discretionary', 'essential', 'essential']);
  assert.deepEqual(normalizeExpensePatternFilters(undefined), []);
  assert.deepEqual(normalizeExpenseNecessityFilters([]), []);
});

test('dimensões fechadas recusam valores trocados, null, arrays esparsos e injeção', () => {
  for (const invalid of ['essential', 'FIXED', '', 'null', null, undefined, {}, 'fixed),kind.eq.income'])
    assert.throws(() => normalizeExpensePatternFilters(['fixed', invalid]), /classificação.*válid/i);
  for (const invalid of ['fixed', 'ESSENTIAL', '', null, undefined, {}, 'essential),id.not.is.null'])
    assert.throws(() => normalizeExpenseNecessityFilters(['essential', invalid]), /classificação.*válid/i);
  for (const normalize of [normalizeExpensePatternFilters, normalizeExpenseNecessityFilters]) {
    assert.throws(() => normalize(new Array(1)), /classificação.*válid/i);
    assert.throws(() => normalize(null as never), /classificação.*válid/i);
    assert.throws(() => normalize('fixed' as never), /classificação.*válid/i);
  }
});

test('links aceitam vírgulas ou parâmetros repetidos e produzem seleções canônicas', () => {
  assert.deepEqual(parseExpensePatternFilters([' variable, fixed ', 'not_informed', 'fixed']), ['fixed', 'variable', 'not_informed']);
  assert.deepEqual(parseExpenseNecessityFilters('discretionary, essential,not_informed'), ['essential', 'discretionary', 'not_informed']);
  for (const parse of [parseExpensePatternFilters, parseExpenseNecessityFilters]) {
    for (const raw of [undefined, '', ' ', [], ['', ' ']]) assert.deepEqual(parse(raw), []);
    assert.deepEqual(parse('not_informed'), ['not_informed']);
  }
});

test('um componente inválido bloqueia o link inteiro em vez de ampliar o recorte', () => {
  for (const raw of ['fixed,bad', 'essential', 'Fixed', 'fixed,,variable', ['fixed', 'bad'], 'null', 'fixed),id.not.is.null'])
    assert.equal(parseExpensePatternFilters(raw), null);
  for (const raw of ['essential,bad', 'fixed', 'Essential', 'essential,,discretionary', ['essential', 'bad']])
    assert.equal(parseExpenseNecessityFilters(raw), null);
  for (const parse of [parseExpensePatternFilters, parseExpenseNecessityFilters]) {
    assert.equal(parse(new Array(1)), null);
    assert.equal(parse([undefined] as never), null);
    assert.equal(parse(null as never), null);
  }
});

test('cada expressão reúne conhecidos e null por OR sem misturar dimensões', () => {
  assert.equal(expensePatternFilterExpression(undefined), undefined);
  assert.equal(expenseNecessityFilterExpression([]), undefined);
  assert.equal(expensePatternFilterExpression(['not_informed']), 'expense_pattern.is.null');
  assert.equal(expenseNecessityFilterExpression(['not_informed']), 'expense_necessity.is.null');
  assert.equal(expensePatternFilterExpression(['variable', 'fixed', 'fixed']), 'expense_pattern.in.(fixed,variable)');
  assert.equal(expenseNecessityFilterExpression(['not_informed', 'essential']), 'expense_necessity.in.(essential),expense_necessity.is.null');
  assert.equal(expensePatternFilterExpression(['not_informed', 'fixed']), 'expense_pattern.in.(fixed),expense_pattern.is.null');
  assert.equal(expenseNecessityFilterExpression(['discretionary', 'essential', 'not_informed']),
    'expense_necessity.in.(essential,discretionary),expense_necessity.is.null');
  assert.throws(() => expensePatternFilterExpression(['fixed),id.not.is.null'] as never), /classificação.*válid/i);
  assert.throws(() => expenseNecessityFilterExpression(['fixed'] as never), /classificação.*válid/i);
});
