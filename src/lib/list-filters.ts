import { isValidBRDate, isoToBR } from './dates.ts';

export type ListFiltersValue = {
  from?: string; to?: string; q?: string;
  minCents?: number; maxCents?: number;
  selections?: Record<string, string>;
};
const validDate = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && isValidBRDate(isoToBR(iso));
export function listFilterError(value: ListFiltersValue): string | undefined {
  if ([value.from, value.to].some(d => d && !validDate(d))) return 'Escolha uma data válida';
  if (value.from && value.to && value.from > value.to) return 'A data final deve ser igual ou posterior à inicial';
  if ([value.minCents, value.maxCents].some(n => n !== undefined && (!Number.isSafeInteger(n) || n < 0))) return 'Informe valores válidos';
  if (value.minCents !== undefined && value.maxCents !== undefined && value.minCents > value.maxCents)
    return 'O valor máximo deve ser igual ou maior que o mínimo';
  return undefined;
}
export function listFiltersActive(value: ListFiltersValue): boolean {
  return listFilterCount(value) > 0;
}
/** Datas e valores são intervalos: cada par representa um único critério. */
export function listFilterCount(value: ListFiltersValue): number {
  return Number(Boolean(value.from || value.to)) + Number(Boolean(value.q?.trim()))
    + Number(value.minCents !== undefined || value.maxCents !== undefined)
    + Object.values(value.selections ?? {}).filter(Boolean).length;
}
type SummarySelect = { key: string; label: string; options: readonly { id: string | null; label: string }[] };
/** O resumo lê os mesmos critérios e opções da folha; identificadores internos nunca viram texto. */
export function listFilterDetails(value: ListFiltersValue, {
  selects = [], dateLabel = 'Data', valueLabel = 'Valor', formatAmount,
}: { selects?: readonly SummarySelect[]; dateLabel?: string; valueLabel?: string; formatAmount: (cents: number) => string }): string[] {
  const details: string[] = [];
  if (value.from || value.to) {
    const from = value.from ? isoToBR(value.from) : undefined;
    const to = value.to ? isoToBR(value.to) : undefined;
    const period = from && to ? from === to ? from : `${from} a ${to}` : from ? `a partir de ${from}` : `até ${to}`;
    details.push(`${dateLabel}: ${period}`);
  }
  if (value.q?.trim()) details.push(`Busca: ${value.q.trim()}`);
  const selections = value.selections ?? {};
  const selectsByKey = new Map(selects.map(select => [select.key, {
    label: select.label,
    options: new Map(select.options.map(option => [option.id, option.label])),
  }]));
  const keys = [...selectsByKey.keys(), ...Object.keys(selections).filter(key => !selectsByKey.has(key))];
  for (const key of keys) {
    const id = selections[key];
    if (!id) continue;
    const select = selectsByKey.get(key);
    details.push(select ? `${select.label}: ${select.options.get(id) ?? 'seleção indisponível'}` : 'Critério selecionado');
  }
  if (value.minCents !== undefined || value.maxCents !== undefined) {
    const min = value.minCents !== undefined ? formatAmount(value.minCents) : undefined;
    const max = value.maxCents !== undefined ? formatAmount(value.maxCents) : undefined;
    details.push(`${valueLabel}: ${min && max ? `${min} a ${max}` : min ? `a partir de ${min}` : `até ${max}`}`);
  }
  return details;
}
/** Blocos inclusivos e disjuntos: o próximo começa um dia depois do fim, sem timezone/DST. */
export function dateWindows(from: string, to: string, maxDays = 62): { from: string; to: string }[] {
  if (!validDate(from) || !validDate(to) || from > to || !Number.isInteger(maxDays) || maxDays < 1) throw new Error('Período inválido');
  const start = Date.parse(`${from}T00:00:00Z`); const end = Date.parse(`${to}T00:00:00Z`);
  const day = 86_400_000;
  const windows = [];
  for (let t = start; t <= end; t += maxDays * day)
    windows.push({ from: new Date(t).toISOString().slice(0, 10), to: new Date(Math.min(end, t + (maxDays - 1) * day)).toISOString().slice(0, 10) });
  return windows;
}

/** Dias no relógio da pessoa, com teto exclusivo e respeito ao fuso/DST de cada borda. */
export function timestampDateBounds(value: Pick<ListFiltersValue, 'from' | 'to'>): { from?: string; before?: string } {
  const error = listFilterError(value);
  if (error) throw new Error(error);
  const nextDay = value.to ? new Date(Date.parse(`${value.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : undefined;
  return { from: value.from ? new Date(`${value.from}T00:00:00`).toISOString() : undefined,
    before: nextDay ? new Date(`${nextDay}T00:00:00`).toISOString() : undefined };
}
