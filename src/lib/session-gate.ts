import type { WaveMode } from '@/design/wave-math';

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
  /** O círculo pode cobrir a partir do botão, mas a tela nova pode usar uma geometria própria. */
  revealMode?: WaveMode;
  /** A cobertura do login continua a curva da capa em vez de começar fora da tela. */
  fromCap?: boolean;
  /**
   * Onde revelar PARA. `capa` deixa a tinta no topo, na curva que o `AuthScreen` desenha igual —
   * é o cabeçalho das telas de conta. Sem o campo, a tinta sai da tela.
   */
  ate?: 'capa';
}

export type FaseDaCortina = 'abertura' | 'cobrindo' | 'coberta' | 'revelando' | 'aberta';

/** Mantém a tela antiga visível até a tinta cobri-la; libera a nova quando a tinta começa a sair. */
export function entradaLiberada(fase: FaseDaCortina, locked: boolean): boolean {
  return !locked && (fase === 'cobrindo' || fase === 'revelando' || fase === 'aberta');
}

/** Teto de cada passo animado da troca (cobertura e revelação). */
export const TETO_DA_TROCA_MS = 1500;
/** Teto da espera da abertura por fontes e sessão. */
export const TETO_DA_ABERTURA_MS = 2500;
/**
 * Teto da abertura quando a TRAVA está pedindo a senha do aparelho: a marca fica na tela enquanto
 * o sistema pergunta, e a tinta sobe direto para o app. É longo porque quem demora é a pessoa
 * digitando; passado isso, a abertura revela a própria trava (que tem o "tentar de novo").
 */
export const TETO_DA_TRAVA_MS = 20000;
/**
 * O mínimo que a marca fica na tela antes de a tinta subir, na abertura curta. Sem isso, num
 * aparelho rápido, a marca era um lampejo — e o pedido é que a passagem "logo → app" sempre
 * aconteça (17/09/2026).
 */
export const MARCA_MINIMA_MS = 900;

/** Quanto a abertura ainda espera por "pronto", dado desde quando espera e se a trava segura. */
export function esperaDaAbertura(desde: number, agora: number, segurando: boolean): number {
  const teto = segurando ? TETO_DA_TRAVA_MS : TETO_DA_ABERTURA_MS;
  return Math.max(0, teto - (agora - desde));
}

/** Quanto falta para a marca ter ficado o mínimo na tela. */
export function esperaDaMarca(visivelDesde: number, agora: number): number {
  return Math.max(0, MARCA_MINIMA_MS - (agora - visivelDesde));
}
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
 * A sessão nova sempre entra depois que a tela foi coberta. A cobertura desce e a revelação
 * sobe. Ao sair, a segunda passagem para na capa fixa do login; ao entrar, a primeira parte
 * dessa capa e a segunda descobre o app.
 *
 * Uma troca direta entre contas ainda pode usar a origem do botão. A abertura inicial também
 * para na capa para casar com o `AuthCap` estático.
 */
export function ondaDaTroca(depois: string | null, origem: Ponto | null): Onda {
  if (depois === null) return { mode: 'down', revealMode: 'up', ate: 'capa' };
  if (origem) return { mode: 'radial', origin: origem, revealMode: 'down' };
  return { mode: 'down', revealMode: 'up' };
}

export function origemValida(
  registro: { ponto: Ponto; em: number } | null,
  agora: number
): Ponto | null {
  if (!registro) return null;
  return agora - registro.em <= VALIDADE_DA_ORIGEM_MS ? registro.ponto : null;
}
