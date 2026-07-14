import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

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
function useRealtimeInvalidate(table: string, queryKey: string[]) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`realtime:${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        queryClient.invalidateQueries({ queryKey });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, queryClient, queryKey]);
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
  useRealtimeInvalidate('expenses', ['expenses-summary']);
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

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
