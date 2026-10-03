import {
  EXPENSE_PATTERNS, EXPENSE_NECESSITIES, EXPENSE_PATTERN_LABELS, EXPENSE_NECESSITY_LABELS,
  type ExpensePattern, type ExpenseNecessity,
} from './expense-classification.ts';

export type ExpensePatternFilter = ExpensePattern | 'not_informed';
export type ExpenseNecessityFilter = ExpenseNecessity | 'not_informed';
export const EXPENSE_PATTERN_FILTER_OPTIONS: readonly { id: ExpensePatternFilter; label: string }[] = [
  ...EXPENSE_PATTERNS.map(id => ({ id, label: EXPENSE_PATTERN_LABELS[id] })),
  { id: 'not_informed', label: 'Não informado' },
];
export const EXPENSE_NECESSITY_FILTER_OPTIONS: readonly { id: ExpenseNecessityFilter; label: string }[] = [
  ...EXPENSE_NECESSITIES.map(id => ({ id, label: EXPENSE_NECESSITY_LABELS[id] })),
  { id: 'not_informed', label: 'Não informado' },
];

function normalizeFilters<T extends string>(values: readonly unknown[] | undefined, options: readonly { id: T }[]): T[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new Error('Informe uma classificação de gasto válida para filtrar');
  const selected = new Set(values);
  for (const value of selected) {
    if (!options.some(option => option.id === value)) throw new Error('Informe uma classificação de gasto válida para filtrar');
  }
  return options.map(option => option.id).filter(id => selected.has(id));
}

export function normalizeExpensePatternFilters(values: readonly unknown[] | undefined): ExpensePatternFilter[] {
  return normalizeFilters(values, EXPENSE_PATTERN_FILTER_OPTIONS);
}
export function normalizeExpenseNecessityFilters(values: readonly unknown[] | undefined): ExpenseNecessityFilter[] {
  return normalizeFilters(values, EXPENSE_NECESSITY_FILTER_OPTIONS);
}

/** Invalid parameters reject the whole link; empty parameters mean no selection. */
function parseFilters<T extends string>(raw: string | string[] | undefined, normalize: (values: readonly unknown[]) => T[]): T[] | null {
  if (raw === undefined) return [];
  const params = typeof raw === 'string' ? [raw] : raw;
  if (!Array.isArray(params)) return null;
  const values: string[] = [];
  for (const value of params) {
    if (typeof value !== 'string') return null;
    if (value.trim()) values.push(...value.split(',').map(part => part.trim()));
  }
  try { return normalize(values); } catch { return null; }
}
export function parseExpensePatternFilters(raw: string | string[] | undefined): ExpensePatternFilter[] | null {
  return parseFilters(raw, normalizeExpensePatternFilters);
}
export function parseExpenseNecessityFilters(raw: string | string[] | undefined): ExpenseNecessityFilter[] | null {
  return parseFilters(raw, normalizeExpenseNecessityFilters);
}

/** Each dimension supplies its own closed OR group; callers combine dimensions by AND. */
function filterExpression(column: 'expense_pattern' | 'expense_necessity', values: readonly string[]): string | undefined {
  const known = values.filter(value => value !== 'not_informed');
  const conditions: string[] = [];
  if (known.length) conditions.push(`${column}.in.(${known.join(',')})`);
  if (values.includes('not_informed')) conditions.push(`${column}.is.null`);
  return conditions.length ? conditions.join(',') : undefined;
}
export function expensePatternFilterExpression(values: readonly ExpensePatternFilter[] | undefined): string | undefined {
  return filterExpression('expense_pattern', normalizeExpensePatternFilters(values));
}
export function expenseNecessityFilterExpression(values: readonly ExpenseNecessityFilter[] | undefined): string | undefined {
  return filterExpression('expense_necessity', normalizeExpenseNecessityFilters(values));
}
