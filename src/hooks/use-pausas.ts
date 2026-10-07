import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@/lib/consulta-em-foco';
import { newClientMessageId } from '@/lib/agent-chat';
import { supabase } from '@/lib/supabase';
import { useInvalidateFinance } from '@/hooks/use-finance';
import { useRealtimeInvalidate } from '@/hooks/use-items';

export type PreviaDaPausa = { dates: string[]; removed_count: number; cents: number; until: string };

export type PreviaDaCarencia = {
  next_before: string | null; next_after: string | null;
  installment_before: number; installment_after: number;
  balance_before: number; balance_after: number;
  end_before: string | null; end_after: string | null;
  with_interest: boolean;
};

export type PausaDaDivida = { id: string; seq: number; from_installment_no: number; months: number; created_at: string };

/** Dinheiro do jsonb chega como centavos inteiros; texto decimal também é aceito. */
export const cents = (v: unknown) => {
  const n = Math.round(Number(v ?? 0));
  if (!Number.isFinite(n)) throw new Error('Valor em centavos inválido');
  return n;
};

/** Mesma chave enquanto a intenção não muda: o retry de rede reaproveita o UUID (molde `useEndRecurring`). */
function useTentativa() {
  const attempt = useRef<{ key: string; id: string } | null>(null);
  return {
    abrir(parts: unknown[]) {
      const key = JSON.stringify(parts);
      if (attempt.current?.key !== key) attempt.current = { key, id: newClientMessageId() };
      return attempt.current.id;
    },
    fechar(id: string) { if (attempt.current?.id === id) attempt.current = null; },
  };
}

export function usePauseRecurringPreview(id: string | null, from: string | null, until: string | null) {
  return useQuery({
    enabled: Boolean(id && from && until),
    queryKey: ['recurring', 'pause-preview', id, from, until],
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<PreviaDaPausa> => {
      const { data, error } = await supabase.rpc('pause_recurring_preview', {
        p_recurring_id: id!, p_from: from!, p_until: until!,
      });
      if (error) throw error;
      if (!data) throw new Error('Prévia vazia');
      const d = data as unknown as PreviaDaPausa;
      return { ...d, dates: d.dates ?? [], cents: cents(d.cents) };
    },
  });
}

export function usePauseRecurring() {
  const invalidate = useInvalidateFinance();
  const t = useTentativa();
  return useMutation({
    mutationFn: async ({ id, from, until }: { id: string; from: string; until: string }) => {
      const requestId = t.abrir([id, from, until]);
      const { data, error } = await supabase.rpc('pause_recurring', {
        p_recurring_id: id, p_from: from, p_until: until, p_request_id: requestId,
      });
      if (error) throw error;
      t.fechar(requestId);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useResumeRecurring() {
  const invalidate = useInvalidateFinance();
  const t = useTentativa();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const requestId = t.abrir([id]);
      const { data, error } = await supabase.rpc('resume_recurring', { p_recurring_id: id, p_request_id: requestId });
      if (error) throw error;
      t.fechar(requestId);
      return data;
    },
    onSuccess: invalidate,
  });
}

/** Lembrete: sem RPC (RLS own-rows). Limpar a pausa = os dois null. */
export function usePauseReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, from, until }: { id: string; from: string | null; until: string | null }) => {
      const { error } = await supabase.from('reminders').update({ paused_from: from, paused_until: until }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reminders'] }),
  });
}

const prevCarencia = (r: unknown): PreviaDaCarencia => {
  const d = r as PreviaDaCarencia;
  return {
    ...d,
    installment_before: cents(d.installment_before), installment_after: cents(d.installment_after),
    balance_before: cents(d.balance_before), balance_after: cents(d.balance_after),
  };
};

export function useDebtPausePreview(debtId: string | null, fromNo: number | null, months: number | null) {
  return useQuery({
    enabled: Boolean(debtId && fromNo && months),
    queryKey: ['debt-pause-preview', debtId, fromNo, months],
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<PreviaDaCarencia> => {
      const { data, error } = await supabase.rpc('debt_pause_preview', {
        p_debt_id: debtId!, p_from_installment_no: fromNo!, p_months: months!,
      });
      if (error) throw error;
      if (!data) throw new Error('Prévia vazia');
      return prevCarencia(data);
    },
  });
}

export function useDebtPause() {
  const invalidate = useInvalidateFinance();
  const t = useTentativa();
  return useMutation({
    mutationFn: async ({ debtId, fromNo, months }: { debtId: string; fromNo: number; months: number }) => {
      const requestId = t.abrir([debtId, fromNo, months]);
      const { data, error } = await supabase.rpc('debt_pause', {
        p_debt_id: debtId, p_from_installment_no: fromNo, p_months: months, p_request_id: requestId,
      });
      if (error) throw error;
      t.fechar(requestId);
      return { ...prevCarencia(data), pause_id: (data as unknown as { pause_id: string }).pause_id };
    },
    onSuccess: invalidate,
  });
}

export function useUndoDebtPause() {
  const invalidate = useInvalidateFinance();
  const t = useTentativa();
  return useMutation({
    mutationFn: async ({ pauseId }: { pauseId: string }) => {
      const requestId = t.abrir([pauseId]);
      const { error } = await supabase.rpc('undo_debt_pause', { p_pause_id: pauseId, p_request_id: requestId });
      if (error) throw error;
      t.fechar(requestId);
    },
    onSuccess: invalidate,
  });
}

export function useDebtPauses(debtId: string | null) {
  useRealtimeInvalidate('debt_pauses', ['debt-pauses']);
  return useQuery({
    enabled: Boolean(debtId),
    queryKey: ['debt-pauses', debtId],
    queryFn: async (): Promise<PausaDaDivida[]> => {
      const { data, error } = await supabase
        .from('debt_pauses')
        .select('id, seq, from_installment_no, months, created_at')
        .eq('debt_id', debtId!)
        .order('seq', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
