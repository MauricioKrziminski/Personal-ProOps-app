import { useIsFocused } from 'expo-router';
import { Freeze } from 'react-freeze';

/**
 * Congela a árvore de uma aba que não está à vista (05/10/2026).
 *
 * Medido no release: cada alternância de "ocultar valores" custava 405 ms de JS só com uma tela
 * e 726-828 ms com as cinco abas montadas — ~45% em abas que ninguém estava vendo. Congelada, a
 * aba não re-renderiza com o contexto; ao voltar ao foco o React renderiza UMA vez já com o
 * estado atual (ocultar trocado, dados que o Realtime/TanStack trouxeram).
 *
 * Precisa ser manual: o `NativeTabs` do iOS não congela nada, e a pilha interna de cada aba tem
 * sempre sua única tela "em foco" para o react-native-screens. O estado (useState, cache do
 * Query, efeitos passivos como o Realtime) continua vivo; só o RENDER é adiado.
 */
export function CongelaForaDeFoco({ children }: { children: React.ReactNode }) {
  const focada = useIsFocused();
  return <Freeze freeze={!focada}>{children}</Freeze>;
}
