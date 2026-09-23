import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useAccounts } from '@/hooks/use-finance';
import { useRealtimeInvalidate } from '@/hooks/use-items';
import { proximoPasso, type Proximo, type ProximoId } from '@/lib/proximo-passo';
import { supabase } from '@/lib/supabase';

/** Quantas linhas uma tabela tem para o workspace (a RLS escopa) — só a contagem, sem trazer nada. */
async function contar(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/**
 * O "Próximo passo" da Hoje: o que a pessoa ainda não usou, por DADO REAL (`lib/proximo-passo.ts`),
 * menos o que ela dispensou neste aparelho ("Agora não", por passo e por usuário).
 *
 * ⚠️ Afirmar "falta fazer" exige resposta (`isSuccess`) — com a consulta falhando o card não
 * aparece, em vez de oferecer importar a quem já importou.
 */
export function useProximoPasso(userId: string | undefined): {
  passo: Proximo | null;
  dispensar: (id: ProximoId) => void;
} {
  useRealtimeInvalidate('import_batches', ['proximo-passo']);
  useRealtimeInvalidate('reminders', ['proximo-passo']);
  useRealtimeInvalidate('notes', ['proximo-passo']);
  useRealtimeInvalidate('installment_plans', ['proximo-passo']);
  const contas = useAccounts();
  const contagens = useQuery({
    queryKey: ['proximo-passo'],
    queryFn: async () => {
      const [imports, lembretes, notas, parceladas] = await Promise.all([
        contar(supabase.from('import_batches').select('id', { count: 'exact', head: true })),
        contar(supabase.from('reminders').select('id', { count: 'exact', head: true })),
        contar(supabase.from('notes').select('id', { count: 'exact', head: true }).is('deleted_at', null)),
        contar(supabase.from('installment_plans').select('id', { count: 'exact', head: true })),
      ]);
      return { imports, lembretes, notas, parceladas };
    },
  });

  const chave = `hoje:proximo-dispensados:${userId ?? ''}`;
  const [dispensados, setDispensados] = useState<ReadonlySet<ProximoId>>(new Set());
  useEffect(() => {
    let vivo = true;
    AsyncStorage.getItem(chave)
      .then((bruto) => {
        const lista = bruto ? (JSON.parse(bruto) as ProximoId[]) : [];
        if (vivo && Array.isArray(lista)) setDispensados(new Set(lista));
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [chave]);

  const cartaoId = contas.data?.find((a) => a.type === 'credit_card')?.id ?? null;
  const passo =
    contagens.isSuccess && contas.isSuccess
      ? proximoPasso(
          {
            cartaoId,
            importou: contagens.data.imports > 0,
            lembretes: contagens.data.lembretes,
            notas: contagens.data.notas,
            parceladas: contagens.data.parceladas,
          },
          dispensados,
        )
      : null;

  return {
    passo,
    dispensar: (id) => {
      const novo = new Set(dispensados).add(id);
      setDispensados(novo);
      AsyncStorage.setItem(chave, JSON.stringify([...novo])).catch(() => undefined);
    },
  };
}
