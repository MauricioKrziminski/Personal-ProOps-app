import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query';

import { capturaDisponivel, configurarCaptura, estadoDaCaptura, notificacoesPendentes, removerPendentes } from '../../modules/proops-captura';
import { useToast } from '@/components/ui/toast';
import { useRealtimeInvalidate } from '@/hooks/use-items';
import { useSession } from '@/hooks/use-session';
import { enviarNotificacoes } from '@/lib/agent-api';
import { enviarFila } from '@/lib/captura';
import { useQuery } from '@/lib/consulta-em-foco';
import { supabase } from '@/lib/supabase';
import type { FinanceDraft } from '@/lib/voice-draft';

export type Captura = {
  id: string; bank: string; posted_at: string; status: 'pending' | 'duplicate';
  draft: FinanceDraft; entendido: string | null; amount_cents: number | null;
  occurred_at: string | null; match_transaction_id: string | null;
};

const CHAVE = ['captured_notifications'];

/**
 * O que está "a confirmar" (e o que parece já lançado), do mais recente para o mais antigo. `limite`
 * cresce pelo "Ver mais" e `total` é a contagem exata do servidor; `status` recorta (a Hoje só quer `pending`).
 */
export function useCapturas(limite = 20, status?: Captura['status']) {
  useRealtimeInvalidate('captured_notifications', CHAVE);
  const q = useQuery({
    placeholderData: keepPreviousData,
    queryKey: [...CHAVE, String(limite), status ?? 'todas'],
    queryFn: async () => {
      const { data, count, error } = await supabase
        .from('captured_notifications')
        .select('id, bank, posted_at, status, draft, entendido, amount_cents, occurred_at, match_transaction_id', { count: 'exact' })
        .in('status', status ? [status] : ['pending', 'duplicate'])
        .order('posted_at', { ascending: false })
        .limit(limite);
      if (error) throw error;
      const itens = (data ?? []) as Captura[];
      return { itens, total: count ?? itens.length };
    },
  });
  return { ...q, data: q.data?.itens, total: q.data?.total };
}

/** Confirmar/descartar apaga o texto da notificação: ele só existe enquanto o item está em aberto. */
export function useResolverCaptura() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'confirmed' | 'discarded' | 'pending' | 'duplicate' }) => {
      const { error } = await supabase
        .from('captured_notifications')
        .update(status === 'pending' || status === 'duplicate' ? { status } : { status, texto: null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
    // Nas opções do hook, não na chamada: o formulário confirma e já sai da tela, e o `onError` por
    // chamada não rodaria com ela desmontada. Falhar em silêncio deixaria a captura voltar e duplicar.
    onError: (_e, { status }) =>
      toast(status === 'confirmed'
        ? { message: 'Lançado, mas continua em A confirmar. Descarte-o lá.', tone: 'error' }
        : { message: 'Não deu para atualizar. Tente de novo.', tone: 'error' }),
  });
}

/** Envia a fila local ao abrir o app e ao voltar ao primeiro plano. Falha fica para a próxima vez. */
export function useEnviarCapturas() {
  const userId = useSession().session?.user.id;
  const qc = useQueryClient();
  // Saiu (sair, conta apagada, sessão revogada): para a captura e esvazia a fila do aparelho.
  const tinha = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (tinha.current && !userId && capturaDisponivel()) configurarCaptura(false, []);
    tinha.current = userId;
  }, [userId]);
  useEffect(() => {
    if (!userId || !capturaDisponivel()) return;
    let enviando = false;
    const enviar = async () => {
      if (enviando || !estadoDaCaptura().ativa) return;
      enviando = true;
      try {
        const n = await enviarFila({
          pendentes: notificacoesPendentes,
          remover: removerPendentes,
          enviar: (itens) => enviarNotificacoes(itens, Intl.DateTimeFormat().resolvedOptions().timeZone),
        });
        if (n) void qc.invalidateQueries({ queryKey: CHAVE });
      } catch {
        // sem rede, sem consentimento ou cota: a fila continua no aparelho
      } finally {
        enviando = false;
      }
    };
    void enviar();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void enviar(); });
    return () => sub.remove();
  }, [userId, qc]);
}
