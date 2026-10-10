import { isoToBR } from './dates.ts';

type ComPlano = {
  occurred_at: string;
  installment_no: number | null;
  /** O plano embutido na consulta (`installment_plans(first_occurred_at)`), quando é parcela. */
  installment_plans?: { first_occurred_at: string } | null;
};

/**
 * A data em que a compra foi FEITA. Numa compra parcelada cada parcela mora no mês em que cai
 * (`occurred_at`), e a compra é a da parcela 1 — `installment_plans.first_occurred_at`.
 */
export function dataDaCompra(tx: ComPlano): string {
  return tx.installment_plans?.first_occurred_at ?? tx.occurred_at;
}

/**
 * "compra em 14/09" na linha que está numa data diferente da compra (a parcela 2 em diante), e
 * `null` quando a data da linha JÁ é a da compra.
 *
 * ⚠️ "Mostre sempre a data do lançamento" (24/09/2026): a lista escrevia só "na fatura de
 * 10/10" e a data da parcela — a da compra não aparecia em lugar nenhum, e a pessoa lia o
 * vencimento da fatura como a data do que comprou.
 */
export function rotuloDaCompra(tx: ComPlano): string | null {
  const compra = dataDaCompra(tx);
  if (compra === tx.occurred_at) return null;
  const br = isoToBR(compra);
  return `compra em ${compra.slice(0, 4) === tx.occurred_at.slice(0, 4) ? br.slice(0, 5) : br}`;
}

/**
 * O filtro "Em aberto" / "Concluído" da lista. UMA régua (`estadoDaLinha`, `transactions_summary`):
 * linha de cartão (`invoice_id`) vale pela DATA — aconteceu se `occurred_at <= hoje`, mesmo
 * nascendo `cleared`; fora do cartão vale pelo `status` (`cleared` = aconteceu).
 *
 * ⚠️ Era `status` puro: a compra de cartão de ontem (`pending` até a fatura ser paga) nunca era
 * "Concluído" (wardogs, 24/09/2026), e depois `cleared OR cartão-até-hoje` deixava a compra de
 * cartão FUTURA, nascida `cleared`, em "Aconteceu" enquanto a fatura a mostra como "Ainda vai entrar".
 *
 * `ou` vai inteiro num `.or()` do PostgREST; `hoje` é a data LOCAL (`localISODate`).
 */
export function filtroDoEstado(estado: 'pending' | 'cleared', hoje: string): { ou: string } {
  return estado === 'cleared'
    ? { ou: `and(invoice_id.is.null,status.eq.cleared),and(invoice_id.not.is.null,occurred_at.lte.${hoje})` }
    : { ou: `and(invoice_id.is.null,status.eq.pending),and(invoice_id.not.is.null,occurred_at.gt.${hoje})` };
}
