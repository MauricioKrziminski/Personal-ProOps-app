import { useMemo } from 'react';

import { useAccounts, useRecentTransactions } from '@/hooks/use-finance';
import { useProfile } from '@/hooks/use-profile';
import { useSession } from '@/hooks/use-session';
import type { Consulta } from '@/hooks/use-tela-pronta';
import { passosDeConfiguracao, type Passo } from '@/lib/setup-steps';

/**
 * Os Primeiros passos a partir do banco. `useRecentTransactions(5)` é a MESMA chave que as
 * raízes já leem — o TanStack não busca de novo.
 */
export function useSetupProgress(): { passos: Passo[]; pronto: boolean; consultas: Consulta[] } {
  const { session } = useSession();
  const perfil = useProfile(session?.user?.id);
  const contas = useAccounts();
  const recentes = useRecentTransactions(5);

  const passos = useMemo(
    () =>
      passosDeConfiguracao({
        telefone: perfil.data?.phone,
        contas: contas.data?.length ?? 0,
        temLancamento: (recentes.data?.length ?? 0) > 0,
      }),
    [perfil.data?.phone, contas.data?.length, recentes.data?.length]
  );

  return {
    passos,
    // Afirmar "falta fazer" exige resposta das três (a régua do `isSuccess` de `frontend.md`).
    pronto: perfil.isSuccess && contas.isSuccess && recentes.isSuccess,
    consultas: [perfil, contas, recentes],
  };
}
