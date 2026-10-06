import { useQuery } from '@/lib/consulta-em-foco';
import { usePresencaAtiva } from '@/components/motion/presenca';
import { useDebounced } from '@/hooks/use-debounced';
import { useRealtimeInvalidate } from '@/hooks/use-items';
import type { FinanceWrite } from '@/lib/finance-write-input';
import { estadoDaPrevia, lerPrevia } from '@/lib/finance-write-preview';
import type { Json } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export function opcoesDaPrevia(identity: string | null, ready: boolean) {
  return { queryKey: ['finance-write-preview', identity], enabled: Boolean(identity && ready),
    staleTime: Infinity, gcTime: 0, retry: false, refetchOnMount: 'always' as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const write = JSON.parse(identity!) as FinanceWrite;
      const { data, error } = await supabase.rpc('preview_finance_write', {
        p_operation: write.operation, p_args: write.args as Json, p_days: 90,
      }).abortSignal(signal);
      if (error) throw error;
      return { identity: identity!, preview: lerPrevia(data) };
    },
  };
}

export function useFinanceWritePreview(write: FinanceWrite | null) {
  const active = usePresencaAtiva();
  const identity = write ? JSON.stringify(write) : null;
  const debounced = useDebounced(identity, 350);
  useRealtimeInvalidate('transactions', ['finance-write-preview']);
  useRealtimeInvalidate('accounts', ['finance-write-preview']);
  useRealtimeInvalidate('card_invoices', ['finance-write-preview']);
  useRealtimeInvalidate('recurring_transactions', ['finance-write-preview']);
  useRealtimeInvalidate('debts', ['finance-write-preview']);
  const query = useQuery(opcoesDaPrevia(identity, active && identity === debounced));
  return { identity, state: estadoDaPrevia(identity, debounced, query), retry: query.refetch };
}
