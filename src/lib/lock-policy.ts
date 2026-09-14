/**
 * Quando o app precisa pedir o PIN de novo — lógica pura, em `lib/` porque é a regra que decide
 * se o dado financeiro fica exposto, e regra assim não pode depender de subir a tela para testar.
 *
 * Mesmo motivo de `app/graph/policy.py` no agente: *"regra de segurança que só dá para testar
 * subindo o grafo inteiro é regra que ninguém testa"*.
 */

/** O que o usuário escolheu no Perfil. `off` é o padrão e é o comportamento de hoje. */
export type LockMode = 'off' | 'pin' | 'biometric';

/** Depois de quantos segundos em segundo plano o app volta a pedir. */
export type LockDelay = 0 | 30 | 60;

export interface LockState {
  mode: LockMode;
  delaySeconds: LockDelay;
  /** `Date.now()` de quando o app foi para segundo plano; `null` = nunca saiu. */
  backgroundedAt: number | null;
  /**
   * O app abriu um seletor de arquivo, a câmera ou o prompt de biometria?
   *
   * ⚠️ **No Android isso dispara `background`**, e sem esta bandeira importar um extrato trancaria
   * o app no meio da operação — a pessoa escolhe o arquivo, volta, e leva um pedido de PIN por
   * cima da tela de importação. Vale para `DocumentPicker`, foto de cupom e para o próprio
   * `authenticateAsync`, que também tira o app do primeiro plano.
   */
  systemUiOpen: boolean;
}

/**
 * Deve trancar ao voltar para o primeiro plano?
 *
 * ⚠️ **`delaySeconds: 0` significa IMEDIATO, e `0` é falsy** — escrever `if (delay)` faz o modo
 * mais seguro virar o único que nunca tranca. É o padrão do nicho e o default daqui.
 */
export function deveTrancar(s: LockState, agora: number): boolean {
  if (s.mode === 'off') return false;
  if (s.systemUiOpen) return false;
  if (s.backgroundedAt === null) return false;
  return agora - s.backgroundedAt >= s.delaySeconds * 1000;
}

/** O app abre trancado quando a trava está ligada — sempre, sem janela de carência. */
export function deveTrancarNoInicio(mode: LockMode): boolean {
  return mode !== 'off';
}

/**
 * A biometria falhou/foi cancelada — cai no PIN ou segue trancado?
 *
 * ⚠️ **`user_fallback` NÃO é falha.** Com `disableDeviceFallback: true`, tocar em "Usar senha"
 * volta como `{ success: false, error: 'user_fallback' }`. Tratar tudo que não é `success` como
 * erro deixa esse botão MORTO — e ele é o caminho que mais gente usa quando a digital não pega de
 * primeira. `user_cancel` e `system_cancel` também não são erro: a pessoa desistiu da digital, o
 * PIN continua valendo.
 */
export function aposBiometria(r: { success: boolean; error?: string }): 'aberto' | 'pedir-pin' {
  if (r.success) return 'aberto';
  return 'pedir-pin';
}

/** Quantas tentativas erradas antes de esperar, e quanto esperar. */
export const TENTATIVAS_ATE_ESPERAR = 5;
export const ESPERA_SEGUNDOS = 30;

/**
 * ⚠️ **Sem limite, um PIN de 6 dígitos cai em minutos por tentativa e erro** — são 1 milhão de
 * combinações e o teclado é da própria tela. A espera não protege contra quem extraiu o
 * aparelho; protege contra quem pegou o celular destravado, que é a ameaça que esta feature
 * existe para cobrir.
 */
export function esperaRestante(erros: number, ultimoErroEm: number | null, agora: number): number {
  if (erros < TENTATIVAS_ATE_ESPERAR || ultimoErroEm === null) return 0;
  const fim = ultimoErroEm + ESPERA_SEGUNDOS * 1000;
  return Math.max(0, Math.ceil((fim - agora) / 1000));
}
