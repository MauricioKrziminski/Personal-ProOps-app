import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import type { NoteSort } from '@/hooks/use-notes';

/**
 * Como o usuário quer as notas ordenadas — a escolha dele, gravada.
 *
 * ## Por que gravar
 *
 * Ordem de lista é preferência, não filtro: quem escolheu "por título" escolheu uma vez e espera
 * achar a tela assim amanhã. O precedente é o `ThemeProvider`, que grava tema no mesmo lugar.
 *
 * ## Por que NÃO é um contexto
 *
 * Duas telas leem isto (a home e a de uma pasta) e elas nunca estão montadas ao mesmo tempo. Um
 * provider no layout raiz para dois consumidores exclusivos seria estrutura sem ninguém dentro;
 * o `AsyncStorage` já é o estado compartilhado, e a gravação acontece no toque, não por render.
 *
 * ⚠️ **Antes de ler o disco o valor é `manual`**, que é o padrão e o comportamento de quem nunca
 * escolheu nada — a tela nunca pisca de uma ordem para outra ao abrir.
 */
const CHAVE = 'notes:sort';

const VALIDOS: readonly NoteSort[] = ['manual', 'recentes', 'criadas', 'titulo'];

export const SORT_LABEL: Record<NoteSort, string> = {
  manual: 'Como eu arrumei',
  recentes: 'Editadas primeiro',
  criadas: 'Mais novas primeiro',
  titulo: 'Por título',
};

export function useNoteSort(): [NoteSort, (v: NoteSort) => void] {
  const [sort, setSort] = useState<NoteSort>('manual');

  useEffect(() => {
    let vivo = true;
    AsyncStorage.getItem(CHAVE)
      .then((bruto) => {
        // Valor fora do enum (versão antiga do app, disco corrompido) volta ao padrão em vez de
        // virar uma ordem que o `switch` da consulta não conhece.
        if (vivo && bruto && (VALIDOS as readonly string[]).includes(bruto)) {
          setSort(bruto as NoteSort);
        }
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  return [
    sort,
    (v: NoteSort) => {
      setSort(v);
      // Falha de gravação não pode derrubar a troca: a ordem já mudou na tela, e o pior caso é
      // ela não sobreviver ao próximo boot.
      AsyncStorage.setItem(CHAVE, v).catch(() => undefined);
    },
  ];
}
