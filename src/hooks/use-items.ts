import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId } from 'react';

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
