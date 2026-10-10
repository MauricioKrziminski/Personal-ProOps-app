import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useQuery } from '@/lib/consulta-em-foco';
import { useSession } from '@/hooks/use-session';
import { bancoSolto } from '@/lib/banco-solto';
import { argumentosDoAceite } from '@/lib/termos';

export interface Consentimento {
  terms_version: string | null;
  ai_consent_at: string | null;
}

/** Opções compartilhadas: o portão da raiz (`use-acesso`) lê a MESMA chave que o Perfil. */
export const consentimentoQuery = (userId: string | undefined) => ({
  queryKey: ['consentimento', userId],
  queryFn: async (): Promise<Consentimento> => {
    const { data, error } = await bancoSolto
      .from('profiles')
      .select('terms_version, ai_consent_at')
      .eq('id', userId)
      .maybeSingle<Consentimento>();
    if (error) throw new Error(error.message);
    // Sem linha de perfil não há onde gravar o aceite: tratar como erro (o portão falha aberto)
    // em vez de prender a pessoa numa tela que nunca sai.
    if (!data) throw new Error('perfil ausente');
    return data;
  },
});

export function useConsentimento() {
  const userId = useSession().session?.user.id;
  return useQuery({ ...consentimentoQuery(userId), enabled: !!userId });
}

function useGravarConsentimento<V>(
  chamar: (v: V) => PromiseLike<{ data: Partial<Consentimento> | null; error: { message: string } | null }>,
) {
  const client = useQueryClient();
  const userId = useSession().session?.user.id;
  return useMutation({
    mutationFn: async (v: V) => {
      const { data, error } = await chamar(v);
      if (error) throw new Error(error.message);
      return data ?? {};
    },
    onSuccess: (novo) => {
      client.setQueryData<Consentimento>(['consentimento', userId], (antes) => ({
        terms_version: antes?.terms_version ?? null,
        ai_consent_at: antes?.ai_consent_at ?? null,
        ...novo,
      }));
      return client.invalidateQueries({ queryKey: ['consentimento', userId] });
    },
  });
}

/** "Concordo e continuar": grava a versão dos Termos e, junto, a escolha de IA. */
export function useAceitarTermos() {
  return useGravarConsentimento<{ ia: boolean }>(({ ia }) =>
    bancoSolto.rpc('accept_terms', argumentosDoAceite(ia)),
  );
}

/** Liga ou revoga o consentimento de IA (Perfil → Privacidade e dados; cartão do 403). */
export function useDefinirConsentimentoIa() {
  return useGravarConsentimento<boolean>((consent) => bancoSolto.rpc('set_ai_consent', { p_consent: consent }));
}
