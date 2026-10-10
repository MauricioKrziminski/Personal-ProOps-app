type Rota = { name: string; params?: object };

/**
 * Quantas telas sair depois de APAGAR pelo formulário de edição. Aberto a partir do detalhe do
 * mesmo lançamento (`finance/[txId]`), voltar uma só deixava o detalhe de um registro que não
 * existe mais embaixo ("Isto não existe mais" com o cabeçalho antigo, Android, 10/10/2026): saem
 * as duas. De qualquer outra origem (lista, hoje) é uma só.
 */
export function telasParaSairDoApagado(rotas: Rota[], indice: number, id: string | undefined): 1 | 2 {
  const anterior = rotas[indice - 1];
  const txId = (anterior?.params as { txId?: string | string[] } | undefined)?.txId;
  const doDetalhe = anterior?.name === 'finance/[txId]' && (Array.isArray(txId) ? txId[0] : txId) === id;
  return id && doDetalhe ? 2 : 1;
}
