/**
 * Pagamentos de uma fatura (cada um é uma transferência com `pays_invoice_id`). Desfazer um é
 * apagá-lo: o banco refaz `paid_cents`, reabre a fatura e o dinheiro volta à conta (derivado).
 * Estas contas usam os mesmos `total` e `paid_cents` que a tela já mostra — nenhuma regra nova.
 */

/**
 * Na ORDEM EM QUE FORAM PAGOS, numerados (15/10/2026, *"tem que mostrar em ordem do que eu fui
 * pagando, pois se eu paguei dois valores iguais, às vezes confunde"*): o 1º é o mais antigo. É
 * exceção declarada ao "mais recente primeiro" das listas — aqui o número É a identidade de cada
 * pagamento. No mesmo dia, desempata a hora do registro.
 */
export function naOrdemDoPagamento<T extends { occurred_at: string; created_at?: string | null }>(pagamentos: readonly T[]): T[] {
  return [...pagamentos].sort(
    (a, b) => a.occurred_at.localeCompare(b.occurred_at) || (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  );
}

/** "1º pagamento", "2º pagamento"… — `posicao` começa em 0. */
export const nomeDoPagamento = (posicao: number) => `${posicao + 1}º pagamento`;

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
