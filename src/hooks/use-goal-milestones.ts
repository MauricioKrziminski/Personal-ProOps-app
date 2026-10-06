import { useQuery } from '@/lib/consulta-em-foco';

import { useRealtimeInvalidate } from '@/hooks/use-items';
import { supabase } from '@/lib/supabase';

/**
 * F19: os marcos de todas as metas visíveis, em centavos, por meta. Uma consulta só (com 8 metas
 * seriam 8); o que sobe do alvo é filtrado pela tela (`separarMarcos`), não aqui.
 */
export function useGoalMilestones() {
  useRealtimeInvalidate('goal_milestones', ['goal-milestones']);
  return useQuery({
    queryKey: ['goal-milestones'],
    queryFn: async (): Promise<Record<string, number[]>> => {
      const { data, error } = await supabase
        .from('goal_milestones')
        .select('goal_id, amount_cents')
        .order('amount_cents', { ascending: true });
      if (error) throw error;
      const porMeta: Record<string, number[]> = {};
      for (const m of data) (porMeta[m.goal_id] ??= []).push(Number(m.amount_cents));
      return porMeta;
    },
  });
}
