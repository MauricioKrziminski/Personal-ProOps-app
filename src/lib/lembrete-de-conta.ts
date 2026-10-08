/**
 * Lembrete de conta: em que registro ele fica pendurado e como se lê. A regra de QUANDO toca mora
 * no banco (`private.bill_reminder_dues`); aqui não se calcula vencimento nenhum.
 */

export type Alvo =
  | { transaction_id: string }
  | { recurring_id: string }
  | { installment_plan_id: string }
  | { debt_id: string; debt_installment_no?: number }
  | { invoice_id: string };

export type Aviso = { days_before: number; at_time: string };

export type Aberto =
  | { tipo: 'lancamento'; tx: TxDoLembrete }
  | { tipo: 'divida'; debtId: string; parcela?: number }
  | { tipo: 'fatura'; invoiceId: string }
  | { tipo: 'serie'; recurringId: string }
  | { tipo: 'compra'; planId: string };

export const AVISO_PADRAO: Aviso = { days_before: 0, at_time: '09:00' };

/** `fatura_status`: o status da fatura da linha de cartão (null/ausente = ainda não se sabe). */
export type TxDoLembrete = {
  id: string; recurring_id: string | null; installment_plan_id: string | null; invoice_id: string | null;
  status: string; fatura_status?: string | null;
};

/** Já paga: fora do cartão pelo status da linha; no cartão pela FATURA (a compra fica `cleared` antes). */
export const estaPaga = (tx: TxDoLembrete) =>
  tx.invoice_id ? tx.fatura_status === 'paid' || tx.fatura_status === 'rolled' : tx.status !== 'pending';

/** "Só este" e "Todas as próximas"; `todas: null` = não há série, a tela não pergunta. */
export function alvosDoAberto(a: Aberto): { so: Alvo; todas: Alvo | null } {
  switch (a.tipo) {
    case 'lancamento': {
      const { tx } = a;
      // Ocorrência já paga: "Só esta" não teria o que lembrar (o banco recusa) — vale a série/compra.
      if (tx.recurring_id) return estaPaga(tx)
        ? { so: { recurring_id: tx.recurring_id }, todas: null }
        : { so: { transaction_id: tx.id }, todas: { recurring_id: tx.recurring_id } };
      if (tx.installment_plan_id) return estaPaga(tx)
        ? { so: { installment_plan_id: tx.installment_plan_id }, todas: null }
        : { so: { transaction_id: tx.id }, todas: { installment_plan_id: tx.installment_plan_id } };
      // Compra à vista no cartão não vence sozinha: quem vence é a fatura.
      if (tx.invoice_id) return { so: { invoice_id: tx.invoice_id }, todas: null };
      return { so: { transaction_id: tx.id }, todas: null };
    }
    case 'divida':
      return a.parcela
        ? { so: { debt_id: a.debtId, debt_installment_no: a.parcela }, todas: { debt_id: a.debtId } }
        : { so: { debt_id: a.debtId }, todas: null };
    case 'fatura':
      return { so: { invoice_id: a.invoiceId }, todas: null };
    case 'serie':
      return { so: { recurring_id: a.recurringId }, todas: null };
    case 'compra':
      return { so: { installment_plan_id: a.planId }, todas: null };
  }
}

const hora = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
};

/** "no dia" | "1 dia antes" | "N dias antes" — a mesma frase no resumo e no formulário. */
export const quandoDoAviso = (dias: number) => (dias === 0 ? 'no dia' : dias === 1 ? '1 dia antes' : `${dias} dias antes`);

export function rotuloDoAviso(a: Aviso): string {
  return `${quandoDoAviso(a.days_before)} às ${hora(a.at_time)}`;
}

export const resumoDosAvisos = (avisos: Aviso[]) => avisos.map(rotuloDoAviso).join(' · ');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAVES = ['transaction_id', 'recurring_id', 'installment_plan_id', 'debt_id', 'invoice_id'] as const;

export function alvoComoParam(a: Alvo): string {
  const chave = CHAVES.find((k) => k in a)!;
  const id = (a as Record<string, string>)[chave];
  return 'debt_installment_no' in a && a.debt_installment_no ? `${chave}:${id}:${a.debt_installment_no}` : `${chave}:${id}`;
}

/** O parâmetro vem da rota: só chave conhecida, uuid e forma canônica viram alvo. */
export function alvoDoParam(s: string): Alvo | null {
  const partes = s.split(':');
  const [chave, id, n] = partes;
  if (!(CHAVES as readonly string[]).includes(chave) || !UUID.test(id ?? '')) return null;
  if (chave === 'debt_id' && partes.length === 3) return /^\d{1,4}$/.test(n) && Number(n) > 0 ? { debt_id: id, debt_installment_no: Number(n) } : null;
  return partes.length === 2 ? ({ [chave]: id } as Alvo) : null;
}

export function hrefDoLembrete(aberto: Aberto, nome: string) {
  const { so, todas } = alvosDoAberto(aberto);
  return {
    pathname: '/reminder-form' as const,
    params: { conta: alvoComoParam(so), ...(todas ? { todas: alvoComoParam(todas) } : {}), nome },
  };
}

/** Mesma chave do alvo dos dois lados (overview do banco × o que a tela abriu). */
export const mesmoAlvo = (a: Alvo, b: Alvo) => alvoComoParam(a) === alvoComoParam(b);
