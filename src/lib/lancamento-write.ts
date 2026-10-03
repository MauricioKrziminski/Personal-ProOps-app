import type { Transaction, TransactionKind } from '@/hooks/use-finance';
import { brToISO, isValidBRDate } from './dates.ts';
import { downPaymentInput, purchaseAmounts } from './down-payment.ts';
import { detalheDaEscrita, mudancaDoDetalhe, type EntradaLancamento, type EntradaParcelada } from './escrita.ts';
import { destinoDoSalvar, installmentHistory, totalDigitado, vencimentoPendenteValido,
  type DestinoDoSalvar, type UnidadeDoValor } from './finance-form.ts';
import type { PaymentMethod } from './payment-method.ts';
import { normalizeExpenseClassification, UNKNOWN_EXPENSE_CLASSIFICATION, type ExpenseClassification } from './expense-classification.ts';

/** Complete values of the transaction form, shared by submit and watched preview. */
export type LancamentoFormValues = {
  expenseClassification?: ExpenseClassification;
  kind: TransactionKind;
  amount_cents: number;
  category: string | null;
  subcategory_id?: string | null;
  description: string;
  merchant: string | null;
  account_id: string | null;
  payment_method: PaymentMethod | null;
  counterparty_account_id: string | null;
  installments: number;
  fee_cents: number;
  auto_confirm: boolean;
  paid_installments: string;
  down_payment_enabled: boolean;
  down_payment_cents: number;
  down_payment_date: string;
  down_payment_account: string | null;
  down_payment_method: PaymentMethod | null;
  value_unit: UnidadeDoValor;
  occurred_at: string;
  pending: boolean;
  installment_occurrence: boolean;
  due_at: string | null;
};

export type ContextoDoLancamento = {
  editing?: Partial<Transaction> & { id: string; subcategory_id?: string | null };
  podeAdiar: boolean;
  podeParcelarAqui: boolean;
  intencaoDoDia: 'fixo' | 'ultimo' | null;
  isCard: boolean;
  mostraJuros: boolean;
  hoje: string;
};

export type LancamentoPreparado = {
  destino: DestinoDoSalvar;
  entradaParcelada: EntradaParcelada | null;
  entradaLancamento: EntradaLancamento;
};

export function prepararLancamento(values: LancamentoFormValues, context: ContextoDoLancamento): LancamentoPreparado {
  const { editing, podeAdiar, podeParcelarAqui, intencaoDoDia, isCard, mostraJuros, hoje } = context;
  if (!Number.isSafeInteger(values.amount_cents) || values.amount_cents <= 0) throw new Error('Informe o valor');
  if (!values.description.trim()) throw new Error('Escreva um título para este lançamento');
  if (!isValidBRDate(values.occurred_at)) throw new Error('Data em dd/mm/aaaa');
  if (!Number.isInteger(values.installments) || values.installments < 1 || values.installments > 72)
    throw new Error('Informe parcelas entre 1 e 72');
  const occurredAt = brToISO(values.occurred_at);
  const adiado = podeAdiar && values.pending;
  if (!vencimentoPendenteValido(adiado, values.installment_occurrence, values.due_at))
    throw new Error('Informe o vencimento em dd/mm/aaaa');
  if (adiado && values.due_at && brToISO(values.due_at) < occurredAt)
    throw new Error('O vencimento não pode ser antes da data do lançamento');

  const destino = destinoDoSalvar(editing, values);
  const classification = values.expenseClassification !== undefined
    ? normalizeExpenseClassification(values.expenseClassification) : undefined;
  const temEntrada = podeParcelarAqui && values.installments > 1 && values.down_payment_enabled;
  let totalDaCompraNova = totalDigitado(values.amount_cents, values.value_unit, values.installments);
  if (!Number.isSafeInteger(totalDaCompraNova)) throw new Error('Informe valores válidos');
  let downPayment: ReturnType<typeof downPaymentInput> | undefined;
  if (temEntrada) {
    downPayment = downPaymentInput({ amountCents: values.down_payment_cents,
      dateBR: values.down_payment_date, accountId: values.down_payment_account,
      paymentMethod: values.down_payment_method }, hoje);
    totalDaCompraNova = purchaseAmounts(values.amount_cents, values.value_unit,
      values.installments, values.down_payment_cents).financedCents;
  }

  // Hidden status/automatic fields belong to the saved record, never to their stale form values.
  const status = podeAdiar ? (adiado ? 'pending' : 'cleared') : (editing?.status ?? 'cleared');
  const dueAt = adiado && values.due_at ? brToISO(values.due_at) : editing?.due_at ?? null;
  const autoConfirm = podeAdiar ? (adiado ? values.auto_confirm : false) : (editing?.auto_confirm ?? false);
  const detail = detalheDaEscrita({ ...detalheDaEscrita(values),
    ...(editing ? mudancaDoDetalhe(editing, values, editing.category ?? null, values.category) : {}) }, values.kind);
  const entradaParcelada: EntradaParcelada | null = values.account_id ? {
    ...(classification ?? {}),
    ...detail,
    accountId: values.account_id,
    paymentMethod: values.payment_method,
    totalCents: totalDaCompraNova,
    installments: values.installments,
    paidInstallments: installmentHistory(values.paid_installments, values.installments, occurredAt, hoje),
    occurredAt,
    description: values.description.trim(),
    category: values.category,
    merchant: values.merchant?.trim() || null,
    lastDay: intencaoDoDia === 'ultimo' && !isCard,
    ...(downPayment ? { downPayment } : {}),
  } : null;
  const entradaLancamento: EntradaLancamento = {
    ...detail,
    ...(classification ? values.kind === 'expense' ? classification : UNKNOWN_EXPENSE_CLASSIFICATION : {}),
    kind: values.kind,
    amount_cents: values.amount_cents,
    category: values.kind === 'transfer' ? null : values.category,
    description: values.description.trim(),
    merchant: values.merchant?.trim() || null,
    account_id: values.account_id,
    payment_method: values.payment_method,
    counterparty_account_id: values.kind === 'transfer' ? values.counterparty_account_id : null,
    occurred_at: occurredAt,
    status,
    due_at: dueAt,
    fee_cents: mostraJuros ? values.fee_cents : 0,
    auto_confirm: autoConfirm,
  };
  return { destino, entradaParcelada, entradaLancamento };
}
