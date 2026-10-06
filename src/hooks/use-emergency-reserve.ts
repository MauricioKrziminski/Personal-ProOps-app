import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@/lib/consulta-em-foco';

import { useRealtimeInvalidate, workspaceId } from '@/hooks/use-items';
import { newClientMessageId } from '@/lib/agent-chat';
import type { Json } from '@/lib/database.types';
import { localISODate } from '@/lib/dates';
import {
  createEmergencyReserveSaveController,
  decodeEmergencyReserveState,
  EmergencyReserveAttemptCancelledError,
  type EmergencyReserveInput,
} from '@/lib/emergency-reserve';
import { invalidateFinance } from '@/lib/query-invalidation';
import { supabase } from '@/lib/supabase';

/** Dedicated default-workspace reserve; every source and history read shares that scope. */
export function useEmergencyReserve() {
  const asOf = localISODate();
  useRealtimeInvalidate('transactions', ['emergency-reserve']);
  useRealtimeInvalidate('accounts', ['emergency-reserve']);
  useRealtimeInvalidate('assets', ['emergency-reserve']);
  useRealtimeInvalidate('asset_valuations', ['emergency-reserve']);
  useRealtimeInvalidate('goals', ['emergency-reserve']);
  useRealtimeInvalidate('goal_contributions', ['emergency-reserve']);
  useRealtimeInvalidate('emergency_reserves', ['emergency-reserve']);
  useRealtimeInvalidate('financial_allocations', ['emergency-reserve']);
  useRealtimeInvalidate('reserve_month_reviews', ['emergency-reserve']);
  return useQuery({
    queryKey: ['emergency-reserve', 'default', asOf],
    queryFn: async () => {
      const ws = await workspaceId();
      // The server owns today's BRT date; a device's timezone/clock must not reject this read.
      const { data, error } = await supabase.rpc('emergency_reserve_state', { p_workspace_id: ws });
      if (error) throw error;
      const state = decodeEmergencyReserveState(data);
      if (state.workspace_id !== ws) throw new Error('Não consegui conferir o espaço desta reserva.');
      return state;
    },
  });
}

/** Ambiguous transport outcomes retain the exact immutable intent until confirmed. */
export function useSaveEmergencyReserve() {
  const client = useQueryClient();
  const [unconfirmedInput, setUnconfirmedInput] = useState<EmergencyReserveInput | null>(null);
  const [controller] = useState(() => {
    const dispatch = async (name: 'save_emergency_reserve' | 'resolve_emergency_reserve_attempt', input: EmergencyReserveInput, requestId: string) => {
      const { data, error } = await supabase.rpc(name, { p_input: input as unknown as Json, p_request_id: requestId });
      if (error) throw error;
      return data;
    };
    return createEmergencyReserveSaveController((input, requestId) => dispatch('save_emergency_reserve', input, requestId),
      newClientMessageId, setUnconfirmedInput, (input, requestId) => dispatch('resolve_emergency_reserve_attempt', input, requestId));
  });
  const confirmed = () => invalidateFinance(client);
  const refused = (error: unknown) => error instanceof EmergencyReserveAttemptCancelledError ? confirmed() : undefined;
  const mutation = useMutation({ mutationFn: controller.submit, onSuccess: confirmed, onError: refused });
  const resolution = useMutation({ mutationFn: controller.resolve, onSuccess: confirmed, onError: refused });
  return { ...mutation, isPending: mutation.isPending || resolution.isPending,
    isResolving: resolution.isPending, resolveAsync: resolution.mutateAsync, unconfirmedInput };
}
