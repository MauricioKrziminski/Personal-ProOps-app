import {
  useInfiniteQuery as useInfiniteQueryDoTanstack,
  useQuery as useQueryDoTanstack,
} from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';

/**
 * `useQuery`/`useInfiniteQuery` que SÓ ASSINAM o cache enquanto a tela está em foco (06/10/2026).
 *
 * As telas empurradas ficam montadas por baixo da pilha, e as abas que não estão à vista também.
 * Cada evento de realtime invalida ~70 famílias de chave (`FINANCE_KEYS`) e o TanStack refaz toda
 * consulta ATIVA — inclusive as de tela que ninguém está vendo, que disputavam rede e a thread JS
 * com a tela em foco.
 *
 * `subscribed: false` (TanStack v5.101) tira o observer do cache sem desmontar o hook: a consulta
 * deixa de ser "ativa", então a invalidação só a MARCA velha; quando a tela volta ao foco o
 * observer assina de novo e o que ficou velho refaz na hora (`refetchOnMount`), enquanto o dado
 * antigo continua na tela. Nada fica desatualizado: ou refez em foco, ou refaz ao focar.
 *
 * Mutações e `invalidateQueries` também deixam de esperar telas que ninguém vê.
 *
 * ⚠️ Uma consulta que nunca foi assinada fica `fetchStatus: 'idle'` (o portão `telaPronta` a lê
 * como "ninguém vai buscar"): numa tela fora de foco isso não aparece, e ao focar o observer já
 * volta a contar a busca no mesmo render.
 *
 * Todo hook de dados importa DAQUI, nunca do pacote (`consulta-em-foco.test.ts` prende isso).
 */
export const useQuery = ((options: any, queryClient?: any) => {
  const emFoco = useIsFocused();
  return useQueryDoTanstack({ ...options, subscribed: emFoco && options.subscribed !== false }, queryClient);
}) as typeof useQueryDoTanstack;

export const useInfiniteQuery = ((options: any, queryClient?: any) => {
  const emFoco = useIsFocused();
  return useInfiniteQueryDoTanstack({ ...options, subscribed: emFoco && options.subscribed !== false }, queryClient);
}) as typeof useInfiniteQueryDoTanstack;
