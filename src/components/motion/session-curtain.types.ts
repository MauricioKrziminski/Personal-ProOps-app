import type { Onda, Ponto } from '@/lib/session-gate';

/**
 * A cortina de azulejos da raiz. Nativo e web implementam o MESMO contrato (frontend.md:
 * arquivo por plataforma com o tipo compartilhado).
 */
export interface CortinaApi {
  /** Pré-monta a camada invisível para uma ação que abrirá a cortina logo depois. */
  preparar(): void;
  /** Cobre a tela a partir da onda; resolve quando o último azulejo assentou. */
  cobrir(onda: Onda): Promise<void>;
  /** Continua a curva do cabeçalho do login para baixo ao cobrir a tela. */
  cobrirDaCapa(): Promise<void>;
  /** Fecha imediatamente se a animação de cobertura falhar ou exceder o teto de segurança. */
  cobrirJa(): void;
  /** Descobre; resolve quando o último azulejo saiu e a camada desmontou. */
  revelar(onda: Onda): Promise<void>;
  /** Abre à força, sem animação — a saída de quem estourou o teto. */
  abrirJa(): void;
  /** O centro do botão que vai disparar uma troca de sessão, em fração da tela. */
  lembrarOrigem(ponto: Ponto): void;
  /** Consome a origem lembrada, se ainda vale. */
  tomarOrigem(): Ponto | null;
  /**
   * A raiz avisa que fontes e sessão estão prontas; a abertura só revela depois disso. Com o
   * destino `conta` (sem sessão), a abertura para na capa das telas de conta.
   */
  marcarPronto(destino: 'app' | 'conta'): void;
  /**
   * A trava está pedindo a senha do aparelho: a abertura segura a marca (com um teto longo) até
   * `marcarPronto`, para a tinta subir direto no app desbloqueado.
   */
  segurarAbertura(): void;
}
