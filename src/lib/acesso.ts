/**
 * Quem pode o quê, a partir do `plan_status` — puro, para o portão e os testes lerem a mesma regra.
 *
 * `access` vem do banco: 'subscriber' | 'never' (nunca assinou) | 'lapsed' (teve e perdeu).
 */
export type Acesso = 'subscriber' | 'never' | 'lapsed';

export interface PlanoLido {
  isPending: boolean;
  isError: boolean;
  data?: { access?: string | null; plan?: string | null } | null;
}

export type Destino = 'conta' | 'onboarding' | 'aguarda' | 'assinar' | 'app';

/**
 * O destino da pessoa na abertura. **Falha ABERTO**: se o plano não carrega, entra no app — o
 * banco recusa a escrita (PT402) de quem não assina, então a trava de verdade não mora na tela.
 */
export function decisaoDeAcesso(
  temSessao: boolean,
  onboardingConcluido: boolean,
  plano: PlanoLido,
): Destino {
  if (!temSessao) return 'conta';
  if (!onboardingConcluido) return 'onboarding';
  if (plano.isPending && !plano.isError) return 'aguarda';
  return plano.data?.access === 'never' ? 'assinar' : 'app';
}

/** Dentro do app, "sem assinatura" = leitura. Erro ou plano ausente não bloqueia (o banco protege). */
export function estaSemAssinatura(plano: { access?: string | null; plan?: string | null } | null | undefined): boolean {
  if (!plano) return false;
  return plano.access === 'lapsed' || plano.access === 'never' || plano.plan === 'free';
}

export const ROTA_PAYWALL_LEITURA = '/paywall?from=lapsed';

/** PT402 = escrita recusada por falta de assinatura. Abre o paywall; qualquer outro erro passa. */
export function aoFalharEscrita(error: unknown, abrir: (rota: string) => void): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code !== 'PT402') return false;
  abrir(ROTA_PAYWALL_LEITURA);
  return true;
}

const NOME_DO_PLANO: Record<string, string> = { pro: 'Pro', family: 'Família' };

export interface EstadoDoPlano {
  titulo: string;
  detalhe: string;
  selo: 'TESTE' | 'ATIVO' | 'ENCERRADA';
}

/** O cartão do plano no Perfil, em palavras: nunca "Plano free" cru. `data` já formatada por quem chama. */
export function estadoDoPlano(
  p: { access?: string | null; plan?: string | null; is_trial?: boolean; members: number; max_members: number },
  ate: string | null,
): EstadoDoPlano {
  const nome = NOME_DO_PLANO[p.plan ?? ''] ?? 'Sem assinatura';
  if (p.access !== 'subscriber') {
    return { titulo: 'Assinatura encerrada', detalhe: 'Seus dados continuam aqui para consulta', selo: 'ENCERRADA' };
  }
  if (p.is_trial) return { titulo: nome, detalhe: ate ? `Teste até ${ate}` : 'Teste grátis', selo: 'TESTE' };
  return {
    titulo: nome,
    detalhe: `${p.members} de ${p.max_members} ${p.max_members === 1 ? 'pessoa' : 'pessoas'}`,
    selo: 'ATIVO',
  };
}
