/**
 * O texto digitado num campo de quantidade (`QuantityField`).
 *
 * ⚠️ O texto NÃO se corta no tamanho do máximo (08/10/2026, *"deixar eu digitar também"*): com o
 * campo já em foco, o cursor fica no fim e "12" + "5" vira "125". Cortar pelo começo devolvia "12"
 * e o dígito novo sumia — parecia que o campo não aceitava digitação. Agora o texto aparece como
 * foi digitado (um dígito além do teto, para ele ser visto) e o VALOR assenta no teto, como o
 * campo sempre prometeu ("digitar além assenta no teto").
 */
export function digitarQuantidade(
  texto: string,
  { min, max }: { min: number; max: number },
): { mostra: string; valor: number | null } {
  const mostra = texto.replace(/\D/g, '').slice(0, String(max).length + 1);
  const n = Number(mostra);
  return { mostra, valor: mostra !== '' && n >= min ? Math.min(n, max) : null };
}
