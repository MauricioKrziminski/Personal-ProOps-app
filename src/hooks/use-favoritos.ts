import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRealtimeInvalidate } from '@/hooks/use-items';
import { encodeModelo, decodeModelo, type Modelo } from '@/lib/favoritos';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/lib/database.types';

export type Favorito = { id: string; name: string; archived: boolean; use_count: number; modelo: Modelo };

const CHAVE = ['transaction-templates'];

/** Favoritos do espaço, os mais usados primeiro. `arquivados` lista só os arquivados. */
export function useFavoritos(arquivados = false) {
  useRealtimeInvalidate('transaction_templates', CHAVE);
  return useQuery({
    queryKey: [...CHAVE, arquivados],
    queryFn: async (): Promise<Favorito[]> => {
      const { data, error } = await supabase.from('transaction_templates')
        .select('id, name, archived, use_count, fields')
        .eq('archived', arquivados).order('use_count', { ascending: false }).order('name').order('id').range(0, 999);
      if (error) throw error; // ponytail: 1000 favoritos por espaço; paginar se alguém chegar lá
      return (data ?? []).map((r) => ({ id: r.id, name: r.name, archived: r.archived, use_count: r.use_count, modelo: decodeModelo(r.fields) }));
    },
  });
}

/** Cria, renomeia, edita os campos, arquiva/desarquiva ou apaga — nunca toca um lançamento. */
export function useSalvarFavorito() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { id?: string; name?: string; modelo?: Modelo; archived?: boolean }) => {
      const nome = p.name?.trim();
      if (p.id) {
        const { error } = await supabase.from('transaction_templates').update({
          ...(nome ? { name: nome } : {}),
          ...(p.modelo ? { fields: encodeModelo(p.modelo) as Json } : {}),
          ...(p.archived !== undefined ? { archived: p.archived } : {}),
        }).eq('id', p.id);
        if (error) throw error;
        return;
      }
      const { data: u, error: eu } = await supabase.auth.getUser();
      if (eu || !u.user) throw eu ?? new Error('sem sessão');
      const { error } = await supabase.from('transaction_templates')
        .insert({ user_id: u.user.id, name: nome ?? '', fields: encodeModelo(p.modelo ?? {}) as Json });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useApagarFavorito() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('transaction_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

/** Conta o uso (ordena a fileira). Falhar não atrapalha: o formulário já abriu. */
export function useUsouFavorito() {
  return useMutation({
    mutationFn: async (f: { id: string; use_count: number }) => {
      await supabase.from('transaction_templates')
        .update({ use_count: f.use_count + 1, last_used_at: new Date().toISOString() }).eq('id', f.id);
    },
  });
}

/** Nome repetido entre os não arquivados (índice único) — a tela diz em palavras. */
export const NOME_REPETIDO = '23505';
