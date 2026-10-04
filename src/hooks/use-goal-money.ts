import { useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { useRealtimeInvalidate } from '@/hooks/use-items';
import { useInvalidateFinance } from '@/hooks/use-finance';
import { newClientMessageId } from '@/lib/agent-chat';
import type { Json } from '@/lib/database.types';
import {
  decodeGoalLinkCandidates, decodeGoalMoneyState, type GoalLinkCandidate, type GoalMoneyInput, type GoalMoneyState,
} from '@/lib/goal-money';
import { supabase } from '@/lib/supabase';

/** Onde está o dinheiro da meta (por conta) e as movimentações dela, da mais recente para a mais antiga. */
export function useGoalMoneyState(goalId: string | undefined, limit = 20) {
  useRealtimeInvalidate('goal_money_movements', ['goal-money']);
  useRealtimeInvalidate('financial_allocations', ['goal-money']);
  useRealtimeInvalidate('transactions', ['goal-money']);
  return useQuery({
    enabled: Boolean(goalId),
    queryKey: ['goal-money', goalId ?? '', limit],
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<GoalMoneyState> => {
      const { data, error } = await supabase.rpc('goal_money_state', { p_goal_id: goalId!, p_limit: limit });
      if (error) throw error;
      return decodeGoalMoneyState(data);
    },
  });
}

/** Transferências lançadas ou importadas que ainda podem virar aporte. */
export function useGoalLinkCandidates(goalId: string | undefined, enabled: boolean) {
  return useQuery({
    enabled: Boolean(goalId) && enabled,
    queryKey: ['goal-link-candidates', goalId ?? ''],
    queryFn: async (): Promise<GoalLinkCandidate[]> => {
      const { data, error } = await supabase.rpc('goal_link_candidates', { p_goal_id: goalId!, p_limit: 50 });
      if (error) throw error;
      return decodeGoalLinkCandidates(data);
    },
  });
}

/**
 * Qualquer movimentação (ou desfazer). A chave da tentativa é estável por intenção, como em
 * `useSaveTransaction`: tocar de novo depois de uma falha de rede repete o MESMO pedido e o banco
 * devolve o resultado anterior em vez de gravar duas vezes.
 */
export function useGoalMoneyCommand() {
  const invalidate = useInvalidateFinance();
  const attempt = useRef<{ key: string; id: string } | null>(null);
  return useMutation({
    mutationFn: async (input: GoalMoneyInput) => {
      const key = JSON.stringify(input);
      if (attempt.current?.key !== key) attempt.current = { key, id: newClientMessageId() };
      const requestId = attempt.current.id;
      const { data, error } = await supabase.rpc('goal_money_command', { p_input: input as unknown as Json, p_request_id: requestId });
      if (error) throw error;
      if (attempt.current?.id === requestId) attempt.current = null;
      return data as unknown as {
        movement_id: string | null; contribution_id: string | null; transfer_id: string | null; saved_cents: string; revision: number;
      };
    },
    onSuccess: invalidate,
  });
}
