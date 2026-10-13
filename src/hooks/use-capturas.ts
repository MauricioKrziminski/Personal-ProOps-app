import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { capturaDisponivel, estadoDaCaptura, notificacoesPendentes, removerPendentes } from '../../modules/proops-captura';
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

/** O que está "a confirmar" (e o que parece já lançado), do mais recente para o mais antigo. */
export function useCapturas() {
  useRealtimeInvalidate('captured_notifications', CHAVE);
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('captured_notifications')
        .select('id, bank, posted_at, status, draft, entendido, amount_cents, occurred_at, match_transaction_id')
        .in('status', ['pending', 'duplicate'])
        .order('posted_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Captura[];
    },
  });
}

/** Confirmar/descartar apaga o texto da notificação: ele só existe enquanto o item está em aberto. */
export function useResolverCaptura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'confirmed' | 'discarded' | 'pending' }) => {
      const { error } = await supabase
        .from('captured_notifications')
        .update(status === 'pending' ? { status } : { status, texto: null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

/** Envia a fila local ao abrir o app e ao voltar ao primeiro plano. Falha fica para a próxima vez. */
export function useEnviarCapturas() {
  const userId = useSession().session?.user.id;
  const qc = useQueryClient();
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
