import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRealtimeInvalidate, workspaceId } from '@/hooks/use-items';
import { newClientMessageId } from '@/lib/agent-chat';
import type { Json } from '@/lib/database.types';
import { invalidateFinance } from '@/lib/query-invalidation';
import { createSubcategorySaveController, SubcategoryAttemptCancelledError } from '@/lib/subcategory-save';
import { decodeSubcategoryState, type SubcategoryState, type SubcategoryWriteInput } from '@/lib/subcategories';
import { supabase } from '@/lib/supabase';

/** A read belongs to one concrete workspace; previous-scope data is never a placeholder. */
export async function fetchSubcategories(ws?: string, signal?: AbortSignal): Promise<SubcategoryState> {
  const scope = ws ?? await workspaceId();
  const request = supabase.rpc('subcategory_state', { p_workspace_id: scope });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  const state = decodeSubcategoryState(data);
  if (state.workspace_id !== scope.toLowerCase()) throw new Error('Não consegui conferir o espaço destes detalhes.');
  return state;
}
export function useSubcategories(ws?: string, enabled = true) {
  useRealtimeInvalidate('subcategories', ['subcategories']);
  useRealtimeInvalidate('transactions', ['subcategories']);
  return useQuery({
    queryKey: ['subcategories', ws ?? 'default'],
    queryFn: context => fetchSubcategories(ws, context.signal),
    placeholderData: undefined,
    enabled,
  });
}
/** The command-owned controller retains a transport-ambiguous intent across retry and resolve. */
export function useWriteSubcategory() {
  const client = useQueryClient();
  const [unconfirmedInput, setUnconfirmedInput] = useState<SubcategoryWriteInput | null>(null);
  const [controller] = useState(() => {
    const dispatch = async (name: 'write_subcategory' | 'resolve_subcategory_attempt', input: SubcategoryWriteInput, requestId: string) => {
      const payload: Json = { ...input };
      const { data, error } = await supabase.rpc(name, { p_input: payload, p_request_id: requestId });
      if (error) throw error;
      return data;
    };
    return createSubcategorySaveController((input, requestId) => dispatch('write_subcategory', input, requestId),
      newClientMessageId, setUnconfirmedInput, (input, requestId) => dispatch('resolve_subcategory_attempt', input, requestId));
  });
  const confirmed = () => invalidateFinance(client);
  const refused = (error: unknown) => error instanceof SubcategoryAttemptCancelledError ? confirmed() : undefined;
  const mutation = useMutation({ mutationFn: controller.submit, onSuccess: confirmed, onError: refused });
  const resolution = useMutation({ mutationFn: controller.resolve, onSuccess: confirmed, onError: refused });
  return { ...mutation, isPending: mutation.isPending || resolution.isPending,
    isResolving: resolution.isPending, resolveAsync: resolution.mutateAsync, unconfirmedInput };
}
