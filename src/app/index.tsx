import { Redirect } from 'expo-router';

/**
 * Raiz do app.
 *
 * Existe porque a aba Hoje virou o diretório `(tabs)/today/` (precisava de Stack aninhado para ter
 * header nativo), e sem isto o grupo de abas fica sem rota índice: `/` cai em "Unmatched Route".
 * Verificado no simulador, não deduzido.
 */
export default function Index() {
  return <Redirect href="/today" />;
}
