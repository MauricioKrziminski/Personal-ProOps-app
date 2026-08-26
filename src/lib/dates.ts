/**
 * Helpers puros de data e dinheiro — sem React, sem React Native, sem Supabase.
 * Ficam isolados aqui porque são a parte do app com bug de fuso mais fácil de
 * introduzir (e a única coberta por teste automatizado: src/lib/dates.test.ts).
 */

/** Data local em YYYY-MM-DD — nunca toISOString() (UTC desloca o dia em GMT-3). */
export function localISODate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Primeiro e último dia de um mês YYYY-MM, em datas locais. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  // dia 0 do mês seguinte = último dia deste mês (lida com 28/29/30/31)
  const to = localISODate(new Date(y, m, 0));
  return { from, to };
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Data em dd-mm-yyyy (aceita ISO string ou Date). */
export function formatDateBR(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}
