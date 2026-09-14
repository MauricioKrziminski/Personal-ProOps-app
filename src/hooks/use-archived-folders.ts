import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { NoteColorName } from '@/constants/theme';
import type { NoteFolder } from '@/hooks/use-notes';

/**
 * As pastas ARQUIVADAS — a outra metade de `useNoteFolders`, que só devolve as ativas.
 *
 * Uma consulta separada em vez de um parâmetro no hook existente: `['notes','folders']` é lido
 * por seis telas e é a base da grade, do seletor de pasta e da contagem. Chavear aquele cache por
 * um filtro faria as seis passarem a buscar de novo a cada abertura desta tela, que é a única
 * que quer o outro lado.
 *
 * Sem contagem por RPC: `note_folder_counts()` já exclui arquivadas (é o que mantém a grade
 * honesta), então aqui a contagem viria zerada e mentindo. A linha mostra o nome e o ícone, que
 * é o que se precisa para reconhecer o que trazer de volta.
 */
export function useArchivedFolders() {
  return useQuery({
    queryKey: ['notes', 'folders', 'archived'],
    queryFn: async (): Promise<NoteFolder[]> => {
      const { data, error } = await supabase
        .from('note_folders')
        .select('id, name, icon, color, pinned, archived_at, position, tags, parent_id')
        .not('archived_at', 'is', null)
        .order('archived_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((f) => ({
        ...f,
        color: f.color as NoteColorName | null,
        tags: f.tags ?? [],
        notes_count: 0,
      }));
    },
  });
}
