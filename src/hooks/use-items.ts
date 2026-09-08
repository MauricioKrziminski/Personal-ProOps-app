import { scheduleRealtimeFinanceRefresh, invalidateKeys } from '@/lib/query-invalidation';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { localISODate } from '@/lib/dates';
import { supabase } from '@/lib/supabase';

// Helpers puros vivem em @/lib/dates (testáveis fora do RN); reexportados aqui
// para não quebrar os imports existentes das telas.
export { formatBRL, formatDateBR, localISODate } from '@/lib/dates';

export interface Note {
  id: string;
  content: string;
  category: string | null;
  source: 'whatsapp' | 'app';
  created_at: string;
}

export interface Reminder {
  id: string;
  title: string;
  recurrence: string | null;
  next_run_at: string;
  channel: 'push' | 'whatsapp' | 'both';
  active: boolean;
  /**
   * Só `useReminder` (o detalhe) traz estes dois — a lista não os usa. O `send-reminders`
   * desativa a série ao chegar em 5 tentativas, e sem isso na UI o lembrete simplesmente
   * parava de chegar sem ninguém saber por quê.
   */
  send_attempts?: number;
  last_error?: string | null;
}

const financialTables = new Set([
  'transactions', 'accounts', 'card_invoices', 'installment_plans', 'budgets',
  'recurring_transactions', 'debts', 'goals', 'goal_contributions', 'assets',
]);
let nextSubscriptionId = 0;
const subscriptions = new WeakMap<QueryClient, Map<string, {
  channel: ReturnType<typeof supabase.channel>;
  keys: Map<string, { queryKey: string[]; count: number }>;
}>>();

/** One subscription per table/client; derived reads update even on mounted sibling screens. */
export function useRealtimeInvalidate(table: string, queryKey: string[]) {
  const queryClient = useQueryClient();
  const key = JSON.stringify(queryKey);
  useEffect(() => {
    let tables = subscriptions.get(queryClient);
    if (!tables) { tables = new Map(); subscriptions.set(queryClient, tables); }
    let entry = tables.get(table);
    if (!entry) {
      const keys = new Map<string, { queryKey: string[]; count: number }>();
      const channel = supabase.channel(`realtime:${table}:${++nextSubscriptionId}`).on(
        'postgres_changes', { event: '*', schema: 'public', table }, () => {
          if (financialTables.has(table)) return scheduleRealtimeFinanceRefresh(queryClient);
          return invalidateKeys(queryClient, [...keys.values()].map((value) => value.queryKey));
        },
      ).subscribe();
      entry = { channel, keys };
      tables.set(table, entry);
    }
    const existing = entry.keys.get(key);
    entry.keys.set(key, { queryKey: JSON.parse(key), count: (existing?.count ?? 0) + 1 });
    return () => {
      const value = entry.keys.get(key)!;
      if (value.count > 1) value.count -= 1;
      else entry.keys.delete(key);
      if (entry.keys.size === 0) {
        void supabase.removeChannel(entry.channel);
        tables.delete(table);
      }
    };
  }, [table, queryClient, key]);
}

export function useNotes() {
  useRealtimeInvalidate('notes', ['notes']);
  return useQuery({
    queryKey: ['notes'],
    queryFn: async (): Promise<Note[]> => {
      const { data, error } = await supabase
        .from('notes')
        .select('id, content, category, source, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as Note[];
    },
  });
}

export function useReminders() {
  useRealtimeInvalidate('reminders', ['reminders']);
  return useQuery({
    queryKey: ['reminders'],
    queryFn: async (): Promise<Reminder[]> => {
      const { data, error } = await supabase
        .from('reminders')
        .select('id, title, recurrence, next_run_at, channel, active')
        // pausados também vêm: sem eles não haveria como retomar pelo app
        .order('active', { ascending: false })
        .order('next_run_at')
        .limit(100);
      if (error) throw error;
      return data as Reminder[];
    },
  });
}

async function userId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error('sem sessão');
  return data.user.id;
}

/**
 * Workspace ativo do usuário (escopo do dado desde a migration 0010).
 * Inserts normais não precisam disso — a coluna tem DEFAULT my_default_workspace().
 * Só é necessário quando o upsert precisa citar as colunas do conflito.
 */
export async function workspaceId(): Promise<string> {
  const { data, error } = await supabase.rpc('my_default_workspace');
  if (error || !data) throw error ?? new Error('sem workspace');
  return data as string;
}

export function useCreateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const { error } = await supabase
        .from('notes')
        .insert({ user_id: await userId(), content, source: 'app' });
      if (error) throw error;
    },
    onSuccess: () => invalidateKeys(queryClient, [['notes'], ['search', 'notes'], ['ai-month-stats']]),
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('notes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateKeys(queryClient, [['notes'], ['search', 'notes'], ['ai-month-stats']]),
  });
}

export interface ReminderInput {
  id?: string;
  title: string;
  recurrence: string | null;
  next_run_at: string; // ISO absoluto
  channel: Reminder['channel'];
  timezone: string;
}

/** Cria ou edita (com `id` vira update), no mesmo formato de useSaveTransaction. */
export function useSaveReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: ReminderInput) => {
      if (id) {
        // reagendar reativa e zera o contador: a série volta a valer do zero
        const { error } = await supabase
          .from('reminders')
          .update({ ...input, active: true, send_attempts: 0, last_error: null })
          .eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('reminders')
          .insert({ ...input, user_id: await userId(), source: 'app' });
        if (error) throw error;
      }
    },
    onSuccess: () => invalidateKeys(queryClient, [['reminders'], ['search', 'reminders']]),
  });
}

/** Pausa ou retoma. Retomar limpa o erro anterior. */
export function useToggleReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const patch = active ? { active: true, send_attempts: 0, last_error: null } : { active: false };
      const { error } = await supabase.from('reminders').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateKeys(queryClient, [['reminders'], ['search', 'reminders']]),
  });
}

export function useDeleteReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('reminders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateKeys(queryClient, [['reminders'], ['search', 'reminders']]),
  });
}

/**
 * Lembretes que vencem hoje (no fuso do usuário) — o bloco "o que vence" da aba Hoje.
 *
 * A aba Lembretes deixou de existir: lembrete não é um destino, é algo que vence.
 */
export function useTodayReminders() {
  useRealtimeInvalidate('reminders', ['reminders', 'today']);
  const today = localISODate();
  return useQuery({
    queryKey: ['reminders', 'today', today],
    queryFn: async (): Promise<Reminder[]> => {
      const end = new Date(`${today}T23:59:59`);
      const { data, error } = await supabase
        .from('reminders')
        .select('id, title, recurrence, next_run_at, channel, active')
        .eq('active', true)
        .lte('next_run_at', end.toISOString())
        .order('next_run_at')
        .limit(20);
      if (error) throw error;
      return data as Reminder[];
    },
  });
}

/** Um lembrete por id — mesmo motivo do `useTransaction`: cache de lista não é fonte de verdade. */
export function useReminder(id: string | undefined) {
  return useQuery({
    queryKey: ['reminders', 'item', id],
    enabled: !!id,
    queryFn: async (): Promise<Reminder> => {
      const { data, error } = await supabase
        .from('reminders')
        .select('id, title, recurrence, next_run_at, channel, active, send_attempts, last_error')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as Reminder;
    },
  });
}
