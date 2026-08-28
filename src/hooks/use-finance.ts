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

/** `month` no formato YYYY-MM; omitido = mês corrente. */
export function useBudgetsStatus(month?: string) {
  useRealtimeInvalidate('transactions', ['budgets-status']);
  useRealtimeInvalidate('budgets', ['budgets-status']);
  const refMonth = month ? `${month}-01` : localISODate();
  return useQuery({
    queryKey: ['budgets-status', refMonth],
    queryFn: async (): Promise<BudgetStatus[]> => {
      const { data, error } = await supabase.rpc('budgets_status', { ref_month: refMonth });
      if (error) throw error;
      return data;
    },
  });
}

// ── mutations (inserts diretos via supabase-js — RLS own-rows cobre) ──────────

const FINANCE_KEYS = [
  ['transactions'], ['tx-summary'], ['monthly-cashflow'], ['account-balances'],
  ['budgets-status'], ['accounts'], ['goals'], ['budgets'], ['recurring'],
  ['card-summary'], ['invoice'], ['forecast'], ['upcoming-bills'], ['debts'], ['payoff'], ['assets'], ['net-worth'], ['financial-health'],
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

/**
 * Cria ou edita uma regra.
 *
 * `account_id` existe em `categorization_rules` desde a `0017` e ficava de fora do input: dava
 * para criar a regra por SQL e não pela tela. Ele entra aqui como campo opcional — `null` é
 * "vale em qualquer conta", e o update precisa mandá-lo explicitamente para conseguir LIMPAR o
 * vínculo de uma regra que já tinha conta.
 *
 * `match_type` continua fixo em `contains` de propósito (`docs/design/regras.md` § Fora de
 * escopo): regex mal escrita categoriza errado em massa e em silêncio, que é a dor que esta tela
 * existe para curar.
 */
export function useSaveRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      pattern: string;
      category: string;
      accountId?: string | null;
    }) => {
      if (input.id) {
        const { error } = await supabase
          .from('categorization_rules')
          .update({
            pattern: input.pattern,
            category: input.category,
            account_id: input.accountId ?? null,
          })
          .eq('id', input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('categorization_rules').insert({
          user_id: await userId(),
          match_type: 'contains',
          pattern: input.pattern,
          category: input.category,
          account_id: input.accountId ?? null,
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

// ── auditoria da IA ─────────────────────────────────────────────────────────

/** Uma ação como a IA entendeu (subconjunto do que interessa mostrar). */
export interface AiActionSummary {
  type: string;
  content?: string | null;
  title?: string | null;
  category?: string | null;
  amount_cents?: number | null;
}

export type AiEvent = Pick<
  Tables['ai_events']['Row'],
  'id' | 'model' | 'confidence' | 'created_at' | 'input_tokens' | 'output_tokens' | 'error'
> & {
  created_transaction_ids: string[] | null;
  actions: AiActionSummary[];
};

/**
 * O que a IA entendeu de cada mensagem, com confiança e custo.
 * Transparência é diferencial aqui: os concorrentes anunciam "99,9% de precisão"
 * e não mostram nada — nem deixam desfazer.
 */
export function useAiEvents(limit = 30) {
  return useQuery({
    queryKey: ['ai-events', String(limit)],
    queryFn: async (): Promise<AiEvent[]> => {
      const { data, error } = await supabase
        .from('ai_events')
        .select(
          'id, model, confidence, created_at, input_tokens, output_tokens, error, result, created_transaction_ids',
        )
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((row) => {
        const parsed = row.result as { actions?: AiActionSummary[] } | null;
        return {
          ...row,
          created_transaction_ids: row.created_transaction_ids,
          actions: Array.isArray(parsed?.actions) ? parsed.actions : [],
        };
      });
    },
  });
}

/** Desfaz um parse: apaga as transações que aquela mensagem criou. */
export function useUndoAiEvent() {
  const invalidate = useInvalidateFinance();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('transactions').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['ai-events'] });
    },
  });
}

// ── dívidas ─────────────────────────────────────────────────────────────────

export const DEBT_KINDS = [
  { value: 'loan', label: 'Empréstimo' },
  { value: 'financing', label: 'Financiamento' },
  { value: 'credit_card', label: 'Rotativo' },
  { value: 'person', label: 'Pessoa' },
  { value: 'other', label: 'Outro' },
] as const;

export type Debt = Pick<
  Tables['debts']['Row'],
  | 'id'
  | 'name'
  | 'principal_cents'
  | 'remaining_cents'
  | 'interest_rate_monthly'
  | 'installments'
  | 'installments_paid'
  | 'installment_cents'
  | 'due_day'
  | 'archived'
> & { kind: (typeof DEBT_KINDS)[number]['value'] };

export type DebtScheduleRow = Fns['debt_schedule']['Returns'][number];
export type PayoffRow = Fns['payoff_strategy']['Returns'][number];

export function useDebts() {
  useRealtimeInvalidate('debts', ['debts']);
  return useQuery({
    queryKey: ['debts'],
    queryFn: async (): Promise<Debt[]> => {
      const { data, error } = await supabase
        .from('debts')
        .select(
          'id, name, kind, principal_cents, remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents, due_day, archived',
        )
        .eq('archived', false)
        .order('remaining_cents', { ascending: false });
      if (error) throw error;
      return data as Debt[];
    },
  });
}

/** Tabela de amortização do que ainda falta pagar (Price, calculada no banco). */
export function useDebtSchedule(debtId: string | undefined) {
  return useQuery({
    enabled: Boolean(debtId),
    queryKey: ['debt-schedule', debtId ?? ''],
    queryFn: async (): Promise<DebtScheduleRow[]> => {
      const { data, error } = await supabase.rpc('debt_schedule', { p_debt_id: debtId! });
      if (error) throw error;
      return data;
    },
  });
}

/** Ordem de ataque: 'avalanche' (mais juros) ou 'snowball' (menor saldo). */
export function usePayoffStrategy(estrategia: 'avalanche' | 'snowball') {
  useRealtimeInvalidate('debts', ['payoff']);
  return useQuery({
    queryKey: ['payoff', estrategia],
    queryFn: async (): Promise<PayoffRow[]> => {
      const { data, error } = await supabase.rpc('payoff_strategy', { estrategia });
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveDebt() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      name: string;
      kind: Debt['kind'];
      principal_cents: number;
      remaining_cents: number;
      interest_rate_monthly: number;
      installments: number | null;
      due_day: number | null;
    }) => {
      const { id, ...resto } = input;
      if (id) {
        const { error } = await supabase.from('debts').update(resto).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('debts').insert({ ...resto, user_id: await userId() });
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });
}

/** Paga uma parcela: a RPC cria a despesa e abate o saldo já descontando juros. */
export function usePayDebtInstallment() {
  const invalidate = useInvalidateFinance();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { debtId: string; amountCents: number; accountId?: string | null }) => {
      const { error } = await supabase.rpc('pay_debt_installment', {
        p_debt_id: input.debtId,
        p_amount_cents: input.amountCents,
        p_account_id: input.accountId ?? undefined,
        p_paid_at: localISODate(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['debt-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['payoff'] });
    },
  });
}

export function useArchiveDebt() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('debts').update({ archived: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

// ── patrimônio, investimentos e relatórios ──────────────────────────────────

export const ASSET_CLASSES = [
  { value: 'investment', label: 'Investimento' },
  { value: 'real_estate', label: 'Imóvel' },
  { value: 'vehicle', label: 'Veículo' },
  { value: 'crypto', label: 'Cripto' },
  { value: 'equity', label: 'Participação' },
  { value: 'receivable', label: 'A receber' },
  { value: 'other', label: 'Outro' },
] as const;

export type Asset = Pick<
  Tables['assets']['Row'],
  'id' | 'name' | 'is_liability' | 'current_value_cents' | 'acquired_at' | 'archived'
> & { class: (typeof ASSET_CLASSES)[number]['value'] };

export type NetWorth = Fns['net_worth']['Returns'][number];
export type NetWorthPoint = Fns['net_worth_series']['Returns'][number];
export type AnnualSummary = Fns['annual_summary']['Returns'][number];
export type AnnualCategoryRow = Omit<Fns['annual_by_category']['Returns'][number], 'kind'> & {
  kind: 'expense' | 'income';
};
export type YearEndBalance = Omit<Fns['year_end_balances']['Returns'][number], 'kind'> & {
  kind: 'account' | 'asset';
};
export type FinancialHealth = Fns['financial_health']['Returns'][number];

export function useAssets() {
  useRealtimeInvalidate('assets', ['assets']);
  return useQuery({
    queryKey: ['assets'],
    queryFn: async (): Promise<Asset[]> => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, name, class, is_liability, current_value_cents, acquired_at, archived')
        .eq('archived', false)
        .order('current_value_cents', { ascending: false });
      if (error) throw error;
      return data as Asset[];
    },
  });
}

/** Patrimônio de hoje, calculado na hora (não espera o snapshot do cron). */
export function useNetWorth() {
  useRealtimeInvalidate('transactions', ['net-worth']);
  useRealtimeInvalidate('assets', ['net-worth']);
  return useQuery({
    queryKey: ['net-worth'],
    queryFn: async (): Promise<NetWorth | null> => {
      const { data, error } = await supabase.rpc('net_worth');
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

/** Série histórica — vem dos snapshots diários, começa quando o app começou. */
export function useNetWorthSeries(monthsBack = 12) {
  return useQuery({
    queryKey: ['net-worth-series', String(monthsBack)],
    queryFn: async (): Promise<NetWorthPoint[]> => {
      const { data, error } = await supabase.rpc('net_worth_series', { months_back: monthsBack });
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveAsset() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      name: string;
      class: Asset['class'];
      is_liability: boolean;
      current_value_cents: number;
      /**
       * Edição: só marca valor novo quando ele mudou de verdade. Sem isso um rename
       * grava uma marcação de hoje no histórico com o valor antigo — dado inventado.
       */
      revalue?: boolean;
    }) => {
      const { id, revalue = true, ...resto } = input;
      if (!id) {
        const { error } = await supabase.from('assets').insert({ ...resto, user_id: await userId() });
        if (error) throw error;
        return;
      }
      // Nome, classe e passivo só existem em `assets` e a RPC de valor não os toca — antes
      // eram descartados em silêncio no modo edição (não havia como renomear nem reclassificar).
      // O valor NUNCA entra por aqui: coluna de valor só muda via update_asset_value.
      const { error: erroAtributos } = await supabase
        .from('assets')
        .update({ name: resto.name, class: resto.class, is_liability: resto.is_liability })
        .eq('id', id);
      if (erroAtributos) throw erroAtributos;

      if (!revalue) return;
      // pela RPC para o valor virar marcação no histórico, não só um update
      const { error } = await supabase.rpc('update_asset_value', {
        p_asset_id: id,
        p_value_cents: resto.current_value_cents,
        p_as_of: localISODate(),
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useArchiveAsset() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('assets').update({ archived: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Relatório do ano: totais, categorias e saldos em 31/12 (o que o IR pede). */
export function useAnnualReport(year: number) {
  return useQuery({
    queryKey: ['annual-report', String(year)],
    queryFn: async (): Promise<{
      summary: AnnualSummary | null;
      categories: AnnualCategoryRow[];
      yearEnd: YearEndBalance[];
    }> => {
      const [summary, categories, yearEnd] = await Promise.all([
        supabase.rpc('annual_summary', { p_year: year }),
        supabase.rpc('annual_by_category', { p_year: year }),
        supabase.rpc('year_end_balances', { p_year: year }),
      ]);
      if (summary.error) throw summary.error;
      if (categories.error) throw categories.error;
      if (yearEnd.error) throw yearEnd.error;
      return {
        summary: summary.data?.[0] ?? null,
        categories: (categories.data ?? []) as AnnualCategoryRow[],
        yearEnd: (yearEnd.data ?? []) as YearEndBalance[],
      };
    },
  });
}

export function useFinancialHealth() {
  useRealtimeInvalidate('transactions', ['financial-health']);
  return useQuery({
    queryKey: ['financial-health'],
    queryFn: async (): Promise<FinancialHealth | null> => {
      const { data, error } = await supabase.rpc('financial_health');
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

// ── plano, família e assinatura ─────────────────────────────────────────────

export const PLANS = [
  { value: 'free', label: 'Free', price: 'grátis', pitch: '1 pessoa · 100 mensagens/mês' },
  { value: 'pro', label: 'Pro', price: 'R$ 24,90/mês', pitch: '3 pessoas · 1.000 mensagens · importação' },
  { value: 'family', label: 'Família', price: 'R$ 39,90/mês', pitch: '5 pessoas · 2.000 mensagens · importação' },
] as const;

export type PlanStatus = Fns['plan_status']['Returns'][number];

export type WorkspaceInvite = Pick<
  Tables['workspace_invites']['Row'],
  'id' | 'phone' | 'created_at'
> & { role: 'member' | 'viewer'; status: 'pending' | 'accepted' | 'revoked' };

export function usePlanStatus() {
  return useQuery({
    queryKey: ['plan-status'],
    queryFn: async (): Promise<PlanStatus | null> => {
      const { data, error } = await supabase.rpc('plan_status');
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

export function useInvites() {
  return useQuery({
    queryKey: ['invites'],
    queryFn: async (): Promise<WorkspaceInvite[]> => {
      const { data, error } = await supabase
        .from('workspace_invites')
        .select('id, phone, role, status, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as WorkspaceInvite[];
    },
  });
}

/**
 * O telefone gravado em `profiles.phone` vem do login (`+55` + dígitos), então o
 * convite precisa guardar no MESMO formato — senão o match no aceite nunca casa.
 */
function normalizaTelefone(entrada: string): string {
  const digitos = entrada.replace(/\D/g, '');
  // 10 ou 11 dígitos = número BR sem DDI; qualquer coisa maior já veio com ele
  return digitos.length <= 11 ? `55${digitos}` : digitos;
}

/** Convite é por telefone: é o mesmo vínculo que o WhatsApp usa. */
export function useInviteMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { phone: string; role: 'member' | 'viewer' }) => {
      const { error } = await supabase.from('workspace_invites').insert({
        workspace_id: await workspaceId(),
        invited_by: await userId(),
        phone: normalizaTelefone(input.phone),
        role: input.role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      queryClient.invalidateQueries({ queryKey: ['plan-status'] });
    },
  });
}

export function useRevokeInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('workspace_invites')
        .update({ status: 'revoked' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });
}

/** Cancelar é uma chamada, sem formulário — de propósito. */
export function useCancelSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('cancel_subscription');
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plan-status'] }),
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

/**
 * Aporte (ou retirada, com valor negativo) pela RPC atômica: grava no ledger e
 * recalcula `saved_cents` a partir da soma. O += no cliente que existia aqui
 * perdia aporte quando dois dispositivos lançavam junto.
 */
export function useGoalDeposit() {
  const invalidate = useInvalidateFinance();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ goal, amountCents, note }: {
      goal: Goal;
      amountCents: number;
      note?: string;
    }) => {
      const { error } = await supabase.rpc('goal_deposit', {
        p_goal_id: goal.id,
        p_amount_cents: amountCents,
        p_occurred_at: localISODate(),
        p_note: note ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['goal-contributions'] });
    },
  });
}

export type GoalContribution = Pick<
  Tables['goal_contributions']['Row'],
  'id' | 'amount_cents' | 'occurred_at' | 'note'
>;

/** Extrato de aportes da meta. */
export function useGoalContributions(goalId: string | undefined) {
  return useQuery({
    enabled: Boolean(goalId),
    queryKey: ['goal-contributions', goalId ?? ''],
    queryFn: async (): Promise<GoalContribution[]> => {
      const { data, error } = await supabase
        .from('goal_contributions')
        .select('id, amount_cents, occurred_at, note')
        .eq('goal_id', goalId!)
        .order('occurred_at', { ascending: false });
      if (error) throw error;
      return data;
    },
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
    mutationFn: async (input: {
      category: string;
      limit_cents: number;
      rollover?: boolean;
      /** YYYY-MM para sobrescrever só aquele mês; omitido = limite padrão. */
      month?: string | null;
    }) => {
      // Via RPC, não upsert: os unique de `budgets` são PARCIAIS (month null vs
      // not null) e o Postgres só casa índice parcial se o ON CONFLICT repetir o
      // predicado — que o PostgREST não tem como mandar. Fazia todo salvamento
      // estourar 42P10.
      const { error } = await supabase.rpc('save_budget', {
        p_category: input.category,
        p_limit_cents: input.limit_cents,
        p_rollover: input.rollover ?? false,
        p_month: input.month ? `${input.month}-01` : undefined,
      });
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
