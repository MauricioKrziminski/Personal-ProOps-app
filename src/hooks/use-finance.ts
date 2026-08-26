import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';
import { localISODate, monthBounds } from '@/lib/dates';
import { useRealtimeInvalidate, workspaceId } from '@/hooks/use-items';

// Categorias vivem em @/lib/categories (fonte única, travada por teste contra o
// prompt do Gemini); reexportadas aqui para não quebrar os imports das telas.
export { INCOME_CATEGORIES, SUGGESTED_CATEGORIES } from '@/lib/categories';

export const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Corrente' },
  { value: 'savings', label: 'Poupança' },
  { value: 'credit_card', label: 'Cartão' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'investment', label: 'Investimento' },
] as const;

/**
 * Tipos derivados do schema gerado (`src/lib/database.types.ts`): renomear ou
 * remover coluna no banco quebra o `tsc` aqui, não em runtime.
 * As colunas de domínio são `text` + CHECK no Postgres (regra do projeto), então
 * o gerador entrega `string` — o app estreita para union onde a UI depende disso.
 */
type Tables = Database['public']['Tables'];
type Fns = Database['public']['Functions'];

export type TransactionKind = 'expense' | 'income' | 'transfer';
export type TransactionSource = 'whatsapp' | 'app' | 'import' | 'recurring';

export type Transaction = Pick<
  Tables['transactions']['Row'],
  | 'id'
  | 'amount_cents'
  | 'currency'
  | 'category'
  | 'description'
  | 'account_id'
  | 'counterparty_account_id'
  | 'occurred_at' // YYYY-MM-DD
  | 'created_at'
  | 'due_at' // vencimento (fatura do cartão, conta a pagar); null = à vista
  | 'invoice_id'
  | 'installment_plan_id'
  | 'installment_no'
  | 'merchant'
> & {
  kind: TransactionKind;
  source: TransactionSource;
  /** `pending` = ainda vai acontecer (parcela futura, conta a pagar). */
  status: 'pending' | 'cleared';
};

export type Account = Pick<
  Tables['accounts']['Row'],
  | 'id'
  | 'name'
  | 'initial_balance_cents'
  | 'archived'
  // cartão de crédito: null nos demais tipos (check no banco)
  | 'closing_day'
  | 'due_day'
  | 'credit_limit_cents'
  | 'payment_account_id'
> & { type: (typeof ACCOUNT_TYPES)[number]['value'] };

/**
 * Uma linha por cartão. Os campos da fatura são nullable de verdade (left join
 * na RPC: cartão sem nenhuma compra não tem fatura aberta) — o gerador de types
 * não sabe disso, por isso o Omit.
 */
export type CardSummary = Omit<
  Fns['card_summary']['Returns'][number],
  'invoice_id' | 'reference_month' | 'closing_date' | 'due_date' | 'credit_limit_cents'
> & {
  invoice_id: string | null;
  reference_month: string | null;
  closing_date: string | null;
  due_date: string | null;
  credit_limit_cents: number | null;
};

export type CardInvoice = Pick<
  Tables['card_invoices']['Row'],
  'id' | 'account_id' | 'reference_month' | 'closing_date' | 'due_date' | 'status' | 'paid_at'
> & { status: 'open' | 'closed' | 'paid' };

export type AccountBalance = Fns['account_balances']['Returns'][number];

export type Goal = Pick<
  Tables['goals']['Row'],
  'id' | 'name' | 'target_cents' | 'saved_cents' | 'deadline' | 'archived'
>;

export type BudgetStatus = Fns['budgets_status']['Returns'][number];

export type Budget = Pick<Tables['budgets']['Row'], 'id' | 'category' | 'limit_cents'>;

export type RecurringTransaction = Pick<
  Tables['recurring_transactions']['Row'],
  | 'id'
  | 'amount_cents'
  | 'currency'
  | 'category'
  | 'description'
  | 'account_id'
  | 'rrule'
  | 'next_run_at'
  | 'active'
  | 'run_attempts'
  | 'last_error'
  | 'created_at'
> & { kind: 'expense' | 'income' };

export type MonthlyCashflow = Fns['monthly_cashflow']['Returns'][number];

export type TxSummaryRow = Omit<Fns['transactions_summary']['Returns'][number], 'kind'> & {
  kind: 'expense' | 'income';
};

const TRANSACTION_COLUMNS =
  'id, kind, amount_cents, currency, category, description, account_id, counterparty_account_id, occurred_at, source, created_at, status, due_at, invoice_id, installment_plan_id, installment_no, merchant';

export interface TransactionFilters {
  month: string; // YYYY-MM
  kind?: TransactionKind;
  category?: string;
}

// ── queries ───────────────────────────────────────────────────────────────────

export function useTransactions(filters: TransactionFilters) {
  useRealtimeInvalidate('transactions', ['transactions']);
  const { from, to } = monthBounds(filters.month);
  return useQuery({
    queryKey: ['transactions', filters.month, filters.kind ?? '', filters.category ?? ''],
    queryFn: async (): Promise<Transaction[]> => {
      let query = supabase
        .from('transactions')
        .select(TRANSACTION_COLUMNS)
        .gte('occurred_at', from)
        .lte('occurred_at', to)
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);
      if (filters.kind) query = query.eq('kind', filters.kind);
      if (filters.category) query = query.eq('category', filters.category);
      const { data, error } = await query;
      if (error) throw error;
      return data as Transaction[];
    },
  });
}

export function useRecentTransactions(limit = 5) {
  useRealtimeInvalidate('transactions', ['transactions']);
  return useQuery({
    queryKey: ['transactions', 'recent', String(limit)],
    queryFn: async (): Promise<Transaction[]> => {
      const { data, error } = await supabase
        .from('transactions')
        .select(TRANSACTION_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as Transaction[];
    },
  });
}

export function useTransactionsSummary(fromDate: string, toDate: string) {
  useRealtimeInvalidate('transactions', ['tx-summary']);
  return useQuery({
    queryKey: ['tx-summary', fromDate, toDate],
    queryFn: async (): Promise<TxSummaryRow[]> => {
      const { data, error } = await supabase.rpc('transactions_summary', {
        from_date: fromDate,
        to_date: toDate,
      });
      if (error) throw error;
      return data as TxSummaryRow[];
    },
  });
}

export function useMonthlyCashflow(monthsBack = 6) {
  useRealtimeInvalidate('transactions', ['monthly-cashflow']);
  return useQuery({
    queryKey: ['monthly-cashflow', String(monthsBack)],
    queryFn: async (): Promise<MonthlyCashflow[]> => {
      const { data, error } = await supabase.rpc('monthly_cashflow', { months_back: monthsBack });
      if (error) throw error;
      return data;
    },
  });
}

export function useAccountBalances() {
  useRealtimeInvalidate('transactions', ['account-balances']);
  return useQuery({
    queryKey: ['account-balances'],
    queryFn: async (): Promise<AccountBalance[]> => {
      const { data, error } = await supabase.rpc('account_balances');
      if (error) throw error;
      return data;
    },
  });
}

export function useAccounts() {
  useRealtimeInvalidate('accounts', ['accounts']);
  return useQuery({
    queryKey: ['accounts'],
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, name, type, initial_balance_cents, archived, closing_day, due_day, credit_limit_cents, payment_account_id')
        .eq('archived', false)
        .order('created_at');
      if (error) throw error;
      return data as Account[];
    },
  });
}

export function useGoals() {
  useRealtimeInvalidate('goals', ['goals']);
  return useQuery({
    queryKey: ['goals'],
    queryFn: async (): Promise<Goal[]> => {
      const { data, error } = await supabase
        .from('goals')
        .select('id, name, target_cents, saved_cents, deadline, archived')
        .eq('archived', false)
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });
}

const RECURRING_COLUMNS =
  'id, kind, amount_cents, currency, category, description, account_id, rrule, next_run_at, active, run_attempts, last_error, created_at';

/** Séries recorrentes — criadas por WhatsApp, materializadas pelo cron do send-reminders. */
export function useRecurringTransactions() {
  useRealtimeInvalidate('recurring_transactions', ['recurring']);
  return useQuery({
    queryKey: ['recurring'],
    queryFn: async (): Promise<RecurringTransaction[]> => {
      const { data, error } = await supabase
        .from('recurring_transactions')
        .select(RECURRING_COLUMNS)
        // ativas primeiro; dentro de cada grupo, a que roda antes
        .order('active', { ascending: false })
        .order('next_run_at');
      if (error) throw error;
      return data as RecurringTransaction[];
    },
  });
}

export function useBudgets() {
  useRealtimeInvalidate('budgets', ['budgets']);
  return useQuery({
    queryKey: ['budgets'],
    queryFn: async (): Promise<Budget[]> => {
      const { data, error } = await supabase
        .from('budgets')
        .select('id, category, limit_cents')
        .order('category');
      if (error) throw error;
      return data;
    },
  });
}

export function useBudgetsStatus() {
  useRealtimeInvalidate('transactions', ['budgets-status']);
  return useQuery({
    queryKey: ['budgets-status'],
    queryFn: async (): Promise<BudgetStatus[]> => {
      const { data, error } = await supabase.rpc('budgets_status', {
        ref_month: localISODate(),
      });
      if (error) throw error;
      return data;
    },
  });
}

// ── mutations (inserts diretos via supabase-js — RLS own-rows cobre) ──────────

const FINANCE_KEYS = [
  ['transactions'], ['tx-summary'], ['monthly-cashflow'], ['account-balances'],
  ['budgets-status'], ['accounts'], ['goals'], ['budgets'], ['recurring'],
  ['card-summary'], ['invoice'], ['forecast'], ['upcoming-bills'],
];

function useInvalidateFinance() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of FINANCE_KEYS) queryClient.invalidateQueries({ queryKey: key });
  };
}

async function userId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error('sem sessão');
  return data.user.id;
}

// ── cartão de crédito, fatura e parcelas ─────────────────────────────────────

/** Um cartão por linha: fatura aberta, total não pago e limite disponível. */
export function useCardSummary() {
  useRealtimeInvalidate('card_invoices', ['card-summary']);
  useRealtimeInvalidate('transactions', ['card-summary']);
  return useQuery({
    queryKey: ['card-summary'],
    queryFn: async (): Promise<CardSummary[]> => {
      const { data, error } = await supabase.rpc('card_summary');
      if (error) throw error;
      return data as CardSummary[];
    },
  });
}

/** Fatura + as compras dela (RLS já limita ao workspace). */
export function useInvoice(invoiceId: string | undefined) {
  useRealtimeInvalidate('transactions', ['invoice']);
  return useQuery({
    enabled: Boolean(invoiceId),
    queryKey: ['invoice', invoiceId ?? ''],
    queryFn: async (): Promise<{ invoice: CardInvoice; transactions: Transaction[] }> => {
      const [invoiceRes, txRes] = await Promise.all([
        supabase
          .from('card_invoices')
          .select('id, account_id, reference_month, closing_date, due_date, status, paid_at')
          .eq('id', invoiceId!)
          .single(),
        supabase
          .from('transactions')
          .select(TRANSACTION_COLUMNS)
          .eq('invoice_id', invoiceId!)
          .order('occurred_at', { ascending: false }),
      ]);
      if (invoiceRes.error) throw invoiceRes.error;
      if (txRes.error) throw txRes.error;
      return {
        invoice: invoiceRes.data as CardInvoice,
        transactions: txRes.data as Transaction[],
      };
    },
  });
}

/** Paga a fatura: a RPC cria a transferência e marca a fatura (regra no banco). */
export function usePayInvoice() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { invoiceId: string; accountId: string; paidAt: string }) => {
      const { error } = await supabase.rpc('pay_invoice', {
        p_invoice_id: input.invoiceId,
        p_account_id: input.accountId,
        p_paid_at: input.paidAt,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/**
 * Compra parcelada: a RPC cria N transações (uma por mês), as futuras como
 * `pending`, e o trigger do banco resolve a fatura de cada parcela.
 */
export function useCreateInstallmentPlan() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      accountId: string;
      totalCents: number;
      installments: number;
      occurredAt: string;
      description: string | null;
      category: string | null;
    }) => {
      const { error } = await supabase.rpc('create_installment_plan', {
        p_account_id: input.accountId,
        p_total_cents: input.totalCents,
        p_installments: input.installments,
        p_occurred_at: input.occurredAt,
        p_description: input.description ?? undefined,
        p_category: input.category ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

// ── projeção de fluxo de caixa e contas a pagar ─────────────────────────────

export type ForecastDay = Fns['cash_flow_forecast']['Returns'][number];
export type UpcomingBill = Omit<Fns['upcoming_bills']['Returns'][number], 'kind'> & {
  kind: 'invoice' | 'transaction';
};
export type Affordability = Fns['affordability']['Returns'][number];

/**
 * Saldo projetado dia a dia. Sai pronto do banco somando saldo atual + o que
 * está `pending` + faturas não pagas (cada uma na data de vencimento).
 */
export function useCashFlowForecast(days = 90) {
  useRealtimeInvalidate('transactions', ['forecast']);
  return useQuery({
    queryKey: ['forecast', String(days)],
    queryFn: async (): Promise<ForecastDay[]> => {
      const { data, error } = await supabase.rpc('cash_flow_forecast', { days });
      if (error) throw error;
      return data;
    },
  });
}

/** Faturas e lançamentos previstos que vencem no período (atrasados incluídos). */
export function useUpcomingBills(days = 30) {
  useRealtimeInvalidate('transactions', ['upcoming-bills']);
  useRealtimeInvalidate('card_invoices', ['upcoming-bills']);
  return useQuery({
    queryKey: ['upcoming-bills', String(days)],
    queryFn: async (): Promise<UpcomingBill[]> => {
      const { data, error } = await supabase.rpc('upcoming_bills', { days });
      if (error) throw error;
      return data as UpcomingBill[];
    },
  });
}

/** "Posso comprar isso?" — simula N parcelas sobre a projeção. Não grava nada. */
export function useAffordability(amountCents: number, installments: number) {
  return useQuery({
    enabled: amountCents > 0,
    queryKey: ['affordability', String(amountCents), String(installments)],
    queryFn: async (): Promise<Affordability | null> => {
      const { data, error } = await supabase.rpc('affordability', {
        amount_cents: amountCents,
        installments,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

/** Dá baixa num lançamento previsto (pending -> cleared). */
export function useMarkPaid() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { id: string; paidAt: string }) => {
      const { error } = await supabase
        .from('transactions')
        .update({ status: 'cleared', occurred_at: input.paidAt })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

// ── importação de extrato e regras de categorização ─────────────────────────

export type ImportItem = Pick<
  Tables['import_items']['Row'],
  | 'id'
  | 'batch_id'
  | 'amount_cents'
  | 'occurred_at'
  | 'description'
  | 'merchant'
  | 'suggested_category'
  | 'transaction_id'
> & {
  kind: 'expense' | 'income';
  status: 'pending' | 'approved' | 'discarded' | 'duplicate';
};

export type CategorizationRule = Pick<
  Tables['categorization_rules']['Row'],
  'id' | 'pattern' | 'category' | 'account_id' | 'priority' | 'hits'
> & { match_type: 'contains' | 'merchant' | 'regex'; source: 'user' | 'learned' };

export interface ImportResult {
  batch_id: string;
  items: number;
  duplicates: number;
  categorized: number;
}

/**
 * Manda o extrato para a Edge Function, que parseia, aplica as regras do usuário
 * e categoriza o resto com uma única chamada de IA. Nada vira lançamento aqui —
 * o retorno é um lote para revisão.
 */
export function useImportStatement() {
  return useMutation({
    mutationFn: async (input: {
      content: string;
      source: 'ofx' | 'csv';
      filename: string;
      accountId: string | null;
    }): Promise<ImportResult> => {
      const { data, error } = await supabase.functions.invoke<ImportResult | { error: string }>(
        'import-statement',
        {
          body: {
            user_id: await userId(),
            workspace_id: await workspaceId(),
            account_id: input.accountId,
            filename: input.filename,
            content: input.content,
            source: input.source,
          },
        },
      );
      if (error) throw error;
      if (data && 'error' in data) throw new Error(data.error);
      return data as ImportResult;
    },
  });
}

export function useImportItems(batchId: string | undefined) {
  useRealtimeInvalidate('import_items', ['import-items']);
  return useQuery({
    enabled: Boolean(batchId),
    queryKey: ['import-items', batchId ?? ''],
    queryFn: async (): Promise<ImportItem[]> => {
      const { data, error } = await supabase
        .from('import_items')
        .select(
          'id, batch_id, kind, amount_cents, occurred_at, description, merchant, suggested_category, status, transaction_id',
        )
        .eq('batch_id', batchId!)
        .order('occurred_at', { ascending: false });
      if (error) throw error;
      return data as ImportItem[];
    },
  });
}

/** Confirma os itens escolhidos: a RPC cria as transações com source='import'. */
export function useApproveImportItems() {
  const invalidate = useInvalidateFinance();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc('approve_import_items', { p_item_ids: ids });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['import-items'] });
    },
  });
}

export function useDiscardImportItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('import_items')
        .update({ status: 'discarded' })
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['import-items'] }),
  });
}

/** Corrige a categoria sugerida antes de aprovar. */
export function useUpdateImportItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; category: string | null }) => {
      const { error } = await supabase
        .from('import_items')
        .update({ suggested_category: input.category })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['import-items'] }),
  });
}

export function useRules() {
  useRealtimeInvalidate('categorization_rules', ['rules']);
  return useQuery({
    queryKey: ['rules'],
    queryFn: async (): Promise<CategorizationRule[]> => {
      const { data, error } = await supabase
        .from('categorization_rules')
        .select('id, match_type, pattern, category, account_id, priority, hits, source')
        .order('priority')
        .order('hits', { ascending: false });
      if (error) throw error;
      return data as CategorizationRule[];
    },
  });
}

export function useSaveRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; pattern: string; category: string }) => {
      if (input.id) {
        const { error } = await supabase
          .from('categorization_rules')
          .update({ pattern: input.pattern, category: input.category })
          .eq('id', input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('categorization_rules').insert({
          user_id: await userId(),
          match_type: 'contains',
          pattern: input.pattern,
          category: input.category,
          source: 'user',
        });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });
}

export function useDeleteRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('categorization_rules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });
}

export interface TransactionInput {
  kind: TransactionKind;
  amount_cents: number;
  category: string | null;
  description: string | null;
  account_id: string | null;
  counterparty_account_id: string | null;
  occurred_at: string;
}

export function useSaveTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ id, ...input }: TransactionInput & { id?: string }) => {
      if (id) {
        const { error } = await supabase.from('transactions').update(input).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('transactions')
          .insert({ ...input, user_id: await userId(), source: 'app' });
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });
}

export function useDeleteTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('transactions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Cria ou edita (mesma forma de useSaveTransaction: com `id` vira update). */
export function useSaveAccount() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: {
      id?: string;
      name: string;
      type: Account['type'];
      initial_balance_cents: number;
      // só para credit_card; o check do banco exige null nos outros tipos
      closing_day?: number | null;
      due_day?: number | null;
      credit_limit_cents?: number | null;
      payment_account_id?: string | null;
    }) => {
      if (id) {
        const { error } = await supabase.from('accounts').update(input).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('accounts').insert({ ...input, user_id: await userId() });
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });
}

export function useArchiveAccount() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('accounts').update({ archived: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Cria ou edita (mesma forma de useSaveTransaction: com `id` vira update). */
export function useSaveGoal() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: {
      id?: string;
      name: string;
      target_cents: number;
      deadline: string | null;
    }) => {
      if (id) {
        const { error } = await supabase.from('goals').update(input).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('goals').insert({ ...input, user_id: await userId() });
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });
}

export function useGoalDeposit() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ goal, amountCents }: { goal: Goal; amountCents: number }) => {
      const { error } = await supabase
        .from('goals')
        .update({ saved_cents: goal.saved_cents + amountCents })
        .eq('id', goal.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useArchiveGoal() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('goals').update({ archived: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Pausar/retomar a série. Pausada = o cron ignora, mas o histórico fica. */
export function useToggleRecurring() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      // retomar também limpa o erro anterior: a próxima tentativa começa do zero
      const patch = active ? { active: true, run_attempts: 0, last_error: null } : { active: false };
      const { error } = await supabase.from('recurring_transactions').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Apaga a série. Os lançamentos já materializados continuam em transactions. */
export function useDeleteRecurring() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('recurring_transactions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useSaveBudget() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { category: string; limit_cents: number }) => {
      const { error } = await supabase
        .from('budgets')
        .upsert(
          { ...input, user_id: await userId(), workspace_id: await workspaceId() },
          { onConflict: 'workspace_id,category' },
        );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteBudget() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('budgets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
