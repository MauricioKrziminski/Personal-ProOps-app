/**
 * O que a ficha da dívida faz quando a pessoa volta de uma parcela (25/09/2026).
 *
 * A ficha é um `Sheet` — um `Modal` —, e outra tela empurrada por cima dela ficaria POR BAIXO (no
 * Android é outra janela; no iOS, um controlador apresentado). Então tocar numa parcela fecha a
 * ficha e navega; sem este aviso, voltar largava a pessoa na lista de Dívidas. A tela da parcela
 * troca o pedido quando o botão dela é "Paguei esta parcela".
 *
 * Um aviso só, lido e apagado quando Dívidas volta ao foco — não é estado de tela, é o recado de
 * uma navegação para a seguinte.
 */
export type AoVoltar = { divida: string; acao: 'abrir' | 'pagar'; cents?: number };

let pendente: AoVoltar | null = null;

export function aoVoltarParaDivida(pedido: AoVoltar) {
  pendente = pedido;
}

export function lerAoVoltar(): AoVoltar | null {
  const pedido = pendente;
  pendente = null;
  return pedido;
}
