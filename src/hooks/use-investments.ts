import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useInfiniteQuery, useQuery } from '@/lib/consulta-em-foco';

import { useRealtimeInvalidate } from '@/hooks/use-items';
import { useInvalidateFinance } from '@/hooks/use-finance';
import { newClientMessageId } from '@/lib/agent-chat';
import type { Json } from '@/lib/database.types';
import {
  decodeInvestmentLinkCandidates, decodeInvestmentMovements, decodeInvestmentPositions,
  type InvestmentCursor, type InvestmentInput, type InvestmentLinkCandidate, type InvestmentMovementsPage, type InvestmentPosition,
  type InvestmentValueInput,
} from '@/lib/investment';
import { supabase } from '@/lib/supabase';

/** As posições (contas de investimento) com saldo realizado e aportado líquido. */
export function useInvestmentPositions() {
  useRealtimeInvalidate('investment_movements', ['investments']);
  useRealtimeInvalidate('investment_valuations', ['investments']);
  useRealtimeInvalidate('transactions', ['investments']);
  useRealtimeInvalidate('accounts', ['investments']);
  return useQuery({
    queryKey: ['investments', 'positions'],
    queryFn: async (): Promise<InvestmentPosition[]> => {
      const { data, error } = await supabase.rpc('investment_positions');
      if (error) throw error;
      return decodeInvestmentPositions(data);
    },
  });
}

/** Histórico de UMA posição, do mais recente ao mais antigo, `PASSO` por vez (cursor = `next_before`). */
export function useInvestmentMovements(positionId: string | undefined, limit = 20) {
  return useInfiniteQuery({
    enabled: Boolean(positionId),
    queryKey: ['investments', 'movements', positionId ?? ''],
    initialPageParam: null as InvestmentCursor | null,
    queryFn: async ({ pageParam }): Promise<InvestmentMovementsPage> => {
      const { data, error } = await supabase.rpc('investment_movements_page', {
        p_position_account_id: positionId!, p_limit: limit,
        ...(pageParam ? { p_before_on: pageParam.on, p_before_created: pageParam.created, p_before_id: pageParam.id } : {}),
      });
      if (error) throw error;
      return decodeInvestmentMovements(data);
    },
    getNextPageParam: (last) => (last.has_more ? last.next_before : undefined),
  });
}

/** Transferências lançadas ou importadas entre uma conta comum e uma posição que ainda podem virar movimento. */
export function useInvestmentLinkCandidates(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ['investments', 'candidates'],
    queryFn: async (): Promise<InvestmentLinkCandidate[]> => {
      const { data, error } = await supabase.rpc('investment_link_candidates', { p_limit: 50 });
      if (error) throw error;
      return decodeInvestmentLinkCandidates(data);
    },
  });
}

/**
 * Aplicar, resgatar, vincular, editar ou desfazer. A chave da tentativa é estável por intenção:
 * tocar de novo depois de uma falha de rede repete o MESMO pedido e o banco devolve o resultado
 * anterior em vez de gravar duas vezes (mesmo desenho de `useGoalMoneyCommand`).
 */
export function useInvestmentCommand() {
  const invalidate = useInvalidateFinance();
  const attempt = useRef<{ key: string; id: string } | null>(null);
  return useMutation({
    mutationFn: async (input: InvestmentInput) => {
      const key = JSON.stringify(input);
      if (attempt.current?.key !== key) attempt.current = { key, id: newClientMessageId() };
      const requestId = attempt.current.id;
      const { data, error } = await supabase.rpc('investment_command', { p_input: input as unknown as Json, p_request_id: requestId });
      if (error) throw error;
      if (attempt.current?.id === requestId) attempt.current = null;
      return data as unknown as { movement_id: string | null; transfer_id: string | null; position_balance_cents: string; revision: number };
    },
    onSuccess: invalidate,
  });
}

/** Atualizar valor, informar aplicado, rendimento recebido, corrigir ou apagar uma atualização. Mesma chave estável por intenção. */
export function useInvestmentValueCommand() {
  const invalidate = useInvalidateFinance();
  const attempt = useRef<{ key: string; id: string } | null>(null);
  return useMutation({
    mutationFn: async (input: InvestmentValueInput) => {
      const key = JSON.stringify(input);
      if (attempt.current?.key !== key) attempt.current = { key, id: newClientMessageId() };
      const requestId = attempt.current.id;
      const { data, error } = await supabase.rpc('investment_value_command', { p_input: input as unknown as Json, p_request_id: requestId });
      if (error) throw error;
      if (attempt.current?.id === requestId) attempt.current = null;
      return data as unknown as { valuation_id: string | null; movement_id: string | null; transaction_id: string | null; position_value_cents: string; revision: number };
    },
    onSuccess: invalidate,
  });
}

export interface AssetValuation { id: string; value_cents: number; as_of: string; created_at: string }

/** Marcações de um bem, da mais recente (`as_of`) à mais antiga; a tela mostra aos poucos. */
export function useAssetValuations(assetId: string | undefined) {
  useRealtimeInvalidate('asset_valuations', ['assets', 'valuations']);
  return useQuery({
    enabled: Boolean(assetId),
    queryKey: ['assets', 'valuations', assetId ?? ''],
    queryFn: async (): Promise<AssetValuation[]> => {
      const { data, error } = await supabase.from('asset_valuations').select('id, value_cents, as_of, created_at')
        .eq('asset_id', assetId!).order('as_of', { ascending: false }).order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((v) => ({ id: v.id, value_cents: Number(v.value_cents), as_of: v.as_of, created_at: v.created_at }));
    },
  });
}

/** Apaga uma marcação e devolve o valor atual do bem, já recalculado pelo banco. */
export function useDeleteAssetValuation() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (valuationId: string): Promise<number> => {
      const { data, error } = await supabase.rpc('delete_asset_valuation', { p_valuation_id: valuationId });
      if (error) throw error;
      return Number(data);
    },
    onSuccess: invalidate,
  });
}
