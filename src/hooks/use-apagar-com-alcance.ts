import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useToast } from '@/components/ui/toast';
import { formatBRL } from '@/hooks/use-items';
import { newClientMessageId } from '@/lib/agent-chat';
import { fraseDoEstrago, lerPrevia, textoDoApagado, type AlvoDoApagar, type PreviaDoApagar } from '@/lib/apagar-com-alcance';
import { askDeleteScope } from '@/lib/edit-scope';
import type { EditScope } from '@/lib/edit-scope-model';
import { financeErrorMessage } from '@/lib/finance-form';
import { confirmDestructive } from '@/lib/item-actions';
import { invalidateFinance, invalidateKeys } from '@/lib/query-invalidation';
import { supabase } from '@/lib/supabase';

/**
 * Apagar algo de uma série: a pergunta de alcance → a prévia do banco → a confirmação do estrago
 * (quando há algo pago, a compra vira à vista ou o contrato inteiro sai) → a escrita, numa RPC
 * atômica. A tela declara o alvo e mais nada.
 */
export function useApagarComAlcance(aoApagar?: (p: PreviaDoApagar) => void) {
  const qc = useQueryClient();
  const toast = useToast();
  // A intenção (alvo + alcance) mantém o mesmo request id entre tentativas, até dar certo.
  const tentativa = useRef<{ key: string; id: string } | null>(null);
  // sair da tela encerra a intenção: o "só esta" de um lembrete tem sempre a mesma chave, e dias depois
  // um id velho devolveria o recibo antigo em vez de pular a vez nova
  useEffect(() => () => { tentativa.current = null; }, []);
  const escrita = useMutation({
    mutationFn: async ({ alvo, alcance }: { alvo: AlvoDoApagar; alcance: EditScope }) => {
      const key = JSON.stringify([alvo.tipo, alvo.id, alcance, alvo.ancora ?? null]);
      if (tentativa.current?.key !== key) tentativa.current = { key, id: newClientMessageId() };
      const requestId = tentativa.current.id;
      const { data, error } = await supabase.rpc('delete_scoped', {
        p_tipo: alvo.tipo, p_id: alvo.id, p_alcance: alcance, p_request_id: requestId, p_anchor: alvo.ancora,
      });
      if (error) throw error;
      if (tentativa.current?.id === requestId) tentativa.current = null;
      return lerPrevia(data);
    },
    onSuccess: () => {
      invalidateFinance(qc);
      invalidateKeys(qc, [['reminders'], ['bill-reminders'], ['search', 'reminders']]);
    },
  });

  const apagarNoAlcance = async (alvo: AlvoDoApagar, alcance: EditScope) => {
    const erro = (e: unknown) => toast({ message: financeErrorMessage(e, 'Não deu para apagar. Tenta de novo.'), tone: 'error' });
    let previa: PreviaDoApagar;
    try {
      const { data, error } = await supabase.rpc('delete_scoped_preview', {
        p_tipo: alvo.tipo, p_id: alvo.id, p_alcance: alcance, p_anchor: alvo.ancora,
      });
      if (error) throw error;
      previa = lerPrevia(data);
    } catch (e) {
      erro(e);
      return;
    }
    const executar = () => escrita.mutate({ alvo, alcance }, {
      onSuccess: (r) => {
        toast({ message: textoDoApagado(r), tone: 'success' });
        aoApagar?.(r);
      },
      onError: erro,
    });
    const frase = fraseDoEstrago(previa, formatBRL, alvo.tipo);
    if (frase) confirmDestructive(`Apagar ${alvo.nome}?`, 'Apagar', executar, frase);
    else executar();
  };

  // O lançamento de um adiantamento: apagar DESFAZ e não tem alcance (08/10/2026). Na compra, o
  // "Só esta" do banco devolve as parcelas; avulso, apagar a linha basta (o gatilho devolve).
  const desfazer = useMutation({
    mutationFn: async (alvo: AlvoDoApagar) => {
      if (alvo.adiantamento === 'compra') {
        const { error } = await supabase.rpc('delete_scoped', {
          p_tipo: 'installment', p_id: alvo.id, p_alcance: 'one', p_request_id: newClientMessageId(),
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('transactions').delete().eq('id', alvo.id);
        if (error) throw error;
      }
    },
    onSuccess: () => invalidateFinance(qc),
  });
  const desfazerAdiantamento = (alvo: AlvoDoApagar) => confirmDestructive(
    'Desfazer o adiantamento?',
    'Desfazer',
    () => desfazer.mutate(alvo, {
      onSuccess: () => {
        toast({ message: 'Adiantamento desfeito: as parcelas voltaram.', tone: 'success' });
        aoApagar?.({ apagadas: 1, pagas: 0, somaPagasCents: 0, contas: [], desde: null, apagaContrato: false, viraAvista: false });
      },
      onError: (e) => toast({ message: financeErrorMessage(e, 'Não deu para desfazer. Tenta de novo.'), tone: 'error' }),
    }),
    'O lançamento sai e o que ele adiantou volta como era.',
  );

  const apagar = (alvo: AlvoDoApagar) => alvo.adiantamento
    ? desfazerAdiantamento(alvo)
    : askDeleteScope(alvo.tipo, (alcance) => { void apagarNoAlcance(alvo, alcance); });

  return { apagar, apagarNoAlcance, pendente: escrita.isPending || desfazer.isPending };
}
