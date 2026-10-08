/**
 * O rascunho do "E se…?" agrupado por PERÍODO (07/10/2026): *"ter uma organização para mostrar as
 * hipóteses em ordem, bem separado o período (ciclo ou mês) de cada uma"*. A lista era a ordem de
 * criação, com os adiantamentos sempre no fim, e nada dizia de que mês cada hipótese era.
 *
 * O período vem das bordas REAIS que a projeção devolveu (`MesProjetado.de/ate`), então a régua
 * Mês | Ciclo da Projeção vale aqui sem segunda aritmética: com fechamento no dia 10, a compra de
 * 25/11 é do ciclo "Dezembro". Fora do horizonte carregado não há saldo para afirmar: o grupo leva
 * o mês civil e `periodo: null`.
 */
import type { MesProjetado } from './forecast-months.ts';

export function periodoDe(meses: readonly MesProjetado[], iso: string): MesProjetado | null {
  return meses.find((m) => m.de <= iso && iso <= m.ate) ?? null;
}

export type GrupoDoPeriodo<T> = { chave: string; mes: string; periodo: MesProjetado | null; itens: T[] };

export function agruparPorPeriodo<T>(
  itens: readonly { data: string; item: T }[],
  meses: readonly MesProjetado[],
): GrupoDoPeriodo<T>[] {
  const ordenados = itens
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.i - b.i));
  const grupos = new Map<string, GrupoDoPeriodo<T>>();
  for (const x of ordenados) {
    const periodo = periodoDe(meses, x.data);
    const mes = periodo?.mes ?? x.data.slice(0, 7);
    const grupo = grupos.get(mes) ?? { chave: mes, mes, periodo, itens: [] };
    grupo.itens.push(x.item);
    grupos.set(mes, grupo);
  }
  return [...grupos.values()].sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0));
}
