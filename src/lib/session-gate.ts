import type { WaveMode } from '@/design/tile-math';

/**
 * Quando uma troca de sessão passa pela cortina, e de onde a onda nasce — a regra do portão,
 * pura, fora do React (mesma razão de `lock-policy.ts`: regra que só se testa subindo a tela é
 * regra que ninguém testa).
 *
 * O `SessionProvider` guarda a sessão MOSTRADA. Evento do mesmo usuário (refresh de token,
 * `USER_UPDATED`, metadados do onboarding) é aplicado na hora; usuário diferente (entrar, sair,
 * trocar de conta) cobre a tela, troca por baixo e revela.
 */

/** Um ponto da tela em fração (0..1), no referencial da onda. */
export interface Ponto {
  x: number;
  y: number;
}

export interface Onda {
  mode: WaveMode;
  origin?: Ponto;
}

/** Teto de CADA passo da troca (cobrir, revelar). Passou disso, a troca acontece assim mesmo. */
export const TETO_DA_TROCA_MS = 1500;
/** Teto da espera da abertura por fontes e sessão. */
export const TETO_DA_ABERTURA_MS = 2500;
/**
 * Quanto a origem registrada por um botão continua valendo. O login pode levar alguns segundos
 * na rede; passado isso, o evento de sessão já não tem relação com o toque.
 */
export const VALIDADE_DA_ORIGEM_MS = 4000;

/** `antes === undefined`: a sessão ainda não tinha resolvido — é a abertura, não uma troca. */
export function precisaDeCortina(antes: string | null | undefined, depois: string | null): boolean {
  return antes !== undefined && antes !== depois;
}

/**
 * Sair cobre DE BAIXO (a tela desce como uma porta); entrar nasce no botão que disparou, e sem
 * botão (link, código colado) desce do topo. Quem inverte a ordem para cobrir é a cortina.
 */
export function ondaDaTroca(depois: string | null, origem: Ponto | null): Onda {
  if (depois === null) return { mode: 'up' };
  if (origem) return { mode: 'radial', origin: origem };
  return { mode: 'down' };
}

export function origemValida(
  registro: { ponto: Ponto; em: number } | null,
  agora: number
): Ponto | null {
  if (!registro) return null;
  return agora - registro.em <= VALIDADE_DA_ORIGEM_MS ? registro.ponto : null;
}
