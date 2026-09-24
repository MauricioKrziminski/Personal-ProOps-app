import { useState } from 'react';

import { PASSO, janela } from '@/lib/aos-poucos';

/**
 * A janela de "ver mais" de uma lista que chegou INTEIRA (24/09/2026). `chave` recomeça a janela
 * quando o que a lista mostra muda de sentido (outro filtro, outro mês): continuar com 60 visíveis
 * num filtro novo seria mostrar tudo de uma vez por outro caminho. `passo` menor serve a um bloco
 * de SUGESTÃO no meio de uma tela (os 5 "sem limite" de Orçamentos).
 */
export function useAosPoucos<T>(itens: readonly T[], chave = '', passo = PASSO) {
  const [estado, setEstado] = useState({ chave, mostrados: passo });
  const mostrados = estado.chave === chave ? estado.mostrados : passo;
  const j = janela(itens, mostrados);
  return { ...j, verMais: () => setEstado({ chave, mostrados: mostrados + passo }) };
}

/**
 * A mesma janela para uma tela com VÁRIOS grupos (o ciclo, a prévia da importação): quantos cada
 * grupo mostra, recomeçando todos quando `chave` muda. Um estado só — hook num laço não existe.
 */
export function useJanelasPorGrupo(chave: string) {
  const [estado, setEstado] = useState<{ chave: string; porGrupo: Record<string, number> }>({
    chave,
    porGrupo: {},
  });
  const porGrupo = estado.chave === chave ? estado.porGrupo : {};
  const mostrados = (grupo: string) => porGrupo[grupo] ?? PASSO;
  return {
    janelaDe: <T,>(grupo: string, itens: readonly T[]) => janela(itens, mostrados(grupo)),
    verMais: (grupo: string) => setEstado({ chave, porGrupo: { ...porGrupo, [grupo]: mostrados(grupo) + PASSO } }),
  };
}
