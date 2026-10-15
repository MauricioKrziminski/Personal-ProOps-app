/**
 * Pagamentos de uma fatura (cada um é uma transferência com `pays_invoice_id`). Desfazer um é
 * apagá-lo: o banco refaz `paid_cents`, reabre a fatura e o dinheiro volta à conta (derivado).
 * Estas contas usam os mesmos `total` e `paid_cents` que a tela já mostra — nenhuma regra nova.
 */

/** O que falta na fatura depois de tirar este pagamento. */
export function faltaDepoisDeDesfazer(totalCents: number, jaPagoCents: number, valorCents: number): number {
  return Math.max(totalCents - Math.max(jaPagoCents - valorCents, 0), 0);
}

export function mensagemDeDesfazer(
  valorCents: number,
  contaNome: string | null,
  faltaDepoisCents: number,
  fmt: (c: number) => string,
): string {
  return `${fmt(valorCents)} volta para ${contaNome ?? 'a conta'}. A fatura fica com ${fmt(faltaDepoisCents)} em aberto.`;
}
