import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useRealtimeInvalidate } from '@/hooks/use-items';
import { useQuery } from '@/lib/consulta-em-foco';
import { supabase } from '@/lib/supabase';

export interface ApelidoDaConta {
  id: string;
  alias: string;
  created_at: string;
}

/** Apelidos que o agente aprendeu para UMA conta. Só o serviço cria; a pessoa lê e apaga (RLS). */
export function useApelidosDaConta(accountId: string | null | undefined) {
  useRealtimeInvalidate('account_aliases', ['account-aliases']);
  return useQuery({
    queryKey: ['account-aliases', accountId],
    enabled: Boolean(accountId),
    queryFn: async (): Promise<ApelidoDaConta[]> => {
      const { data, error } = await supabase
        .from('account_aliases')
        .select('id, alias, created_at')
        .eq('account_id', accountId as string)
        .order('alias');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRemoverApelido() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('account_aliases').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account-aliases'] }),
  });
}
