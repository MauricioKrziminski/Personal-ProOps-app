import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';

import { useInvalidateFinance, type CycleView } from '@/hooks/use-finance';
import { newClientMessageId } from '@/lib/agent-chat';
import { decodePlanState, decodePreview, type PlanInput, type PlanPreview, type PlanState } from '@/lib/budget-plan';
import type { Json } from '@/lib/database.types';
import { primeiroDiaDoMes } from '@/lib/dates';
import { supabase } from '@/lib/supabase';

/**
 * O plano atual, o que já está em orçamento e o realizado (renda do período e gasto por categoria)
 * na MESMA régua da tela. A chave começa em `['budgets']`: salvar orçamento ou aplicar o plano
 * refaz esta leitura pelo mesmo `invalidateFinance`.
 */
export function useBudgetPlanState(month: string, view?: CycleView, enabled = true) {
  return useQuery({
    enabled: enabled && month.length === 7,
    queryKey: ['budgets', 'plan', month, view ?? ''],
    queryFn: async (): Promise<PlanState> => {
      const { data, error } = await supabase.rpc('budget_plan_state', { p_month: primeiroDiaDoMes(month), p_view: view ?? undefined });
      if (error) throw error;
      return decodePlanState(data);
    },
  });
}

/** Os reais de cada linha, calculados pelo servidor, ao digitar (com uma pausa de 350 ms). */
export function useBudgetPlanPreview(input: PlanInput | null) {
  const texto = input ? JSON.stringify(input) : null;
  const [esperado, setEsperado] = useState(texto);
  useEffect(() => {
    const t = setTimeout(() => setEsperado(texto), 350);
    return () => clearTimeout(t);
  }, [texto]);
  return useQuery({
    enabled: esperado !== null,
    queryKey: ['budget-plan-preview', esperado],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<PlanPreview> => {
      const { data, error } = await supabase.rpc('budget_plan_preview', { p_input: JSON.parse(esperado!) as Json });
      if (error) throw error;
      return decodePreview(data);
    },
  });
}

export type BudgetPlanCommand =
  | { op: 'save'; base_income_cents: string; lines: PlanInput['lines']; expected_revision: number }
  | { op: 'apply'; version: number; categories: string[]; scope: 'default' | 'month'; month: string | null };

/** Salvar a versão ou aplicar aos orçamentos. A chave da tentativa é estável por intenção (padrão F11/F12). */
export function useBudgetPlanCommand() {
  const invalidate = useInvalidateFinance();
  const attempt = useRef<{ key: string; id: string } | null>(null);
  return useMutation({
    mutationFn: async (input: BudgetPlanCommand) => {
      const key = JSON.stringify(input);
      if (attempt.current?.key !== key) attempt.current = { key, id: newClientMessageId() };
      const requestId = attempt.current.id;
      const { data, error } = await supabase.rpc('budget_plan_command', { p_input: input as unknown as Json, p_request_id: requestId });
      if (error) throw error;
      if (attempt.current?.id === requestId) attempt.current = null;
      return data as unknown as { version: number; revision?: number; applied?: { category: string; before_cents: string | null; applied_cents: string }[] };
    },
    onSuccess: invalidate,
  });
}
