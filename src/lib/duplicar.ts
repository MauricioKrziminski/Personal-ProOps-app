/**
 * F22: o que uma cópia (Duplicar ou favorito) leva para o formulário de lançamento. Pura, e a
 * lista de colunas é a fonte do teste: coluna nova da transação nasce IGNORADA até alguém decidir
 * que é dado da pessoa — vínculo contábil reaproveitado é o defeito que esta lista existe para
 * impedir.
 */
import { expenseClassificationFromRecord } from './expense-classification.ts';
import { normalizePaymentMethod } from './payment-method.ts';

/** Dados da pessoa: viajam para o formulário. */
export const COLUNAS_COPIADAS = [
  'kind', 'description', 'merchant', 'amount_cents', 'category', 'subcategory_id',
  'account_id', 'counterparty_account_id', 'payment_method',
  'expense_pattern', 'expense_pattern_source', 'expense_necessity', 'expense_necessity_source',
] as const;

/** Vínculos e estado: nunca viajam. */
export const COLUNAS_IGNORADAS = [
  'id', 'invoice_id', 'installment_plan_id', 'installment_no', 'recurring_id', 'debt_id',
  'debt_payment_no', 'debt_principal_cents', 'debt_balance_after_cents', 'pays_invoice_id',
  'rollover_of_invoice_id', 'pix_fee_for_transaction_id', 'down_payment_debt_id',
  'down_payment_plan_id', 'status', 'paid_at', 'auto_confirm', 'due_at', 'occurred_at',
  'attachment_path', 'source', 'edit_revision', 'workspace_id', 'user_id', 'created_at',
] as const;

export type CamposCopiaveis = Partial<Record<(typeof COLUNAS_COPIADAS)[number], unknown>>;
type Origem = CamposCopiaveis & { installment_plan_id?: string | null; installment_no?: number | null };

/** Par valor/origem incoerente não pode derrubar o toque da linha: a cópia sai sem classificação. */
function classificacaoSegura(origem: unknown) {
  try { return expenseClassificationFromRecord(origem); } catch { return expenseClassificationFromRecord(null); }
}

const SUFIXO_DE_PARCELA = /\s*\(\d+\/\d+\)\s*$/;

/**
 * Params de `/finance/lancar` (tipo "uma") para a cópia. `hojeBR` é a data explícita do formulário.
 * `nota` é o aviso do topo — só a parcela tem ("vira um lançamento à vista").
 */
export function paramsDaCopia(origem: Origem, hojeBR: string, totalDeParcelas?: number | null): { params: Record<string, string>; nota: string | null } {
  const ehParcela = Boolean(origem.installment_plan_id);
  const texto = (v: unknown) => (typeof v === 'string' ? v : '');
  const titulo = texto(origem.description);
  const params: Record<string, string> = {
    kind: origem.kind === 'income' || origem.kind === 'transfer' ? origem.kind : 'expense',
    description: ehParcela ? titulo.replace(SUFIXO_DE_PARCELA, '') : titulo,
    amount: String(Number.isSafeInteger(origem.amount_cents) && (origem.amount_cents as number) > 0 ? origem.amount_cents : 0),
    data: hojeBR,
    category: texto(origem.category),
    subcategory_id: texto(origem.subcategory_id),
    merchant: texto(origem.merchant),
    paymentMethod: normalizePaymentMethod(origem.payment_method) ?? '',
    classificacao: JSON.stringify(classificacaoSegura(origem)),
  };
  if (texto(origem.account_id)) params.conta = texto(origem.account_id);
  if (texto(origem.counterparty_account_id)) params.counterparty = texto(origem.counterparty_account_id);
  const nota = ehParcela
    ? `Cópia da parcela ${origem.installment_no ?? '?'}${totalDeParcelas ? `/${totalDeParcelas}` : ''} — vira um lançamento à vista`
    : null;
  if (nota) params.nota = nota;
  return { params, nota };
}

/** Pagamento de dívida, de fatura e juros do Pix não duplicam: a cópia seria um gasto solto. */
export function podeDuplicar(tx: { debt_id?: string | null; pays_invoice_id?: string | null; pix_fee_for_transaction_id?: string | null; adiantamento?: unknown }): boolean {
  // O adiantamento (08/10/2026) cobre parcelas de uma origem: a cópia seria um gasto solto.
  return !tx.debt_id && !tx.pays_invoice_id && !tx.pix_fee_for_transaction_id && !tx.adiantamento;
}
