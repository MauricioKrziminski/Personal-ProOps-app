import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId } from 'react';

import { supabase } from '@/lib/supabase';

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
}

export interface CategorySummary {
  category: string;
  total_cents: number;
  expense_count: number;
}

/** Invalida a query quando a tabela muda (itens novos vindos do WhatsApp aparecem ao vivo). */
export function useRealtimeInvalidate(table: string, queryKey: string[]) {
  const queryClient = useQueryClient();
  // string estável nas deps: um array literal novo a cada render re-subscreveria o canal sem parar
  const key = JSON.stringify(queryKey);
  // supabase.channel(nome) REUTILIZA canal existente com o mesmo nome; dois hooks com a mesma
  // tabela+key colidiriam ("cannot add callbacks after subscribe") — id único por instância.
  const instanceId = useId();
  useEffect(() => {
    const parsedKey = JSON.parse(key) as string[];
    const channel = supabase
      .channel(`realtime:${table}:${key}:${instanceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        queryClient.invalidateQueries({ queryKey: parsedKey });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, queryClient, key, instanceId]);
}

/** Data local em YYYY-MM-DD — nunca toISOString() (UTC desloca o dia em GMT-3). */
export function localISODate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
      return data;
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
        .eq('active', true)
        .order('next_run_at')
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
}

export function useExpensesSummary(fromDate: string, toDate: string) {
  useRealtimeInvalidate('transactions', ['expenses-summary']);
  return useQuery({
    queryKey: ['expenses-summary', fromDate, toDate],
    queryFn: async (): Promise<CategorySummary[]> => {
      const { data, error } = await supabase.rpc('expenses_summary', {
        from_date: fromDate,
        to_date: toDate,
      });
      if (error) throw error;
      return data;
    },
  });
}

async function userId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error('sem sessão');
  return data.user.id;
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes'] }),
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('notes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes'] }),
  });
}

export function usePauseReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('reminders').update({ active: false }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reminders'] }),
  });
}

export function useDeleteReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('reminders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reminders'] }),
  });
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Data em dd-mm-yyyy (aceita ISO string ou Date). */
export function formatDateBR(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}
