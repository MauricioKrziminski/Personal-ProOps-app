/**
 * A ENTRADA de cada hook de criação → o que vai ao banco (spec 2026-09-28, seção 2).
 *
 * Um lugar só, usado pelo salvar real e pela hipótese (`simular`): o que foi simulado é, byte a
 * byte, o que é aplicado. `user_id` fica de fora — o hook põe o da sessão, e `simular` põe
 * `auth.uid()` no banco.
 */
import { assertPaymentMethod, type PaymentMethod } from './payment-method.ts';
import type { Debt, TransactionInput } from '@/hooks/use-finance';
import type { DownPaymentInput } from './down-payment.ts';

export const DESCRICAO_JUROS_DO_PIX = 'Juros do Pix no crédito';

export type EntradaLancamento = TransactionInput & { fee_cents?: number; payment_method?: PaymentMethod | null };
export type EntradaParcelada = {
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
export type EntradaRecorrente = {
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
export type EntradaFinanciamento = {
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

/**
 * A linha de juros do Pix no crédito a partir da linha principal: SEMPRE uma despesa no cartão,
 * sem destino (movida de `use-finance.ts`, 28/09/2026).
 */
export function linhaDeJuros<T extends Record<string, unknown>>(base: T, cents: number) {
  return {
    ...base,
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
  const compra = { ...input, source: 'app' as const };
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
  return { ...e, dtstart: e.next_run_at };
}

export function linhaDoFinanciamento(e: EntradaFinanciamento): Record<string, unknown> {
  assertPaymentMethod(e.payment_method);
  const { ...linha } = e as EntradaFinanciamento & { id?: string; versao?: string | null };
  delete (linha as { id?: string }).id;
  delete (linha as { versao?: string | null }).versao;
  return linha;
}
