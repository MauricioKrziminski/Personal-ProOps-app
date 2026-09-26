/**
 * Reabrir uma folha quando a tela VOLTA ao foco (25/09/2026) — o "Cadastrar conta" de dentro do
 * pagamento da fatura: a folha fecha para a outra tela abrir (o `Sheet` não sobrevive a perder o
 * foco) e reabre na volta.
 *
 * ⚠️ Três passos, não dois: o render do PRÓPRIO toque ainda é com a tela focada, e "pediu + focada"
 * reabria a folha ali mesmo, antes de a navegação acontecer. Só reabre quem passou por "fora".
 */
export type Volta = 'nada' | 'pedido' | 'fora';

export function passoDaVolta(estado: Volta, focada: boolean): { estado: Volta; abrir: boolean } {
  if (estado === 'pedido' && !focada) return { estado: 'fora', abrir: false };
  if (estado === 'fora' && focada) return { estado: 'nada', abrir: true };
  return { estado, abrir: false };
}
