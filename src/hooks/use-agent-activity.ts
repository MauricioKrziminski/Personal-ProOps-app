import { useQuery } from '@tanstack/react-query';

import { useRealtimeInvalidate } from '@/hooks/use-items';
import type { LinhaDaAtividade } from '@/lib/activity-feed';
import { supabase } from '@/lib/supabase';

/**
 * O que a pessoa disse e o que virou (`public.agent_activity`).
 *
 * `executed_actions` não entra no Realtime (sem policy, nada seria entregue). O que a conversa
 * escreve cai em lançamentos, lembretes e notas — que já têm tempo real — e é por eles que a
 * leitura se renova.
 */
export function useAgentActivity(limit = 6) {
  useRealtimeInvalidate('transactions', ['agent-activity']);
  useRealtimeInvalidate('reminders', ['agent-activity']);
  useRealtimeInvalidate('notes', ['agent-activity']);
  return useQuery({
    queryKey: ['agent-activity', String(limit)],
    queryFn: async (): Promise<LinhaDaAtividade[]> => {
      const { data, error } = await supabase.rpc('agent_activity', { p_limit: limit });
      if (error) throw error;
      return (data ?? []) as unknown as LinhaDaAtividade[];
    },
  });
}
