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

/**
 * "De onde saiu o dinheiro?" tem as contas e, no fim, esta escolha: o pagamento aconteceu fora do
 * app (ou numa conta que não está aqui), e a fatura só fica marcada como paga, sem mexer em saldo.
 * Era uma chave "Descontar de uma conta" SEPARADA do "Pagar com" (08/10/2026: *"descontar de uma
 * conta tinha que estar junto com pagar com, não?"*) — duas perguntas para uma decisão só.
 */
export const PAGOU_POR_FORA = 'pagou-por-fora';

/** O pagamento move dinheiro de uma conta? `null` (ainda não escolheu) conta como sim: pede a conta. */
export function descontaDaConta(origem: string | null): boolean {
  return origem !== PAGOU_POR_FORA;
}
