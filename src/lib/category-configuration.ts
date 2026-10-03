import type { IconName } from '@/components/ui/icon';
import type { NoteColorName } from '@/constants/theme';
import type { Categoria } from './categorias.ts';
import { brToISO, isValidBRDate } from './dates.ts';
import type { ExpensePattern, ExpenseNecessity } from './expense-classification.ts';

export type CategoryConfigurationInput = {
  name: string;
  icon: IconName | null;
  color: NoteColorName | null;
  renomearDe?: string | null;
  juntar?: boolean;
  default_expense_pattern: ExpensePattern | null;
  default_expense_necessity: ExpenseNecessity | null;
  configurationId?: string | null;
  expectedRevision?: number | null;
  backfill?: { from: string; to: string } | null;
  requestId: string;
};

export type CategoryConfigurationResult = {
  category: string;
  configuration_id: string;
  edit_revision: number;
  default_expense_pattern: ExpensePattern | null;
  default_expense_necessity: ExpenseNecessity | null;
  juntou: boolean;
  orcamentos_descartados: number;
  backfill_updated: number;
};

export function categoryDefaults(category?: Pick<Categoria, 'configuration_id' | 'default_expense_pattern' | 'default_expense_necessity'> | null) {
  return {
    default_expense_pattern: category?.configuration_id ? category.default_expense_pattern ?? null : null,
    default_expense_necessity: category?.configuration_id ? category.default_expense_necessity ?? null : null,
  };
}

/** Invalid/partial dates stay in the draft; they never become an unbounded historical write. */
export function categoryBackfillPeriod(fromBR: string, toBR: string): { from: string; to: string } | null {
  if (!isValidBRDate(fromBR) || !isValidBRDate(toBR)) return null;
  const from = brToISO(fromBR); const to = brToISO(toBR);
  return to < from ? null : { from, to };
}

export type CategoryConfigurationAttempt = { key: string; requestId: string };
export function categoryConfigurationKey(input: Omit<CategoryConfigurationInput, 'requestId'>): string {
  return JSON.stringify({
    name: input.name, icon: input.icon, color: input.color,
    renomearDe: input.renomearDe ?? null, juntar: input.juntar ?? false,
    default_expense_pattern: input.default_expense_pattern, default_expense_necessity: input.default_expense_necessity,
    configurationId: input.configurationId ?? null, expectedRevision: input.expectedRevision ?? null,
    backfill: input.backfill ? { from: input.backfill.from, to: input.backfill.to } : null,
  });
}
export function categoryConfigurationAttempt(
  previous: CategoryConfigurationAttempt | null,
  input: Omit<CategoryConfigurationInput, 'requestId'>,
  newId: () => string,
): CategoryConfigurationAttempt {
  const key = categoryConfigurationKey(input);
  return previous?.key === key ? previous : { key, requestId: newId() };
}
