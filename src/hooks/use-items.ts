import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId } from 'react';

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reminders'] }),
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
        .select('id, title, recurrence, next_run_at, channel, active')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as Reminder;
    },
  });
}
