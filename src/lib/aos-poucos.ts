/**
 * Lista longa se mostra AOS POUCOS (24/09/2026, pedido do dono do produto: *"sempre preze pelo
 * lazy loading, carregando de pouco em pouco e clicando para ver mais"*). Quem chega inteiro de
 * uma RPC (o ciclo, a linha do tempo da dívida, a prévia da importação) desenha um passo por vez;
 * quem cresce sem fim pagina no servidor. Esta é a aritmética da janela, pura e testada.
 */
export const PASSO = 20;

export function janela<T>(itens: readonly T[], mostrados: number) {
  const n = Math.max(0, mostrados);
  const restantes = Math.max(0, itens.length - n);
  return { visiveis: itens.slice(0, n), restantes, proximos: Math.min(restantes, PASSO) };
}
