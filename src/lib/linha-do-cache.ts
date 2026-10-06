/**
 * Acha um lançamento já baixado pelas LISTAS (`['transactions','list'|'recent']`), para o detalhe
 * abrir com ele em vez de esperar uma ida ao banco.
 *
 * A linha da lista tem as mesmas colunas do detalhe MENOS o join `debts`, que só o detalhe pede e
 * que decide texto ("Parcela 3 de 12", "encargo" × "juros"). Por isso pagamento de dívida NUNCA
 * semeia: o detalhe espera a leitura própria, em vez de desenhar um significado sem a dívida.
 *
 * Entrada invalidada não semeia: uma escrita acabou de dizer que a linha mudou, e semear com a
 * data de atualização dela esconderia o refetch pelo `staleTime`.
 */
export interface EntradaDeCache {
  data: unknown;
  updatedAt: number;
  invalidada: boolean;
}

export function acharLinhaNoCache<T extends { id: string; debt_id?: string | null }>(
  entradas: EntradaDeCache[],
  id: string,
): { linha: T; updatedAt: number } | undefined {
  let melhor: { linha: T; updatedAt: number } | undefined;
  for (const { data, updatedAt, invalidada } of entradas) {
    if (invalidada || (melhor && melhor.updatedAt >= updatedAt)) continue;
    // `useInfiniteQuery` guarda `{ pages: Transaction[][] }`; `recent` guarda `Transaction[]`.
    const linhas: unknown[] = Array.isArray(data)
      ? data
      : Array.isArray((data as { pages?: unknown })?.pages)
        ? (data as { pages: unknown[][] }).pages.flat()
        : [];
    const linha = linhas.find((l) => (l as T | null)?.id === id) as T | undefined;
    if (linha && !linha.debt_id) melhor = { linha, updatedAt };
  }
  return melhor;
}
