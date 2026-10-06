import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@/lib/consulta-em-foco';
import { supabase } from '@/lib/supabase';
import { newClientMessageId } from '@/lib/agent-chat';
import { invalidateFinance } from '@/lib/query-invalidation';
import { useRealtimeInvalidate } from '@/hooks/use-items';
import type { DownPaymentInput } from '@/lib/down-payment';

export type PurchaseType = 'financiamento' | 'parcelada';

export function usePurchaseDownPayment(type: PurchaseType, parentId?: string) {
  useRealtimeInvalidate('transactions', ['transactions']);
  return useQuery({
    queryKey: ['transactions', 'down-payment', type, parentId],
    enabled: Boolean(parentId),
    queryFn: async () => {
      const { data, error } = await supabase.from('transactions')
        .select('id, amount_cents, occurred_at, account_id, status, description, payment_method')
        .eq(type === 'financiamento' ? 'down_payment_debt_id' : 'down_payment_plan_id', parentId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useAddPurchaseDownPayment() {
  const client = useQueryClient();
  const attempt = useRef<{ key: string; id: string } | null>(null);
  return useMutation({
    mutationFn: async (input: { type: PurchaseType; parentId: string; payment: DownPaymentInput }) => {
      const key = JSON.stringify(input);
      if (attempt.current?.key !== key) attempt.current = { key, id: newClientMessageId() };
      const { data, error } = await supabase.rpc('add_purchase_down_payment', {
        p_tipo: input.type, p_parent_id: input.parentId, p_entrada: input.payment, p_request_id: attempt.current.id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateFinance(client),
  });
}
