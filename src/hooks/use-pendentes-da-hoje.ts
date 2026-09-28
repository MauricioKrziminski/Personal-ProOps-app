import { useBudgetsStatus, useUpcomingBills } from '@/hooks/use-finance';
import { localISODate, useTodayReminders } from '@/hooks/use-items';
import { pendentesDaHoje } from '@/lib/today-sections';

/**
 * O badge da aba Hoje — UM hook para as duas tab bars (a nativa do iOS e a pílula do Android).
 *
 * As duas tinham a mesma soma copiada, e as duas contavam receita prevista e lembrete que ficou
 * de outro dia. As consultas são as mesmas da tela: o TanStack serve do cache, sem requisição a
 * mais. A régua é `pendentesDaHoje`, com teste.
 */
export function usePendentesDaHoje(): number {
  const bills = useUpcomingBills(7);
  const reminders = useTodayReminders();
  const budgets = useBudgetsStatus();
  return pendentesDaHoje({
    contas: bills.data ?? [],
    lembretes: reminders.data ?? [],
    orcamentos: budgets.data ?? [],
    hoje: localISODate(),
  });
}
