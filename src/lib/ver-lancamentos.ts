/**
 * Os chips "Aconteceu | Previsto | Todos" de Lançamentos são o `status` da lista, na régua da
 * DATA (`filtroDoEstado`): cleared = aconteceu, pending = previsto, all = todos.
 */
export type VerLancamentos = 'cleared' | 'pending' | 'all';

export const VER_OPCOES: { value: VerLancamentos; label: string }[] = [
  { value: 'cleared', label: 'Aconteceu' },
  { value: 'pending', label: 'Previsto' },
  { value: 'all', label: 'Todos' },
];

/**
 * Com que chip a tela abre. SEMPRE "Aconteceu" (decisão do dono do produto, sem gravar
 * preferência), exceto onde o link promete um total que inclui o previsto: `ver=todos` (ou
 * `previsto`/`aconteceu`) vence, e a lista de ocorrências de uma série e a lente "gasto" (a de
 * "Por que mudou?", previsto incluído) abrem em Todos.
 */
export function verInicial(ver: string | undefined, recurringId?: string, lente?: string): VerLancamentos {
  if (ver === 'todos') return 'all';
  if (ver === 'previsto') return 'pending';
  if (ver === 'aconteceu') return 'cleared';
  return recurringId || lente === 'gasto' ? 'all' : 'cleared';
}

export interface TotaisDoPeriodo {
  entrou: number;
  saiu: number;
  entrouPrevisto: number;
  saiuPrevisto: number;
}

/** O pedaço do período que o chip mostra. `previsto` = quanto disso ainda não aconteceu. */
export function totaisDoChip(t: TotaisDoPeriodo, ver: VerLancamentos): TotaisDoPeriodo {
  if (ver === 'cleared') {
    return { entrou: t.entrou - t.entrouPrevisto, saiu: t.saiu - t.saiuPrevisto, entrouPrevisto: 0, saiuPrevisto: 0 };
  }
  if (ver === 'pending') {
    return { entrou: t.entrouPrevisto, saiu: t.saiuPrevisto, entrouPrevisto: t.entrouPrevisto, saiuPrevisto: t.saiuPrevisto };
  }
  return t;
}
