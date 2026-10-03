import type { TransactionInput } from '@/hooks/use-finance';
import type { Json } from './database.types.ts';
import { argsDaParcelada, classificacaoDaEscrita, detalheDaEscrita, linhaDaRecorrente, linhaDoFinanciamento,
  type EntradaFinanciamento, type EntradaParcelada, type EntradaRecorrente } from './escrita.ts';
import { assertPaymentMethod } from './payment-method.ts';
import type { ExpenseClassification } from './expense-classification.ts';

/** Arguments shared by the rollback preview and the real public write, without request ids. */
export type FinanceWrite =
  | { operation: 'transaction'; args: { p_transaction_id: string | null; p_input: Json;
      p_fee_cents: number | null; p_expected_revision: number | null } }
  | { operation: 'purchase'; args: { p_tipo: 'parcelada' | 'financiamento'; p_dados: Json } }
  | { operation: 'recurring'; args: { p_input: Json } };

export type EntradaEscritaLancamento = TransactionInput & Partial<ExpenseClassification> & {
  subcategory_id?: string | null;
  id?: string;
  expectedRevision?: number;
  fee_cents?: number;
  juros?: { id: string | null; cents: number };
};

export function escritaDoLancamento({ id, fee_cents, juros, expectedRevision, ...input }: EntradaEscritaLancamento):
  Extract<FinanceWrite, { operation: 'transaction' }> {
  if (id && expectedRevision === undefined)
    throw new Error('Atualize o lançamento antes de salvar. Não consegui conferir a versão.');
  assertPaymentMethod(input.payment_method);
  return { operation: 'transaction', args: {
    p_transaction_id: id ?? null,
    p_input: { ...input, ...detalheDaEscrita(input, input.kind), ...classificacaoDaEscrita(input, input.kind) } as unknown as Json,
    p_fee_cents: juros?.cents ?? fee_cents ?? null,
    p_expected_revision: expectedRevision ?? null,
  } };
}

export function escritaDaParcelada(input: EntradaParcelada): Extract<FinanceWrite, { operation: 'purchase' }> {
  const { rpc, args } = argsDaParcelada(input);
  return { operation: 'purchase', args: { p_tipo: 'parcelada', p_dados: {
    ...args, ultimo_dia: rpc === 'create_installment_plan_last_day',
    ...(input.downPayment ? { down_payment: input.downPayment } : {}),
  } } };
}

export function escritaDaRecorrente(input: EntradaRecorrente): Extract<FinanceWrite, { operation: 'recurring' }> {
  return { operation: 'recurring', args: { p_input: linhaDaRecorrente(input) as Json } };
}

export function escritaDoFinanciamento(input: EntradaFinanciamento): Extract<FinanceWrite, { operation: 'purchase' }> {
  const { down_payment, ...resto } = input;
  return { operation: 'purchase', args: { p_tipo: 'financiamento', p_dados: {
    ...linhaDoFinanciamento(resto), ...(down_payment ? { down_payment } : {}),
  } as Json } };
}
