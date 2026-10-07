/** Mesma regra de `private.debt_pause_shift`: soma os meses das carências que começam até a parcela `n`. */
export function deslocamentoDaCarencia(
  pausas: readonly { from_installment_no: number; months: number }[] | null | undefined,
  n: number,
): number {
  let soma = 0;
  for (const p of pausas ?? []) if (p.from_installment_no <= n) soma += p.months;
  return soma;
}
