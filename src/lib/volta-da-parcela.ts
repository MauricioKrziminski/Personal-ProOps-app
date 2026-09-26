/**
 * "Paguei esta parcela" na tela de uma parcela volta para a ficha da dívida JÁ no pagamento
 * (25/09/2026). A folha de pagar mora na ficha (é ela que sabe a conta, o valor e "usar nas
 * próximas"); a tela da parcela deixa este recado e volta, e a ficha o lê ao ganhar o foco.
 *
 * Um recado só, lido e apagado — não é estado de tela, é o pedido de uma navegação para a seguinte.
 */
export type AoVoltar = { divida: string; acao: 'pagar'; cents?: number };

let pendente: AoVoltar | null = null;

export function aoVoltarParaDivida(pedido: AoVoltar) {
  pendente = pedido;
}

export function lerAoVoltar(): AoVoltar | null {
  const pedido = pendente;
  pendente = null;
  return pedido;
}
