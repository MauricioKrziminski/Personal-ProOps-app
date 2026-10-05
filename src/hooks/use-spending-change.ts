import { useQuery } from '@tanstack/react-query';

import { useRealtimeInvalidate } from '@/hooks/use-items';
import { decodeSpendingChange, type SpendingChange, type SpendingDimension, type SpendingPeriods } from '@/lib/spending-change';
import { supabase } from '@/lib/supabase';

/** Contribuição de cada grupo à diferença de gasto entre dois períodos já resolvidos pela tela. */
export function useSpendingChange(periods: SpendingPeriods | null, dimension: SpendingDimension) {
  useRealtimeInvalidate('transactions', ['spending-change']);
  return useQuery({
    enabled: periods !== null,
    queryKey: ['spending-change', periods, dimension],
    queryFn: async ({ signal }): Promise<SpendingChange> => {
      if (!periods) throw new Error('Período não informado.');
      const { data, error } = await supabase.rpc('spending_change', {
        p_cur_from: periods.curFrom, p_cur_to: periods.curTo,
        p_prev_from: periods.prevFrom, p_prev_to: periods.prevTo, p_dimension: dimension,
      }).abortSignal(signal);
      if (error) throw error;
      return decodeSpendingChange(data);
    },
  });
}
