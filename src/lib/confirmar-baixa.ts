/**
 * O que o "Paguei"/"Recebi" faz depois de a pessoa confirmar o valor (25/09/2026).
 *
 * Mesmo valor do previsto: só a baixa (`useMarkPaid`). Outro valor: primeiro corrige o valor pela
 * mesma porta da edição com escopo (`update_transaction_scoped`) — só este lançamento, ou este e
 * os próximos da série quando ela existe e a pessoa ligou "Usar este valor nas próximas" — e só
 * então dá a baixa. A regra de "próximos" (pendente E da data em diante) mora na RPC.
 */
export type PlanoDaBaixa = {
  corrigir: { scope: 'one' | 'future'; amount_cents: number } | null;
};

export function planoDaBaixa({
  previsto,
  pago,
  temSerie,
  nasProximas,
}: {
  previsto: number;
  pago: number;
  temSerie: boolean;
  nasProximas: boolean;
}): PlanoDaBaixa {
  if (!Number.isInteger(pago) || pago <= 0) throw new Error('O valor precisa ser maior que zero');
  if (pago === previsto) return { corrigir: null };
  return { corrigir: { scope: temSerie && nasProximas ? 'future' : 'one', amount_cents: pago } };
}
