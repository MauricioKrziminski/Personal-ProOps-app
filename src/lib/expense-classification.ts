export const EXPENSE_PATTERNS = Object.freeze(['fixed', 'variable'] as const);
export const EXPENSE_NECESSITIES = Object.freeze(['essential', 'discretionary'] as const);
export const CLASSIFICATION_SOURCES = Object.freeze(['explicit', 'category_default'] as const);
export type ExpensePattern = (typeof EXPENSE_PATTERNS)[number];
export type ExpenseNecessity = (typeof EXPENSE_NECESSITIES)[number];
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];
export type ExpenseClassification = {
  expense_pattern: ExpensePattern | null;
  expense_pattern_source: ClassificationSource | null;
  expense_necessity: ExpenseNecessity | null;
  expense_necessity_source: ClassificationSource | null;
};
export type ExpenseClassificationDefaults = {
  default_expense_pattern?: ExpensePattern | null;
  default_expense_necessity?: ExpenseNecessity | null;
};
export const EXPENSE_PATTERN_LABELS: Readonly<Record<ExpensePattern, string>> = Object.freeze({
  fixed: 'Fixo', variable: 'Variável',
});
export const EXPENSE_NECESSITY_LABELS: Readonly<Record<ExpenseNecessity, string>> = Object.freeze({
  essential: 'Essencial', discretionary: 'Não essencial',
});
export const UNKNOWN_EXPENSE_CLASSIFICATION: Readonly<ExpenseClassification> = Object.freeze({
  expense_pattern: null, expense_pattern_source: null,
  expense_necessity: null, expense_necessity_source: null,
});
const classificationKeys = Object.keys(UNKNOWN_EXPENSE_CLASSIFICATION);

function invalidClassification(): never {
  throw new Error('Classificação de gasto inválida');
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return invalidClassification();
  return value;
}
function nullableEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (value === undefined || value === null) return null;
  for (const candidate of allowed) if (value === candidate) return candidate;
  return invalidClassification();
}
function validatePair(value: string | null, source: ClassificationSource | null): void {
  if ((value !== null && source === null) || (value === null && source === 'category_default')) invalidClassification();
}

/** Closed write payload. Missing fields are unknown, never inferred from metadata. */
export function normalizeExpenseClassification(raw: unknown): ExpenseClassification {
  if (raw === undefined || raw === null) return { ...UNKNOWN_EXPENSE_CLASSIFICATION };
  const input = record(raw);
  if (Reflect.ownKeys(input).some((key) => typeof key !== 'string' || !classificationKeys.includes(key))) return invalidClassification();
  const expense_pattern = nullableEnum(input.expense_pattern, EXPENSE_PATTERNS);
  const expense_pattern_source = nullableEnum(input.expense_pattern_source, CLASSIFICATION_SOURCES);
  const expense_necessity = nullableEnum(input.expense_necessity, EXPENSE_NECESSITIES);
  const expense_necessity_source = nullableEnum(input.expense_necessity_source, CLASSIFICATION_SOURCES);
  validatePair(expense_pattern, expense_pattern_source);
  validatePair(expense_necessity, expense_necessity_source);
  return { expense_pattern, expense_pattern_source, expense_necessity, expense_necessity_source };
}

/** Read adapter for database records, including legacy rows without these columns. */
export function expenseClassificationFromRecord(raw: unknown): ExpenseClassification {
  if (raw === undefined || raw === null) return { ...UNKNOWN_EXPENSE_CLASSIFICATION };
  const input = record(raw);
  return normalizeExpenseClassification({
    expense_pattern: input.expense_pattern,
    expense_pattern_source: input.expense_pattern_source,
    expense_necessity: input.expense_necessity,
    expense_necessity_source: input.expense_necessity_source,
  });
}

/** Category defaults are a creation-time snapshot; explicit choices always prevail. */
export function resolveExpenseClassification(
  draft: unknown, defaults: unknown, kind: string, applyDefaults: boolean,
): ExpenseClassification {
  if (kind !== 'expense' && kind !== 'income' && kind !== 'transfer') return invalidClassification();
  if (typeof applyDefaults !== 'boolean') return invalidClassification();
  if (kind !== 'expense') return { ...UNKNOWN_EXPENSE_CLASSIFICATION };
  const current = normalizeExpenseClassification(draft);
  if (!applyDefaults) return current;
  const input = defaults === undefined || defaults === null ? {} : record(defaults);
  const pattern = nullableEnum(input.default_expense_pattern, EXPENSE_PATTERNS);
  const necessity = nullableEnum(input.default_expense_necessity, EXPENSE_NECESSITIES);
  return {
    expense_pattern: current.expense_pattern_source === 'explicit' ? current.expense_pattern : pattern,
    expense_pattern_source: current.expense_pattern_source === 'explicit' ? 'explicit' : pattern === null ? null : 'category_default',
    expense_necessity: current.expense_necessity_source === 'explicit' ? current.expense_necessity : necessity,
    expense_necessity_source: current.expense_necessity_source === 'explicit' ? 'explicit' : necessity === null ? null : 'category_default',
  };
}

export function selectExpenseClassification(draft: unknown, dimension: 'pattern', value: ExpensePattern | null): ExpenseClassification;
export function selectExpenseClassification(draft: unknown, dimension: 'necessity', value: ExpenseNecessity | null): ExpenseClassification;
export function selectExpenseClassification(
  draft: unknown, dimension: 'pattern' | 'necessity', value: ExpensePattern | ExpenseNecessity | null,
): ExpenseClassification {
  const current = normalizeExpenseClassification(draft);
  if (value === undefined) return invalidClassification();
  if (dimension === 'pattern') return { ...current, expense_pattern: nullableEnum(value, EXPENSE_PATTERNS), expense_pattern_source: 'explicit' };
  if (dimension === 'necessity') return { ...current, expense_necessity: nullableEnum(value, EXPENSE_NECESSITIES), expense_necessity_source: 'explicit' };
  return invalidClassification();
}

/** Each changed dimension publishes its complete pair; omitted dimensions stay untouched. */
export function expenseClassificationPatch(before: unknown, after: unknown): Partial<ExpenseClassification> {
  const previous = normalizeExpenseClassification(before);
  const next = normalizeExpenseClassification(after);
  const patch: Partial<ExpenseClassification> = {};
  if (previous.expense_pattern !== next.expense_pattern || previous.expense_pattern_source !== next.expense_pattern_source) {
    patch.expense_pattern = next.expense_pattern;
    patch.expense_pattern_source = next.expense_pattern_source;
  }
  if (previous.expense_necessity !== next.expense_necessity || previous.expense_necessity_source !== next.expense_necessity_source) {
    patch.expense_necessity = next.expense_necessity;
    patch.expense_necessity_source = next.expense_necessity_source;
  }
  return patch;
}
export function expenseClassificationSummary(raw: unknown): string {
  const classification = normalizeExpenseClassification(raw);
  const labels: string[] = [];
  if (classification.expense_pattern !== null) labels.push(EXPENSE_PATTERN_LABELS[classification.expense_pattern]);
  if (classification.expense_necessity !== null) labels.push(EXPENSE_NECESSITY_LABELS[classification.expense_necessity]);
  return labels.length ? labels.join(' · ') : 'Não classificado';
}
