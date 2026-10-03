/**
 * A ENTRADA de cada hook de criação → o que vai ao banco (spec 2026-09-28, seção 2).
 *
 * Um lugar só, usado pelo salvar real e pela hipótese (`simular`): o que foi simulado é, byte a
 * byte, o que é aplicado. `user_id` fica de fora — o hook põe o da sessão, e `simular` põe
 * `auth.uid()` no banco.
 */
import { subcategoryAfterParentChange } from './subcategories.ts';
import { assertPaymentMethod, type PaymentMethod } from './payment-method.ts';
import type { Debt, TransactionInput } from '@/hooks/use-finance';
import type { DownPaymentInput } from './down-payment.ts';
import { expenseClassificationFromRecord, UNKNOWN_EXPENSE_CLASSIFICATION, type ExpenseClassification } from './expense-classification.ts';

export const DESCRICAO_JUROS_DO_PIX = 'Juros do Pix no crédito';

export type EntradaLancamento = TransactionInput & Partial<ExpenseClassification> & { fee_cents?: number; payment_method?: PaymentMethod | null; subcategory_id?: string | null };
export type EntradaParcelada = Partial<ExpenseClassification> & {
  subcategory_id?: string | null;
  accountId: string;
  totalCents: number;
  installments: number;
  paidInstallments: number;
  occurredAt: string;
  description: string | null;
  category: string | null;
  merchant: string | null;
  lastDay?: boolean;
  downPayment?: DownPaymentInput;
  paymentMethod?: PaymentMethod | null;
};
export type EntradaRecorrente = Partial<ExpenseClassification> & {
  subcategory_id?: string | null;
  payment_method?: PaymentMethod | null;
  kind: 'expense' | 'income';
  amount_cents: number;
  description: string | null;
  merchant: string | null;
  category: string | null;
  account_id: string | null;
  rrule: string;
  next_run_at: string;
  end_date: string | null;
  auto_confirm: boolean;
};
export type EntradaFinanciamento = Partial<ExpenseClassification> & {
  subcategory_id?: string | null;
  payment_category?: string | null;
  payment_method?: PaymentMethod | null;
  name: string;
  kind: Debt['kind'];
  calculation_mode?: Debt['calculation_mode'];
  principal_cents: number;
  remaining_cents: number;
  interest_rate_monthly: number;
  installments: number | null;
  installments_paid?: number;
  installment_cents: number | null;
  account_id: string | null;
  due_day: number | null;
  first_due_date?: string | null;
  down_payment?: DownPaymentInput;
};

/** Missing legacy metadata remains missing; explicit null is an intentional cleanup. */
export function detalheDaEscrita(input: { subcategory_id?: string | null }, kind = 'expense'): { subcategory_id?: string | null } {
  if (!Object.hasOwn(input, 'subcategory_id')) return {};
  const value = input.subcategory_id;
  if (value !== null && (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))
    throw new Error('Subcategorias: identificação inválida. Confira os dados e tente novamente.');
  return { subcategory_id: kind === 'transfer' || value === null ? null : value.toLowerCase() };
}

/** An unchanged inherited child is cleared on a parent change; a new explicit child reaches server preflight. */
export function mudancaDoDetalhe(
  before: { subcategory_id?: string | null }, after: { subcategory_id?: string | null },
  previousParent: string | null, newParent: string | null,
): { subcategory_id?: string | null } {
  const oldValue = detalheDaEscrita(before).subcategory_id;
  const provided = Object.hasOwn(after, 'subcategory_id');
  let value = provided ? detalheDaEscrita(after).subcategory_id : oldValue;
  if (value === oldValue && value != null) value = subcategoryAfterParentChange(value, previousParent, newParent);
  return value !== oldValue ? { subcategory_id: value ?? null } : {};
}

/** Optional write pairs stay omitted; a supplied dimension always carries value and source. */
export function classificacaoDaEscrita(input: Partial<ExpenseClassification>, kind: string = 'expense'): Partial<ExpenseClassification> {
  const pattern = Object.hasOwn(input, 'expense_pattern');
  const patternSource = Object.hasOwn(input, 'expense_pattern_source');
  const necessity = Object.hasOwn(input, 'expense_necessity');
  const necessitySource = Object.hasOwn(input, 'expense_necessity_source');
  if (!pattern && !patternSource && !necessity && !necessitySource) return {};
  if (pattern !== patternSource || necessity !== necessitySource ||
    (pattern && (input.expense_pattern === undefined || input.expense_pattern_source === undefined)) ||
    (necessity && (input.expense_necessity === undefined || input.expense_necessity_source === undefined))) {
    throw new Error('Classificação de gasto incompleta');
  }
  const snapshot = expenseClassificationFromRecord(input);
  if (kind === 'income' || kind === 'transfer') return { ...UNKNOWN_EXPENSE_CLASSIFICATION };
  return {
    ...(pattern ? { expense_pattern: snapshot.expense_pattern, expense_pattern_source: snapshot.expense_pattern_source } : {}),
    ...(necessity ? { expense_necessity: snapshot.expense_necessity, expense_necessity_source: snapshot.expense_necessity_source } : {}),
  };
}

/**
 * A linha de juros do Pix no crédito a partir da linha principal: SEMPRE uma despesa no cartão,
 * sem destino (movida de `use-finance.ts`, 28/09/2026).
 */
export function linhaDeJuros<T extends Record<string, unknown>>(base: T, cents: number) {
  return {
    ...base,
    ...(Object.hasOwn(base, 'subcategory_id') ? { subcategory_id: null } : {}),
    ...(Object.keys(UNKNOWN_EXPENSE_CLASSIFICATION).some((key) => Object.hasOwn(base, key)) ? UNKNOWN_EXPENSE_CLASSIFICATION : {}),
    kind: 'expense' as const,
    counterparty_account_id: null,
    amount_cents: cents,
    category: 'juros',
    description: DESCRICAO_JUROS_DO_PIX,
    merchant: null,
  };
}

export function linhasDoLancamento({ fee_cents, ...input }: EntradaLancamento): Record<string, unknown>[] {
  assertPaymentMethod(input.payment_method);
  const compra = { ...input, ...detalheDaEscrita(input, input.kind), ...classificacaoDaEscrita(input, input.kind), source: 'app' as const };
  const linhas: Record<string, unknown>[] = [compra];
  if (fee_cents && fee_cents > 0 && input.kind !== 'income') linhas.push(linhaDeJuros(compra, fee_cents));
  return linhas;
}

/** Canonical conversion/simulation destination: the server links the fee atomically to its owner. */
export function dadosDoLancamento({ fee_cents, ...input }: EntradaLancamento): {
  linhas: Record<string, unknown>[];
  fee_cents?: number;
} {
  return {
    linhas: linhasDoLancamento(input),
    ...(input.kind !== 'income' && fee_cents && fee_cents > 0 ? { fee_cents } : {}),
  };
}

export function argsDaParcelada(e: EntradaParcelada) {
  assertPaymentMethod(e.paymentMethod);
  return {
    rpc: (e.lastDay ? 'create_installment_plan_last_day' : 'create_installment_plan_with_history') as
      | 'create_installment_plan_last_day'
      | 'create_installment_plan_with_history',
    args: {
      ...classificacaoDaEscrita(e),
      ...detalheDaEscrita(e),
      ...(e.paymentMethod !== undefined ? { p_payment_method: e.paymentMethod } : {}),
      p_account_id: e.accountId,
      p_total_cents: e.totalCents,
      p_installments: e.installments,
      p_paid_installments: e.paidInstallments,
      p_occurred_at: e.occurredAt,
      p_description: e.description ?? undefined,
      p_category: e.category ?? undefined,
      p_merchant: e.merchant ?? undefined,
    },
  };
}

export function linhaDaRecorrente(e: EntradaRecorrente): Record<string, unknown> {
  assertPaymentMethod(e.payment_method);
  // âncora da série: sem ela a hora de parede deriva a cada rodada do cron
  return { ...e, ...detalheDaEscrita(e, e.kind), ...classificacaoDaEscrita(e, e.kind), dtstart: e.next_run_at };
}

export function linhaDoFinanciamento(e: EntradaFinanciamento): Record<string, unknown> {
  assertPaymentMethod(e.payment_method);
  const { ...linha } = e as EntradaFinanciamento & { id?: string; versao?: string | null };
  delete (linha as { id?: string }).id;
  delete (linha as { versao?: string | null }).versao;
  return { ...linha, ...detalheDaEscrita(e), ...classificacaoDaEscrita(e) };
}
