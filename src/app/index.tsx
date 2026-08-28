import { Redirect } from 'expo-router';

import { useSession } from '@/hooks/use-session';

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
  if (loading) return null;
  return <Redirect href={session ? '/today' : '/login'} />;
}
