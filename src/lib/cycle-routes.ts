/**
 * Para onde cada linha do ciclo leva — lógica pura, em `lib/` porque `node --test` não carrega
 * `.tsx` e porque a lição que ela guarda não é sobre desenho, é sobre roteamento.
 */

export interface Rota {
  pathname: string;
  params: Record<string, string>;
}

/**
 * ⚠️ **`ref_id` muda de significado conforme a origem.** Numa linha de cronograma ele é id de
 * DÍVIDA; num pagamento de fatura é id de TRANSAÇÃO (o `transfer` para o cartão); numa fatura é
 * id de FATURA. Mandar o id errado abre uma tela vazia, sem erro nenhum — é a mesma lição de
 * `kind='debt'` em `upcoming_bills`, herdada da tela do mês que foi apagada.
 *
 * `null` para o que é projetado da regra: ali não existe lançamento para abrir, e uma tela vazia
 * é pior que um toque que não faz nada.
 */
export function rotaDaLinha(origin: string, refId: string): Rota | null {
  switch (origin) {
    case 'invoice':
      return { pathname: '/finance/invoice/[id]', params: { id: refId } };
    // Vai com o `id`: mandar para a LISTA fazia quem tem cinco financiamentos caçar qual era.
    case 'debt_schedule':
      return { pathname: '/finance/debts', params: { id: refId } };
    case 'invoice_payment':
    case 'transaction':
    case 'transaction_overdue':
      return { pathname: '/finance/[txId]', params: { txId: refId } };
    default:
      return null;
  }
}
