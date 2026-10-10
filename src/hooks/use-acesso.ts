import { useEffect } from 'react';
// Alias de propósito: o portão mora na RAIZ, que está sempre em foco, e `useIsFocused` do
// wrapper `consulta-em-foco` não tem tela de onde ler o foco aqui.
import { useQuery as useQueryDaRaiz } from '@tanstack/react-query';
import { router } from 'expo-router';

import { consentimentoQuery } from '@/hooks/use-consentimento';
import { planStatusQuery, usePlanStatus } from '@/hooks/use-finance';
import { decisaoDeAcesso, estaSemAssinatura, ROTA_PAYWALL_LEITURA, type Destino } from '@/lib/acesso';

/**
 * Para onde a pessoa vai na abertura (conta, consentimento, onboarding, assinar ou app). Só consulta o plano
 * quando há sessão E onboarding concluído; antes disso o destino não depende dele.
 */
export function useDestino(temSessao: boolean, onboardingConcluido: boolean, userId: string | undefined): Destino {
  const termos = useQueryDaRaiz({ ...consentimentoQuery(userId), enabled: temSessao && !!userId });
  const plano = useQueryDaRaiz({ ...planStatusQuery, enabled: temSessao && onboardingConcluido });
  return decisaoDeAcesso(temSessao, onboardingConcluido, plano, termos);
}

/** Dentro do app, a pessoa está em modo leitura? (`lapsed`). Plano que não carregou não bloqueia. */
export function useSemAssinatura(): boolean {
  return estaSemAssinatura(usePlanStatus().data);
}

/**
 * Formulário de criar: sem assinatura, o paywall abre NO LUGAR dele (`replace`) — a pessoa não
 * preenche à toa. O banco recusa a escrita de qualquer jeito (PT402); isto só poupa o trabalho.
 */
export function useAbrirPaywallSemAssinatura(): boolean {
  const sem = useSemAssinatura();
  useEffect(() => {
    if (sem) router.replace(ROTA_PAYWALL_LEITURA);
  }, [sem]);
  return sem;
}
