/** Regra de nota (palavra -> pasta) e regra de lançamento (palavra -> categoria) moram na mesma tabela. */
export type TipoDeRegra = 'lancamento' | 'nota';

export const tipoDaRegra = (r: { folder_id?: string | null }): TipoDeRegra => (r.folder_id ? 'nota' : 'lancamento');

export function separaRegras<T extends { folder_id?: string | null }>(regras: readonly T[]) {
  return {
    lancamentos: regras.filter((r) => tipoDaRegra(r) === 'lancamento'),
    notas: regras.filter((r) => tipoDaRegra(r) === 'nota'),
  };
}
