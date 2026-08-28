import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

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
  'id, content, folder_id, pinned, source, tags, created_at, updated_at, deleted_at';

const PAGE = 30;

export interface Note {
  id: string;
  content: string;
  folder_id: string | null;
  pinned: boolean;
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
  notes_count: number;
}

export interface NoteFilters {
  folderId?: string | null;
  tag?: string | null;
  q?: string;
  trash?: boolean;
}

/** Lista paginada. Antes era `limit(100)` fixo, sem paginação nenhuma. */
export function useNotesList(filters: NoteFilters = {}) {
  useRealtimeInvalidate('notes', ['notes']);

  return useInfiniteQuery({
    queryKey: ['notes', 'list', filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let query = supabase
        .from('notes')
        .select(NOTE_COLUMNS)
        .order('pinned', { ascending: false })
        .order('updated_at', { ascending: false })
        .range(pageParam, pageParam + PAGE - 1);

      query = filters.trash
        ? query.not('deleted_at', 'is', null)
        : query.is('deleted_at', null);

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
  return () => client.invalidateQueries({ queryKey: ['notes'] });
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
        supabase.from('note_folders').select('id, name, icon').order('name'),
        supabase.rpc('note_folder_counts'),
      ]);
      if (folders.error) throw folders.error;
      if (counts.error) throw counts.error;

      const byId = new Map((counts.data ?? []).map((c) => [c.folder_id, Number(c.notes_count)]));
      return (folders.data ?? []).map((f) => ({ ...f, notes_count: byId.get(f.id) ?? 0 }));
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
    mutationFn: async (input: { id?: string; name: string; icon?: string | null }) => {
      // `name` normalizado é constraint no banco (check `name = lower(trim(name))`), e é o que
      // mantém o unique COMPLETO — que por sua vez é o que deixa o .upsert() do PostgREST legal.
      const name = normalizeFolderName(input.name);
      if (!name) throw new Error('nome vazio');

      if (input.id) {
        const { error } = await supabase
          .from('note_folders')
          .update({ name, icon: input.icon ?? null })
          .eq('id', input.id);
        if (error) throw error;
        return input.id;
      }
      const { data, error } = await supabase
        .from('note_folders')
        .upsert(
          { name, icon: input.icon ?? null, user_id: await currentUserId() },
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

/** Apagar pasta NUNCA apaga nota — a FK é `on delete set null`. */
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
