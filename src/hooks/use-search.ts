import { useQueries } from '@tanstack/react-query';

import { toTsQuery } from '@/lib/search';
import { supabase } from '@/lib/supabase';

/**
 * Busca global — notas, lançamentos e lembretes.
 *
 * **Três queries independentes, três estados.** Notas resolvendo em 40 ms e lançamentos em 400 ms
 * significa notas na tela em 40 ms; e falha numa seção não pode apagar as outras duas.
 *
 * **Sem realtime de propósito:** resultado de busca é um retrato. Invalidar a cada mensagem que
 * chega do WhatsApp reordenaria a lista embaixo do dedo de quem está lendo.
 */

const LIMIT = 30;
/** Uma letra devolveria o app inteiro. */
const MIN = 2;

export interface NoteHit {
  id: string;
  content: string;
  folder_id: string | null;
  source: string;
  updated_at: string;
}

export interface TransactionHit {
  id: string;
  description: string | null;
  merchant: string | null;
  category: string | null;
  amount_cents: number;
  kind: string;
  occurred_at: string;
}

export interface ReminderHit {
  id: string;
  title: string;
  recurrence: string | null;
  next_run_at: string;
  active: boolean;
}

export function useGlobalSearch(q: string) {
  const term = q.trim();
  const enabled = term.length >= MIN;

  const [notes, transactions, reminders] = useQueries({
    queries: [
      {
        queryKey: ['search', 'notes', term],
        enabled,
        placeholderData: (prev: NoteHit[] | undefined) => prev,
        queryFn: async (): Promise<NoteHit[]> => {
          // A MESMA `toTsQuery` da busca de notas — duas implementações divergiriam em um mês.
          const tsq = toTsQuery(term);
          if (!tsq) return [];
          const { data, error } = await supabase
            .from('notes')
            .select('id, content, folder_id, source, updated_at')
            .is('deleted_at', null)
            .textSearch('search_tsv', tsq, { config: 'pt_unaccent' })
            .order('updated_at', { ascending: false })
            .limit(LIMIT);
          if (error) throw error;
          return data as unknown as NoteHit[];
        },
      },
      {
        queryKey: ['search', 'transactions', term],
        enabled,
        placeholderData: (prev: TransactionHit[] | undefined) => prev,
        queryFn: async (): Promise<TransactionHit[]> => {
          // `transactions` não tem índice full-text — é ilike honesto, não busca semântica.
          const like = `%${term.replace(/[%_,]/g, '')}%`;
          const { data, error } = await supabase
            .from('transactions')
            .select('id, description, merchant, category, amount_cents, kind, occurred_at')
            .or(`description.ilike.${like},merchant.ilike.${like},category.ilike.${like}`)
            .order('occurred_at', { ascending: false })
            .limit(LIMIT);
          if (error) throw error;
          return data as unknown as TransactionHit[];
        },
      },
      {
        queryKey: ['search', 'reminders', term],
        enabled,
        placeholderData: (prev: ReminderHit[] | undefined) => prev,
        queryFn: async (): Promise<ReminderHit[]> => {
          const like = `%${term.replace(/[%_,]/g, '')}%`;
          const { data, error } = await supabase
            .from('reminders')
            .select('id, title, recurrence, next_run_at, active')
            .ilike('title', like)
            .order('next_run_at')
            .limit(LIMIT);
          if (error) throw error;
          return data as unknown as ReminderHit[];
        },
      },
    ],
  });

  return { notes, transactions, reminders, enabled, term };
}
