import { isoToBR, localISODate, somaDias } from './dates.ts';
import { addMonthsISO } from './debt-history.ts';

export type ModoDaPausa = 'dias' | 'meses' | 'ate' | 'sem_prazo';

/** Período `[de, ate)`: fim exclusivo, igual ao banco e ao agente. */
export function emPausa(dia: string, de: string | null, ate: string | null): boolean {
  return de != null && ate != null && de <= dia && dia < ate;
}

export function foraDaPausa(
  r: { paused_from?: string | null; paused_until?: string | null },
  hoje: string,
): boolean {
  return !emPausa(hoje, r.paused_from ?? null, r.paused_until ?? null);
}

/** `ate` é o último dia pausado; o fim exclusivo é o dia seguinte. */
export function fimDaPausa(inicio: string, modo: ModoDaPausa, n: number, ate: string | null): string | null {
  if (modo === 'dias') return somaDias(inicio, n);
  if (modo === 'meses') return addMonthsISO(inicio, n);
  if (modo === 'ate' && ate) return somaDias(ate, 1);
  return null;
}

export function rotuloDaPausa(
  s: { active: boolean; paused_from: string | null; paused_until: string | null },
  hoje = localISODate(),
): string | null {
  const { paused_from: de, paused_until: ate } = s;
  if (!de || !ate) return null;
  const ultimo = somaDias(ate, -1);
  if (emPausa(hoje, de, ate)) return `Pausada até ${isoToBR(ultimo)}`;
  if (hoje < de) return `Pausa de ${isoToBR(de).slice(0, 5)} a ${isoToBR(ultimo).slice(0, 5)}`;
  return null;
}

/** Filtro de estado dos lembretes para o PostgREST (`.or()`): em período de pausa conta como pausado. `hoje` é o dia local. */
export function filtroDeEstadoDoLembrete(status: 'active' | 'paused', hoje: string): string {
  return status === 'paused'
    ? `active.eq.false,and(paused_from.lte.${hoje},paused_until.gt.${hoje})`
    : `and(active.eq.true,or(paused_from.is.null,paused_until.is.null,paused_from.gt.${hoje},paused_until.lte.${hoje}))`;
}
