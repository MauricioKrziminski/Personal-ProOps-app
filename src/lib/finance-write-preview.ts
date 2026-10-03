import { z } from 'zod';
import {
  CLASSIFICATION_SOURCES, EXPENSE_NECESSITIES, EXPENSE_PATTERNS,
  expenseClassificationFromRecord, type ExpenseClassification,
} from './expense-classification.ts';

export type PreviewSnapshot = {
  balances: { account_id: string | null; cleared_cents: number }[];
  limits: { account_id: string; credit_limit_cents: number | null; available_limit_cents: number | null; limit_status: 'available' | 'not_set' | 'needs_review' }[];
  accounts: { account_id: string | null; saldo_fim: number }[];
  cards: unknown[];
};
export type PreviewScheduleLine = Partial<ExpenseClassification> & {
  origin: 'transaction' | 'recurring' | 'debt_schedule' | 'debt_estimate';
  id: string | null;
  ref_id: string | null;
  occurred_at: string;
  due_at: string | null;
  account_id: string | null;
  counterparty_account_id: string | null;
  kind: 'expense' | 'income' | 'transfer';
  amount_cents: number;
  status: 'cleared' | 'pending' | 'declared';
  description: string | null;
  installment_no: number | null;
  installments_total: number | null;
  invoice_id: string | null;
  invoice_closing_date: string | null;
  invoice_due_date: string | null;
  invoice_status: string | null;
  paid_at?: string | null;
  invoice_paid_at?: string | null;
  is_entry: boolean;
  is_fee: boolean;
  payment_method: string | null;
  estimated: boolean;
};
export type FinancePreview = {
  as_of: string;
  horizon_end: string;
  before: PreviewSnapshot;
  after: PreviewSnapshot;
  write: { operation: string; result: unknown };
  schedule: PreviewScheduleLine[];
  schedule_total: number;
  schedule_truncated: boolean;
  schedule_scope: 'contract' | 'horizon';
  horizon_days: number;
};
export type PreviewQuery = {
  data?: { identity: string; preview: FinancePreview };
  isError: boolean;
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  fetchStatus: 'idle' | 'fetching' | 'paused';
};
export type PreviewState =
  | { kind: 'incomplete' | 'loading' | 'unavailable' }
  | { kind: 'ready'; preview: FinancePreview };

export function estadoDaPrevia(identity: string | null, debouncedIdentity: string | null, query: PreviewQuery): PreviewState {
  if (!identity) return { kind: 'incomplete' };
  // Clear on the FIRST keystroke, before the debounce or the previous request settles.
  if (identity !== debouncedIdentity) return { kind: 'loading' };
  if (query.isError || query.fetchStatus === 'paused') return { kind: 'unavailable' };
  if (query.isPending || query.isFetching || query.isStale || query.data?.identity !== identity) return { kind: 'loading' };
  return { kind: 'ready', preview: query.data.preview };
}

const cents = z.preprocess((value) => {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return value;
}, z.number().int().safe());
const date = z.iso.date();
const snapshotSchema = z.object({
  balances: z.array(z.object({ account_id: z.string().nullable(), cleared_cents: cents })),
  limits: z.array(z.object({ account_id: z.string(), credit_limit_cents: cents.nullable(),
    available_limit_cents: cents.nullable(), limit_status: z.enum(['available', 'not_set', 'needs_review']),
  }).superRefine((row, ctx) => {
    if (row.credit_limit_cents !== null && row.credit_limit_cents < 0
      || row.limit_status === 'available' && (row.credit_limit_cents === null || row.available_limit_cents === null)
      || row.limit_status !== 'available' && row.available_limit_cents !== null
      || row.limit_status === 'not_set' && row.credit_limit_cents !== null)
      ctx.addIssue({ code: 'custom', message: 'Limite sem base confiável' });
  })),
  accounts: z.array(z.object({ account_id: z.string().nullable(), saldo_fim: cents })),
  cards: z.array(z.unknown()),
});
const previewSchema = z.object({
  as_of: date, horizon_end: date,
  before: snapshotSchema, after: snapshotSchema,
  write: z.object({ operation: z.string(), result: z.unknown() }),
  schedule: z.array(z.object({
    origin: z.enum(['transaction', 'recurring', 'debt_schedule', 'debt_estimate']),
    id: z.string().nullable(), ref_id: z.string().nullable(), occurred_at: date,
    due_at: date.nullable(), account_id: z.string().nullable(), counterparty_account_id: z.string().nullable(),
    kind: z.enum(['expense', 'income', 'transfer']), amount_cents: cents.refine((n) => n >= 0),
    status: z.enum(['cleared', 'pending', 'declared']), description: z.string().nullable(),
    installment_no: cents.nullable(), installments_total: cents.nullable(),
    invoice_id: z.string().nullable(), invoice_closing_date: date.nullable(), invoice_due_date: date.nullable(),
    invoice_status: z.string().nullable(), paid_at: date.nullable().optional(), invoice_paid_at: date.nullable().optional(),
    is_entry: z.boolean(), is_fee: z.boolean(), payment_method: z.string().nullable(), estimated: z.boolean(),
    expense_pattern: z.enum(EXPENSE_PATTERNS).nullable().optional(),
    expense_pattern_source: z.enum(CLASSIFICATION_SOURCES).nullable().optional(),
    expense_necessity: z.enum(EXPENSE_NECESSITIES).nullable().optional(),
    expense_necessity_source: z.enum(CLASSIFICATION_SOURCES).nullable().optional(),
  }).superRefine((line, ctx) => {
    try {
      const classification = expenseClassificationFromRecord(line);
      if (line.kind !== 'expense' && Object.values(classification).some((value) => value !== null))
        ctx.addIssue({ code: 'custom', message: 'Classificação só se aplica a gastos' });
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Classificação de gasto inválida' });
    }
  })).max(366),
  schedule_total: cents.refine((n) => n >= 0), schedule_truncated: z.boolean(),
  schedule_scope: z.enum(['contract', 'horizon']), horizon_days: cents.refine((n) => n >= 1 && n <= 366),
}).superRefine((preview, ctx) => {
  if (preview.schedule_total < preview.schedule.length
    || !preview.schedule_truncated && preview.schedule_total !== preview.schedule.length)
    ctx.addIssue({ code: 'custom', message: 'Cronograma incompleto' });
});

export function lerPrevia(data: unknown): FinancePreview {
  return previewSchema.parse(data);
}

export function contasDoEfeito(preview: FinancePreview, accounts: { id: string; name: string; type: string }[]) {
  const ids = new Set(preview.schedule.flatMap((line) =>
    line.counterparty_account_id ? [line.account_id, line.counterparty_account_id] : [line.account_id]));
  for (const after of preview.after.balances) {
    if (preview.before.balances.find((b) => b.account_id === after.account_id)?.cleared_cents !== after.cleared_cents) ids.add(after.account_id);
  }
  for (const after of preview.after.accounts) {
    if (preview.before.accounts.find((a) => a.account_id === after.account_id)?.saldo_fim !== after.saldo_fim) ids.add(after.account_id);
  }
  for (const after of preview.after.limits) {
    const before = preview.before.limits.find((b) => b.account_id === after.account_id);
    if (before?.available_limit_cents !== after.available_limit_cents || before?.limit_status !== after.limit_status) ids.add(after.account_id);
  }
  return [...ids].map((id) => {
    const account = accounts.find((a) => a.id === id);
    const beforeLimit = preview.before.limits.find((l) => l.account_id === id);
    const afterLimit = preview.after.limits.find((l) => l.account_id === id);
    return { id, name: account?.name ?? (id ? 'Conta indisponível' : 'Sem conta'), type: account?.type ?? 'bank',
      balanceBefore: preview.before.balances.find((b) => b.account_id === id)?.cleared_cents ?? null,
      balanceAfter: preview.after.balances.find((b) => b.account_id === id)?.cleared_cents ?? null,
      forecastBefore: preview.before.accounts.find((a) => a.account_id === id)?.saldo_fim ?? null,
      forecastAfter: preview.after.accounts.find((a) => a.account_id === id)?.saldo_fim ?? null,
      limitBefore: beforeLimit?.available_limit_cents ?? null,
      limitAfter: afterLimit?.available_limit_cents ?? null, limitStatus: afterLimit?.limit_status ?? null,
    };
  });
}
