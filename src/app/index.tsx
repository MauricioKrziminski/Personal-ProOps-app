import { Redirect } from 'expo-router';

import { useDestino } from '@/hooks/use-acesso';
import { useSession } from '@/hooks/use-session';
import { hasCompletedOnboarding } from '@/lib/onboarding';

/**
 * Raiz do app — só decide para onde ir.
 *
 * Existe porque a aba Hoje virou `(tabs)/today/` (precisava de Stack aninhado para ter header
 * nativo) e sem isto `/` cai em "Unmatched Route".
 *
 * O destino é decidido **aqui**, não por `Stack.Protected`: `/` é a URL inicial do app, então o
 * arquivo renderiza antes de qualquer guard e apareceria como uma tela em branco com o título
 * "index". Verificado no simulador.
 */
export default function Index() {
  const { session, loading } = useSession();
  const destino = useDestino(!!session, !!session && hasCompletedOnboarding(session.user.user_metadata));
  if (loading || destino === 'aguarda') return null;
  const rota = { conta: '/login', onboarding: '/onboarding', assinar: '/assinar', app: '/today' } as const;
  // `/assinar` entra nos tipos de rota quando o Expo regenera `.expo/types`.
  return <Redirect href={rota[destino] as never} />;
}
