/** The UI asks for installments remaining; the database stores the original total. */
export function debtTerm(remaining: string, paid: number): number | null {
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
