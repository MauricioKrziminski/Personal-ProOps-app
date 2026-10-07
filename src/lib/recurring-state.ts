import { dataLocalDe, localISODate } from './dates.ts';
import { emPausa } from './pausa.ts';

type Serie = {
  active: boolean;
  end_date: string | null;
  next_run_at: string;
  paused_from?: string | null;
  paused_until?: string | null;
};
export type EstadoDaRecorrencia = 'ativa' | 'pausada' | 'encerrada';

/** `active` também conserva o histórico; o fim inclusivo decide se ainda há agenda. */
export function estadoDaRecorrencia(serie: Serie, hoje = localISODate()): EstadoDaRecorrencia {
  const proxima = /^\d{4}-\d{2}-\d{2}$/.test(serie.next_run_at)
    ? serie.next_run_at
    : Number.isNaN(new Date(serie.next_run_at).getTime()) ? null : dataLocalDe(serie.next_run_at);
  if (serie.end_date && (serie.end_date < hoje || (proxima && serie.end_date < proxima))) {
    return 'encerrada';
  }
  return serie.active && !emPausa(hoje, serie.paused_from ?? null, serie.paused_until ?? null) ? 'ativa' : 'pausada';
}
