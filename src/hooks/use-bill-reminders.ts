import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useRealtimeInvalidate } from '@/hooks/use-items';
import { useQuery } from '@/lib/consulta-em-foco';
import { mesmoAlvo, type Alvo, type Aviso } from '@/lib/lembrete-de-conta';
import { supabase } from '@/lib/supabase';

export type LembreteDeConta = {
  alvo: Alvo;
  title: string;
  channel: 'push' | 'whatsapp' | 'both';
  avisos: Aviso[];
  next_due: string | null;
};

const CHAVE = ['bill-reminders'];

export function useBillReminders() {
  useRealtimeInvalidate('bill_reminders', CHAVE);
  return useQuery({
    queryKey: CHAVE,
    queryFn: async (): Promise<LembreteDeConta[]> => {
      const { data, error } = await supabase.rpc('bill_reminders_overview');
      if (error) throw error;
      return (data ?? []) as unknown as LembreteDeConta[];
    },
  });
}

export function useBillReminderFor(alvo: Alvo | null) {
  const lista = useBillReminders();
  return alvo ? lista.data?.find((l) => mesmoAlvo(l.alvo, alvo)) : undefined;
}

export function useSaveBillReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { alvo: Alvo; avisos: Aviso[]; channel: LembreteDeConta['channel'] }) => {
      const { error } = await supabase.rpc('save_bill_reminder', {
        p_alvo: input.alvo,
        p_avisos: input.avisos,
        p_channel: input.channel,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}
