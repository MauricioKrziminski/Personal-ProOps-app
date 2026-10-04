import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRealtimeInvalidate, workspaceId } from '@/hooks/use-items';
import { newClientMessageId } from '@/lib/agent-chat';
import type { Json } from '@/lib/database.types';
import { localISODate } from '@/lib/dates';
import { createGoalPlanSaveController, GoalPlanAttemptCancelledError } from '@/lib/goal-plan-save';
import { decodeGoalPlanningState, type GoalPlanInput, type GoalPlanPreview, type GoalPlanningState } from '@/lib/goal-planning';
import { invalidateFinance } from '@/lib/query-invalidation';
import { supabase } from '@/lib/supabase';

/** One scoped read for the complete scenario; opening an editor can request a fresh snapshot. */
export async function fetchGoalPlanning(
  days: number, view: 'civil' | 'cycle', mode: 'month' | 'day',
  preview: GoalPlanPreview | null = null, ws?: string, signal?: AbortSignal,
): Promise<GoalPlanningState> {
  const scope = ws ?? await workspaceId();
  const payload: Json | null = preview === null ? null : { goals_fingerprint: preview.goals_fingerprint,
    items: preview.items.map(item => ({ ...item })) };
  const request = supabase.rpc('goal_planning_state', {
    p_workspace_id: scope, p_days: days, p_view: view, p_mode: mode, p_preview: payload,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  const state = decodeGoalPlanningState(data);
  if (state.workspace_id !== scope) throw new Error('Não consegui conferir o espaço deste plano.');
  return state;
}
export function useGoalPlanning(
  days: number, view: 'civil' | 'cycle', mode: 'month' | 'day',
  preview: GoalPlanPreview | null = null, enabled = true, ws?: string,
) {
  useGoalPlanningSources();
  return useQuery({
    queryKey: ['goal-planning', ws ?? 'default', localISODate(), days, view, mode, preview],
    queryFn: context => fetchGoalPlanning(days, view, mode, preview, ws, context?.signal),
    placeholderData: undefined,
    enabled,
  });
}
/** Both published read versions observe the same sources and invalidation family. */
export function useGoalPlanningSources() {
  useRealtimeInvalidate('transactions', ['goal-planning']);
  useRealtimeInvalidate('accounts', ['goal-planning']);
  useRealtimeInvalidate('card_invoices', ['goal-planning']);
  useRealtimeInvalidate('recurring_transactions', ['goal-planning']);
  useRealtimeInvalidate('debts', ['goal-planning']);
  useRealtimeInvalidate('goals', ['goal-planning']);
  useRealtimeInvalidate('goal_contributions', ['goal-planning']);
  useRealtimeInvalidate('assets', ['goal-planning']);
  useRealtimeInvalidate('asset_valuations', ['goal-planning']);
  useRealtimeInvalidate('financial_allocations', ['goal-planning']);
  useRealtimeInvalidate('emergency_reserves', ['goal-planning']);
  useRealtimeInvalidate('goal_plans', ['goal-planning']);
  useRealtimeInvalidate('goal_plan_items', ['goal-planning']);
  useRealtimeInvalidate('workspaces', ['goal-planning']);
}
/** Transport ambiguity freezes the same intent until a command-owned receipt resolves it. */
export function useSaveGoalPlan() {
  const client = useQueryClient();
  const [unconfirmedInput, setUnconfirmedInput] = useState<GoalPlanInput | null>(null);
  const [controller] = useState(() => {
    const dispatch = async (name: 'save_goal_plan' | 'resolve_goal_plan_attempt', input: GoalPlanInput, requestId: string) => {
      const payload: Json = { ...input, items: input.items.map(item => ({ ...item })) };
      const { data, error } = await supabase.rpc(name, { p_input: payload, p_request_id: requestId });
      if (error) throw error;
      return data;
    };
    return createGoalPlanSaveController((input, requestId) => dispatch('save_goal_plan', input, requestId),
      newClientMessageId, setUnconfirmedInput, (input, requestId) => dispatch('resolve_goal_plan_attempt', input, requestId));
  });
  const confirmed = () => invalidateFinance(client);
  const refused = (error: unknown) => error instanceof GoalPlanAttemptCancelledError ? confirmed() : undefined;
  const mutation = useMutation({ mutationFn: controller.submit, onSuccess: confirmed, onError: refused });
  const resolution = useMutation({ mutationFn: controller.resolve, onSuccess: confirmed, onError: refused });
  return { ...mutation, isPending: mutation.isPending || resolution.isPending,
    isResolving: resolution.isPending, resolveAsync: resolution.mutateAsync, unconfirmedInput };
}
