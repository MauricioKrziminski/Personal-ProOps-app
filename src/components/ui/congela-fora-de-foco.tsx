import { useIsFocused } from 'expo-router';
import { createContext, useEffect, useState } from 'react';
import { Freeze } from 'react-freeze';

/** Verdadeiro dentro da raiz de uma aba: quem esconde o que está nela, ao sair, é o `Freeze`. */
export const DentroDeAbaCongelavel = createContext(false);

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
 *
 * ⚠️ **O congelamento chega UM render depois da perda de foco** (06/10/2026). O `Freeze` suspende
 * a árvore ANTES de os filhos renderizarem, então uma aba que congelasse no mesmo render em que
 * perde o foco nunca veria `useIsFocused() === false` — e as consultas dela (`consulta-em-foco.ts`)
 * ficariam assinadas, refazendo a cada evento de realtime com a aba escondida. Esse render a mais
 * (um timeout, não `useDeferredValue` — ver abaixo) deixa cada consulta sair do cache; só então a
 * aba congela. Voltar é imediato: a aba descongela
 * no mesmo render em que ganha o foco.
 */
export function CongelaForaDeFoco({ children }: { children: React.ReactNode }) {
  const focada = useIsFocused();
  /*
    O render a mais vem de um estado comum num timeout, NÃO de `useDeferredValue`: suspender
    (`Freeze`) dentro de um render de transição deixava a rolagem de TODAS as outras abas morta no
    iOS — tocava, não rolava (06/10/2026, medido: sem o adiamento, Perfil e Finanças rolam).
  */
  const [congelar, setCongelar] = useState(false);
  useEffect(() => {
    if (focada) return;
    const t = setTimeout(() => setCongelar(true), 0);
    return () => {
      clearTimeout(t);
      setCongelar(false);
    };
  }, [focada]);
  return (
    <DentroDeAbaCongelavel.Provider value>
      <Freeze freeze={!focada && congelar}>{children}</Freeze>
    </DentroDeAbaCongelavel.Provider>
  );
}
