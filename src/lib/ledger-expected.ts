/** An occurrence calculated for the visible period but absent from the transaction ledger. */
export interface ExpectedLedgerLine {
  origin: 'recurring' | 'debt_schedule' | 'debt_estimate';
  ref_id: string;
  due_date: string;
  amount_cents: number;
  kind: 'expense' | 'income';
  description: string;
  category: string | null;
  account_id: string | null;
  installment_no: number | null;
  installments_total: number | null;
  /** A first period inferred from legacy creation metadata rather than a saved start date. */
  inferred_start: boolean;
}

interface ExpectedFilters {
  kind?: 'expense' | 'income' | 'transfer';
  status?: 'pending' | 'cleared';
  category?: string;
  accountId?: string | null;
  source?: 'whatsapp' | 'app' | 'import' | 'recurring';
  recurringId?: string;
  q?: string;
}

/** Keep the separate prediction block in step with the ledger's filters. */
export function filterExpectedLines<T extends ExpectedLedgerLine>(
  lines: readonly T[], filters: ExpectedFilters,
): T[] {
  const term = filters.q?.trim().toLocaleLowerCase('pt-BR');
  return lines.filter((line) => {
    if (filters.status === 'cleared' || filters.kind === 'transfer') return false;
    if (filters.kind && line.kind !== filters.kind) return false;
    if (filters.category && line.category !== filters.category) return false;
    if (filters.accountId !== undefined && line.account_id !== filters.accountId) return false;
    if (filters.source && (filters.source !== 'recurring' || line.origin !== 'recurring')) return false;
    if (filters.recurringId && (line.origin !== 'recurring' || line.ref_id !== filters.recurringId)) return false;
    if (term && !`${line.description} ${line.category ?? ''}`.toLocaleLowerCase('pt-BR').includes(term)) return false;
    return true;
  }).sort((a, b) => a.due_date.localeCompare(b.due_date)
    || a.description.localeCompare(b.description, 'pt-BR')
    || a.ref_id.localeCompare(b.ref_id));
}
