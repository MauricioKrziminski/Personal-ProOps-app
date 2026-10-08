/**
 * Pagar a fatura é UM botão (07/10/2026): a folha decide se o dinheiro sai de uma conta
 * (`pay_invoice`, transferência) ou se a fatura só fica marcada como paga (`settle_invoice`, o
 * pagamento que aconteceu fora do app). Eram dois botões lado a lado, e marcar como paga a fatura
 * que se queria pagar descontando da conta foi exatamente o engano que motivou a troca.
 */
export function podeConfirmarPagamento(o: {
  desconta: boolean;
  payerId: string | null;
  dataISO: string | null;
  valorCents: number;
  falta: number;
}): boolean {
  if (!o.dataISO || o.falta <= 0) return false;
  if (!o.desconta) return true;
  return Boolean(o.payerId) && o.valorCents > 0 && o.valorCents <= o.falta;
}
