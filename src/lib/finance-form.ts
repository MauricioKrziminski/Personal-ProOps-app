/** The UI asks for installments remaining; the database stores the original total. */
export function debtTerm(remaining: string, paid: number): number | null {
  if (!Number.isInteger(paid) || paid < 0) throw new Error('Informe parcelas pagas inteiras e não negativas');
  if (!remaining.trim()) return null;
  const count = Number(remaining);
  if (!Number.isInteger(count) || count <= 0) throw new Error('Informe parcelas restantes positivas');
  return count + paid;
}

export function validRecurringRange(start: string, end: string, interval: string): boolean {
  const count = Number(interval);
  return (!end || end >= start) && Number.isInteger(count) && count >= 1 && count <= 99;
}

/** Show intentional database domain errors, while keeping infrastructure failures generic. */
export function financeErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P0001' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
}

/** Backdating is not proof of payment; blank history is only safe for a new plan. */
export function installmentHistory(text: string, total: number, firstDate: string, today: string): number {
  if (!text.trim()) {
    if (firstDate < today) throw new Error('Informe quantas parcelas iniciais já foram pagas, inclusive zero');
    return 0;
  }
  const paid = Number(text);
  if (!/^\d+$/.test(text.trim()) || !Number.isInteger(paid) || paid < 0 || paid > total) {
    throw new Error(`Informe parcelas pagas entre 0 e ${total}`);
  }
  return paid;
}
