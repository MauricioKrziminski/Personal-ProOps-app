export const DIAS_DE_CONTA = 7;
export const SALVAMENTOS_MINIMOS = 5;
export const DIAS_ENTRE_PEDIDOS = 120;

const DIA_MS = 86_400_000;

export interface EstadoDaAvaliacao {
  /** Quantos salvamentos de lançamento este aparelho contou. */
  salvamentos: number;
  /** Quando o pedido foi feito pela última vez (ms), ou `null`. */
  ultimoPedido: number | null;
}

/** Conta com ≥ 7 dias, ≥ 5 salvamentos e nenhum pedido nos últimos 120 dias. */
export function devePedirAvaliacao(
  contaCriadaEm: string | null | undefined,
  estado: EstadoDaAvaliacao,
  agora: number,
): boolean {
  const criada = contaCriadaEm ? Date.parse(contaCriadaEm) : NaN;
  if (!Number.isFinite(criada) || agora - criada < DIAS_DE_CONTA * DIA_MS) return false;
  if (estado.salvamentos < SALVAMENTOS_MINIMOS) return false;
  return estado.ultimoPedido == null || agora - estado.ultimoPedido >= DIAS_ENTRE_PEDIDOS * DIA_MS;
}
