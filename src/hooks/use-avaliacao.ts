import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import { useCallback } from 'react';

import { useSession } from '@/hooks/use-session';
import { devePedirAvaliacao, type EstadoDaAvaliacao } from '@/lib/avaliacao';

/**
 * Chamar DEPOIS de um salvar com sucesso: conta o salvamento no aparelho e, cumpridas as três
 * condições (`devePedirAvaliacao`), pede a avaliação do sistema. Qualquer falha é silenciosa — nunca
 * pode atrapalhar o salvar.
 */
export function useAvaliacaoDepoisDeSalvar() {
  const user = useSession().session?.user;
  const userId = user?.id;
  const criadoEm = user?.created_at;
  return useCallback(async () => {
    if (!userId) return;
    try {
      const chave = `avaliacao:${userId}`;
      const bruto = await AsyncStorage.getItem(chave);
      const antes: EstadoDaAvaliacao = bruto ? JSON.parse(bruto) : { salvamentos: 0, ultimoPedido: null };
      const estado: EstadoDaAvaliacao = { salvamentos: (antes.salvamentos || 0) + 1, ultimoPedido: antes.ultimoPedido ?? null };
      const agora = Date.now();
      const pedir = devePedirAvaliacao(criadoEm, estado, agora) && (await StoreReview.isAvailableAsync());
      if (pedir) estado.ultimoPedido = agora;
      await AsyncStorage.setItem(chave, JSON.stringify(estado));
      if (pedir) await StoreReview.requestReview();
    } catch {
      // Avaliação é cortesia: erro aqui não vale um toast.
    }
  }, [userId, criadoEm]);
}
