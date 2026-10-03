import { useCategoryClassificationDefaults } from '@/hooks/use-finance';
import { foldCategory } from '@/lib/categories-merge';
import { resolveExpenseClassification, type ExpenseClassification } from '@/lib/expense-classification';

/** One resolved snapshot feeds the field, preview, save and format-switch draft. */
export function useExpenseClassificationDraft(
  draft: ExpenseClassification | undefined,
  category: string | null,
  kind: 'expense' | 'income' | 'transfer',
  editing: boolean,
  recordWorkspaceId?: string,
) {
  const needsConfiguration = kind === 'expense' && Boolean(category) && (!editing || Boolean(recordWorkspaceId));
  const query = useCategoryClassificationDefaults(recordWorkspaceId, needsConfiguration);
  const defaults = needsConfiguration && query.isSuccess && category
    ? query.data.find(row => foldCategory(row.category) === foldCategory(category))
    : undefined;
  const classification = resolveExpenseClassification(draft, defaults, kind, !editing && query.isSuccess);
  return {
    classification,
    defaults,
    // Editing never adopts defaults implicitly; an unknown record workspace is never replaced by the default one.
    ready: editing || !needsConfiguration || query.isSuccess,
    isError: needsConfiguration && query.isError,
    refetch: query.refetch,
    adoptCategoryDefaults: () => {
      if (!query.isSuccess || (editing && !recordWorkspaceId)) throw new Error('Não consegui conferir o padrão desta categoria. Tente de novo.');
      return resolveExpenseClassification(undefined, defaults, kind, true);
    },
  };
}
