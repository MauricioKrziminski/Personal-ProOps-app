import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@/lib/consulta-em-foco';

import { useGoalPlanningSources } from '@/hooks/use-goal-planning';
import { workspaceId } from '@/hooks/use-items';
import { newClientMessageId } from '@/lib/agent-chat';
import type { Json } from '@/lib/database.types';
import { localISODate } from '@/lib/dates';
import { decodeGoalHorizonState, type GoalHorizonInput, type GoalHorizonPreview, type GoalHorizonState } from '@/lib/goal-horizon';
import { createGoalHorizonSaveController } from '@/lib/goal-horizon-save';
import { GoalPlanAttemptCancelledError } from '@/lib/goal-plan-save';
import { invalidateFinance } from '@/lib/query-invalidation';
import { supabase } from '@/lib/supabase';

export async function fetchGoalHorizonPlanning(
  days: number, view: 'civil' | 'cycle', mode: 'month' | 'day',
  preview: GoalHorizonPreview | null = null, ws?: string, signal?: AbortSignal,
): Promise<GoalHorizonState> {
  const scope = ws ?? await workspaceId();
  const payload: Json | null = preview === null ? null : { goals_fingerprint: preview.goals_fingerprint,
    items: preview.items.map(item => ({ ...item })) };
  const request = supabase.rpc('goal_planning_state_v2', {
    p_workspace_id: scope, p_days: days, p_view: view, p_mode: mode, p_preview: payload,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  const state = decodeGoalHorizonState(data);
  if (state.workspace_id !== scope) throw new Error('Não consegui conferir o espaço deste plano.');
  return state;
}
export function useGoalHorizonPlanning(
  days: number, view: 'civil' | 'cycle', mode: 'month' | 'day',
  preview: GoalHorizonPreview | null = null, enabled = true, ws?: string,
) {
  useGoalPlanningSources();
  return useQuery({
    queryKey: ['goal-planning', 'v2', ws ?? 'default', localISODate(), days, view, mode, preview],
    queryFn: context => fetchGoalHorizonPlanning(days, view, mode, preview, ws, context?.signal),
    placeholderData: undefined, enabled,
  });
}
export function useSaveGoalHorizon() {
  const client = useQueryClient();
  const [unconfirmedInput, setUnconfirmedInput] = useState<GoalHorizonInput | null>(null);
  const [controller] = useState(() => {
    const dispatch = async (name: 'save_goal_plan_v2' | 'resolve_goal_plan_attempt_v2', input: GoalHorizonInput, requestId: string) => {
      const payload: Json = { ...input, items: input.items.map(item => ({ ...item })) };
      const { data, error } = await supabase.rpc(name, { p_input: payload, p_request_id: requestId });
      if (error) throw error;return data;
    };
    return createGoalHorizonSaveController((input, id) => dispatch('save_goal_plan_v2', input, id), newClientMessageId,
      setUnconfirmedInput, (input, id) => dispatch('resolve_goal_plan_attempt_v2', input, id));
  });
  const confirmed = () => invalidateFinance(client);
  const refused = (error: unknown) => error instanceof GoalPlanAttemptCancelledError ? confirmed() : undefined;
  const mutation = useMutation({ mutationFn: controller.submit, onSuccess: confirmed, onError: refused });
  const resolution = useMutation({ mutationFn: controller.resolve, onSuccess: confirmed, onError: refused });
  return { ...mutation, isPending: mutation.isPending || resolution.isPending,
    isResolving: resolution.isPending, resolveAsync: resolution.mutateAsync, unconfirmedInput };
}
