import { invalidateKeys } from '@/lib/query-invalidation';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import type { NoteColorName } from '@/constants/theme';
import { useRealtimeInvalidate } from '@/hooks/use-items';
import { normalizeFolderName, toTsQuery } from '@/lib/search';
import { supabase } from '@/lib/supabase';

/**
 * Notas: lista, detalhe, pastas e lixeira.
 *
 * **Todo queryKey vive sob o prefixo `['notes', …]`** — assim um único
 * `useRealtimeInvalidate('notes', ['notes'])` invalida lista, item e contagens por prefixo, em vez
 * de quatro canais de realtime.
 */

/** Nunca `select('*')`: `tags` e `search_tsv` são colunas geradas e grandes — numa lista de 30 o
 *  payload triplica. */
const NOTE_COLUMNS =
  'id, content, folder_id, pinned, color, archived_at, position, source, tags, created_at, updated_at, deleted_at';

const PAGE = 30;

export interface Note {
  id: string;
  content: string;
  folder_id: string | null;
  pinned: boolean;
  /** Nome de token de `NoteColors`, ou `null` (sem trilho). Nunca hex. */
  color: NoteColorName | null;
  /** Arquivada some das listas e continua existindo. Espelha `deleted_at`. */
  archived_at: string | null;
  /** Slot da ordem manual dentro do escopo. `null` = nunca arrastada. */
  position: number | null;
  source: 'whatsapp' | 'app';
  tags: string[];
  created_at: string;
  updated_at: string;
  /** A lixeira precisa dele para o "apaga em N dias". */
  deleted_at: string | null;
}

export interface NoteFolder {
  id: string;
  name: string;
  icon: string | null;
  /** Nome de token de `NoteColors`, ou `null`. Pinta o ladrilho do ícone. */
  color: NoteColorName | null;
  /** Fixada vai para o começo da grade. */
  pinned: boolean;
  archived_at: string | null;
  position: number | null;
  /**
   * Tag de PASTA — coluna de verdade, ao contrário de `notes.tags`, que é GERADA do `#hashtag`
   * do texto. O namespace é o mesmo de propósito: o chip da tela filtra as duas coisas.
   */
  tags: string[];
  /** Pasta-mãe. `null` = está na raiz. */
  parent_id: string | null;
  notes_count: number;
}

/**
 * Ordena as pastas em ÁRVORE, achatada para lista, com o nível de cada uma.
 *
 * A lista vem plana do banco e ordenada por nome; assim "Trabalho / 2026" apareceria longe de
 * "Trabalho". Aqui as filhas ficam logo abaixo da mãe, e `depth` diz quanto recuar.
 *
 * Pasta cuja mãe não está na lista (mãe apagada entre um fetch e outro) é tratada como raiz —
 * some da árvore é pior do que aparecer no lugar errado por um instante.
 */
export function folderTree(folders: NoteFolder[]): (NoteFolder & { depth: number })[] {
  const filhas = new Map<string | null, NoteFolder[]>();
  const ids = new Set(folders.map((f) => f.id));
  for (const f of folders) {
    const mae = f.parent_id && ids.has(f.parent_id) ? f.parent_id : null;
    filhas.set(mae, [...(filhas.get(mae) ?? []), f]);
  }

  const saida: (NoteFolder & { depth: number })[] = [];
  const desce = (mae: string | null, depth: number) => {
    // Teto de profundidade: `parent_id` não impede um ciclo (A mãe de B, B mãe de A) e sem o
    // corte isto seria recursão infinita — tela branca, sem erro no log.
    if (depth > 4) return;
    for (const f of filhas.get(mae) ?? []) {
      saida.push({ ...f, depth });
      desce(f.id, depth + 1);
    }
  };
  desce(null, 0);
  return saida;
}

/**
 * Como a lista é ordenada.
 *
 * ⚠️ `titulo` é `order('content')` no servidor. Funciona porque o título é a primeira linha, mas
 * é sensível a caixa e nota que abre com `#tag` desordena — custo aceito e escrito, em troca de
 * não puxar a lista inteira para o cliente só para ordenar por uma string derivada.
 */
export type NoteSort = 'manual' | 'recentes' | 'criadas' | 'titulo';

export interface NoteFilters {
  folderId?: string | null;
  tag?: string | null;
  q?: string;
  trash?: boolean;
  /** `true` = SÓ arquivadas (a tela de arquivadas). Ausente = só as ativas. */
  archived?: boolean;
  sort?: NoteSort;
}

/** Lista paginada. Antes era `limit(100)` fixo, sem paginação nenhuma. */
export function useNotesList(filters: NoteFilters = {}) {
  useRealtimeInvalidate('notes', ['notes']);

  return useInfiniteQuery({
    queryKey: ['notes', 'list', filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let query = supabase.from('notes').select(NOTE_COLUMNS);

      // Fixada primeiro SEMPRE, inclusive no modo manual: com `position` à frente de `pinned`
      // uma nota fixada de slot 2 cairia atrás de uma solta de slot 1 e a seção FIXADAS se
      // intercalaria com o resto da lista.
      query = query.order('pinned', { ascending: false });
      switch (filters.sort ?? 'manual') {
        case 'criadas':
          query = query.order('created_at', { ascending: false });
          break;
        case 'titulo':
          query = query.order('content', { ascending: true });
          break;
        case 'recentes':
          query = query.order('updated_at', { ascending: false });
          break;
        default:
          // `nullsFirst: false` é o que faz "nunca arrastada" ir para o fim — antes do primeiro
          // arrasto tudo é null e a ordem é a de sempre, por recência.
          query = query
            .order('position', { ascending: true, nullsFirst: false })
            .order('updated_at', { ascending: false });
      }
      query = query.range(pageParam, pageParam + PAGE - 1);

      query = filters.trash
        ? query.not('deleted_at', 'is', null)
        : query.is('deleted_at', null);

      // Arquivada é um TERCEIRO estado, não um sinônimo de lixeira: ela não some em 30 dias e
      // não pede restauração, só sai do caminho.
      if (!filters.trash) {
        query = filters.archived
          ? query.not('archived_at', 'is', null)
          : query.is('archived_at', null);
      }

      if (filters.folderId !== undefined) {
        query = filters.folderId === null
          ? query.is('folder_id', null)
          : query.eq('folder_id', filters.folderId);
      }
      if (filters.tag) query = query.contains('tags', [filters.tag]);

      const term = filters.q ? toTsQuery(filters.q) : '';
      if (term) query = query.textSearch('search_tsv', term, { config: 'pt_unaccent' });

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as Note[];
    },
    getNextPageParam: (last, all) =>
      last.length < PAGE ? undefined : all.length * PAGE,
  });
}

export function useNote(id: string | undefined) {
  return useQuery({
    queryKey: ['notes', 'item', id],
    enabled: !!id && id !== 'new',
    queryFn: async (): Promise<Note> => {
      const { data, error } = await supabase
        .from('notes')
        .select(NOTE_COLUMNS)
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as unknown as Note;
    },
  });
}

/** Invalida tudo por prefixo — lista, item, contagem de pasta e de tag numa chamada. */
function useInvalidateNotes() {
  const client = useQueryClient();
  return () => invalidateKeys(client, [['notes'], ['search', 'notes'], ['ai-month-stats']]);
}

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id;
  if (!id) throw new Error('sem sessão');
  return id;
}

export function useSaveNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (input: { id?: string; content: string; folder_id?: string | null }) => {
      if (input.id) {
        const { error } = await supabase
          .from('notes')
          .update({ content: input.content, folder_id: input.folder_id })
          .eq('id', input.id);
        if (error) throw error;
        return input.id;
      }
      const { data, error } = await supabase
        .from('notes')
        .insert({
          content: input.content,
          folder_id: input.folder_id ?? null,
          source: 'app',
          user_id: await currentUserId(),
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: invalidate,
  });
}

export function useToggleNotePin() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (input: { id: string; pinned: boolean }) => {
      const { error } = await supabase
        .from('notes')
        .update({ pinned: input.pinned })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/**
 * Muda CAMPO de nota — cor, arquivamento, pasta. Nunca conteúdo.
 *
 * Separado de `useSaveNote` de propósito: aquele grava `content`, e um formulário que escreve um
 * campo que ele não mostra já apagou dado neste projeto (a regra está em `finance.md`). Aqui
 * cada chamada diz exatamente o que muda.
 *
 * ⚠️ **`position` NUNCA entra aqui.** Um UPDATE que mude `position` junto de outra coluna não
 * atualiza `updated_at` (a cláusula WHEN do trigger, ver a migration `20260914180000`): a nota
 * mudaria de pasta e continuaria dizendo "há 2 dias". Ordem manual tem caminho próprio, que é a
 * RPC de reordenar.
 */
export function useUpdateNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      color?: NoteColorName | null;
      archived?: boolean;
      folder_id?: string | null;
    }) => {
      const patch: { color?: string | null; folder_id?: string | null; archived_at?: string | null } =
        {};
      if ('color' in input) patch.color = input.color;
      if ('folder_id' in input) patch.folder_id = input.folder_id;
      if (input.archived !== undefined) {
        patch.archived_at = input.archived ? new Date().toISOString() : null;
      }
      if (Object.keys(patch).length === 0) return;
      const { error } = await supabase.from('notes').update(patch).eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/**
 * Ordem manual — pela RPC, nunca por `update` direto.
 *
 * A RPC reescreve o escopo visível inteiro numa sentença e pula a linha que não mudou de slot,
 * que é o que impede o `moddatetime` de carimbar `updated_at` em metade da lista (ver o teste
 * `supabase/tests/notas_ordem_cor_arquivo.sql`).
 */
export function useReorderNotes() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc('notes_reorder', { p_ids: ids });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useReorderFolders() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc('note_folders_reorder', { p_ids: ids });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Fixar, colorir, arquivar e etiquetar pasta. Mesma régua do `useUpdateNote`. */
export function useUpdateFolder() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      color?: NoteColorName | null;
      pinned?: boolean;
      archived?: boolean;
      tags?: string[];
    }) => {
      const patch: {
        color?: string | null;
        pinned?: boolean;
        tags?: string[];
        archived_at?: string | null;
      } = {};
      if ('color' in input) patch.color = input.color;
      if (input.pinned !== undefined) patch.pinned = input.pinned;
      if (input.tags !== undefined) patch.tags = input.tags;
      if (input.archived !== undefined) {
        patch.archived_at = input.archived ? new Date().toISOString() : null;
      }
      if (Object.keys(patch).length === 0) return;
      const { error } = await supabase.from('note_folders').update(patch).eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Lixeira, não delete: apagar por toque errado sem volta é o jeito mais rápido de perder confiança. */
export function useTrashNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notes')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useRestoreNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('notes').update({ deleted_at: null }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Delete de verdade — só a partir da lixeira, com confirmação. */
export function usePurgeNote() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('notes').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useNoteFolders() {
  useRealtimeInvalidate('note_folders', ['notes']);

  return useQuery({
    queryKey: ['notes', 'folders'],
    queryFn: async (): Promise<NoteFolder[]> => {
      const [folders, counts] = await Promise.all([
        supabase
          .from('note_folders')
          .select('id, name, icon, color, pinned, archived_at, position, tags, parent_id')
          .is('archived_at', null)
          .order('pinned', { ascending: false })
          .order('position', { ascending: true, nullsFirst: false })
          .order('name'),
        supabase.rpc('note_folder_counts'),
      ]);
      if (folders.error) throw folders.error;
      if (counts.error) throw counts.error;

      const byId = new Map((counts.data ?? []).map((c) => [c.folder_id, Number(c.notes_count)]));
      return (folders.data ?? []).map((f) => ({
        ...f,
        color: f.color as NoteColorName | null,
        tags: f.tags ?? [],
        notes_count: byId.get(f.id) ?? 0,
      }));
    },
  });
}

export function useNoteTags() {
  return useQuery({
    queryKey: ['notes', 'tags'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('note_tag_counts');
      if (error) throw error;
      return (data ?? []).map((t) => ({ tag: t.tag, count: Number(t.notes_count) }));
    },
  });
}

export function useSaveFolder() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      name: string;
      icon?: string | null;
      /** Pasta-mãe. `undefined` = não mexe; `null` = move para a raiz. */
      parentId?: string | null;
    }) => {
      // `name` normalizado é constraint no banco (check `name = lower(trim(name))`), e é o que
      // mantém o unique COMPLETO — que por sua vez é o que deixa o .upsert() do PostgREST legal.
      const name = normalizeFolderName(input.name);
      if (!name) throw new Error('nome vazio');

      if (input.id) {
        // ⚠️ Uma pasta não pode ser mãe de si mesma. O banco não tem como impedir (a FK só
        // exige que o id exista), e o resultado seria uma pasta que some da árvore inteira —
        // ela nunca apareceria na raiz nem dentro de ninguém.
        const parent = input.parentId === input.id ? null : input.parentId;
        const { error } = await supabase
          .from('note_folders')
          .update({
            name,
            icon: input.icon ?? null,
            ...(input.parentId !== undefined ? { parent_id: parent } : {}),
          })
          .eq('id', input.id);
        if (error) throw error;
        return input.id;
      }
      const { data, error } = await supabase
        .from('note_folders')
        .upsert(
          {
            name,
            icon: input.icon ?? null,
            parent_id: input.parentId ?? null,
            user_id: await currentUserId(),
          },
          { onConflict: 'workspace_id,name' }
        )
        .select('id')
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: invalidate,
  });
}

/**
 * Apagar pasta NUNCA apaga nota — a FK de `notes.folder_id` é `on delete set null`.
 *
 * E, desde a `0049`, também não apaga SUBPASTA: `note_folders.parent_id` é `on delete set null`,
 * então as filhas sobem para a raiz em vez de sumirem junto. Perder nota por causa de arrumação
 * é o tipo de coisa que faz alguém parar de confiar no app.
 */
export function useDeleteFolder() {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('note_folders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
