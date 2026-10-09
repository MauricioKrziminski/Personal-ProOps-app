import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useQuery } from '@/lib/consulta-em-foco';

import { carregarPacotes, comprar, comprasDisponiveis, restaurar } from '@/lib/compras';
import type { PlanStatus } from '@/hooks/use-finance';

/** O plano só é verdade depois que o webhook da loja gravou: tenta a cada 2 s por ~20 s. */
export async function esperarPlano(queryClient: QueryClient, tentativas = 10, intervaloMs = 2000) {
  for (let i = 0; i < tentativas; i++) {
    await queryClient.refetchQueries({ queryKey: ['plan-status'] });
    const plano = queryClient.getQueryData<PlanStatus | null>(['plan-status']);
    if (plano?.access === 'subscriber') return true;
    await new Promise((ok) => setTimeout(ok, intervaloMs));
  }
  return false;
}

/** As ofertas da loja. `indisponivel` = sem chave ou sem módulo nativo: a tela não inventa preço. */
export function useOfertas() {
  const disponivel = comprasDisponiveis();
  const consulta = useQuery({
    queryKey: ['ofertas-da-loja'],
    queryFn: carregarPacotes,
    enabled: disponivel,
    staleTime: 5 * 60_000,
  });
  return { ...consulta, indisponivel: !disponivel };
}

/** Compra ou restaura e espera o plano chegar. `resultado` diz o que aconteceu. */
export function useComprar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (acao: { tipo: 'comprar'; pacote: Parameters<typeof comprar>[0] } | { tipo: 'restaurar' }) => {
      if (acao.tipo === 'comprar') {
        if ((await comprar(acao.pacote)) === 'cancelado') return 'cancelado' as const;
      } else {
        await restaurar();
      }
      return (await esperarPlano(queryClient)) ? ('ativo' as const) : ('aguardando' as const);
    },
  });
}
