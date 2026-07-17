import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { localISODate, useRealtimeInvalidate } from '@/hooks/use-items';

/** Categorias sugeridas — mesma lista do prompt do Gemini (supabase/functions/_shared/gemini.ts). */
export const SUGGESTED_CATEGORIES = [
  'mercado', 'transporte', 'lazer', 'contas', 'saúde', 'casa',
  'educação', 'assinaturas', 'restaurante', 'salário', 'freela', 'outros',
] as const;

export const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Corrente' },
  { value: 'savings', label: 'Poupança' },
  { value: 'credit_card', label: 'Cartão' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'investment', label: 'Investimento' },
] as const;

export type TransactionKind = 'expense' | 'income' | 'transfer';

export interface Transaction {
  id: string;
  kind: TransactionKind;
  amount_cents: number;
  currency: string;
  category: string | null;
  description: string | null;
  account_id: string | null;
  counterparty_account_id: string | null;
  occurred_at: string; // YYYY-MM-DD
  source: 'whatsapp' | 'app' | 'import' | 'recurring';
  created_at: string;
}

export interface Account {
  id: string;
  name: string;
  type: (typeof ACCOUNT_TYPES)[number]['value'];
  initial_balance_cents: number;
  archived: boolean;
}

export interface AccountBalance {
  account_id: string | null;
  name: string;
  type: string;
  balance_cents: number;
}

export interface Goal {
  id: string;
  name: string;
  target_cents: number;
  saved_cents: number;
  deadline: string | null;
  archived: boolean;
}

export interface BudgetStatus {
  category: string;
  limit_cents: number;
  spent_cents: number;
}

export interface Budget {
  id: string;
  category: string;
  limit_cents: number;
}

export interface MonthlyCashflow {
  month: string;
  income_cents: number;
  expense_cents: number;
}

export interface TxSummaryRow {
  kind: 'expense' | 'income';
  category: string;
  total_cents: number;
  tx_count: number;
}

export interface TransactionFilters {
  month: string; // YYYY-MM
  kind?: TransactionKind;
  category?: string;
}

function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = localISODate(new Date(y, m, 0));
  return { from, to };
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
        .select('id, kind, amount_cents, currency, category, description, account_id, counterparty_account_id, occurred_at, source, created_at')
        .gte('occurred_at', from)
        .lte('occurred_at', to)
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);
      if (filters.kind) query = query.eq('kind', filters.kind);
      if (filters.category) query = query.eq('category', filters.category);
      const { data, error } = await query;
      if (error) throw error;
      return data;
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
        .select('id, kind, amount_cents, currency, category, description, account_id, counterparty_account_id, occurred_at, source, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data;
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
      return data;
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
        .select('id, name, type, initial_balance_cents, archived')
        .eq('archived', false)
        .order('created_at');
      if (error) throw error;
      return data;
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
  ['budgets-status'], ['expenses-summary'], ['accounts'], ['goals'], ['budgets'],
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

export function useSaveAccount() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { name: string; type: Account['type']; initial_balance_cents: number }) => {
      const { error } = await supabase
        .from('accounts')
        .insert({ ...input, user_id: await userId() });
      if (error) throw error;
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

export function useSaveGoal() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { name: string; target_cents: number; deadline: string | null }) => {
      const { error } = await supabase.from('goals').insert({ ...input, user_id: await userId() });
      if (error) throw error;
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

export function useSaveBudget() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { category: string; limit_cents: number }) => {
      const { error } = await supabase
        .from('budgets')
        .upsert({ ...input, user_id: await userId() }, { onConflict: 'user_id,category' });
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
