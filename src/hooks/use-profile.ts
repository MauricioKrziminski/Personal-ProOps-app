import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

/**
 * O perfil de quem está logado — hoje só o nome e o telefone.
 *
 * O nome é o que a saudação da Hoje e o cartão de identidade do Perfil leem. Fica anulável de
 * propósito: quem entrou por Phone OTP nunca informou nome nenhum, e a saudação some inteira
 * nesse caso em vez de virar "Bom dia, ".
 *
 * Sem realtime: nome não muda pelo WhatsApp, só aqui.
 */
export interface Profile {
  display_name: string | null;
  phone: string | null;
}

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['profile', userId],
    enabled: !!userId,
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('display_name, phone')
        .eq('id', userId!)
        .single();
      if (error) throw error;
      return data as Profile;
    },
  });
}

export function useUpdateProfile(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { display_name: string | null }) => {
      if (!userId) throw new Error('sem sessão');
      const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['profile', userId] }),
  });
}
