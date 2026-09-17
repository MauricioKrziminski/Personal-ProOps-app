/**
 * Quando o app pede autenticação de novo — lógica pura, em `lib/` porque é a regra que decide se
 * o dado financeiro fica exposto, e regra assim não pode depender de subir a tela para testar.
 *
 * Mesmo motivo de `app/graph/policy.py` no agente: *"regra de segurança que só dá para testar
 * subindo o grafo inteiro é regra que ninguém testa"*.
 *
 * ⚠️ **A trava NÃO tem senha própria — ela é a do celular** (decisão do dono do produto,
 * 14/09/2026): *"a senha que eu queria é a que já usa no celular, igual bancos como banco do
 * brasil, nubank, e outros usam. Ele usa a própria senha do celular e se tiver biometria ou
 * faceID cadastrado ele reaproveita"*. A primeira versão tinha PIN de 6 dígitos guardado por
 * nós, com contagem de erros e espera — tudo isso saiu, e com ele saiu a pior parte: **uma senha
 * a mais para o usuário decorar, e um caminho de recuperação que nós teríamos que inventar.**
 * Quem guarda segredo, conta tentativa e pune rajada agora é o sistema operacional, que faz isso
 * em hardware (Secure Enclave / Keystore) e não em `AsyncStorage`.
 */

/** O usuário ligou a trava no Perfil? Não existe meio-termo: a forma de autenticar é do aparelho. */
export type LockMode = 'off' | 'on';

/** Depois de quantos segundos em segundo plano o app volta a pedir. */
export type LockDelay = 0 | 30 | 60;

export interface LockState {
  mode: LockMode;
  delaySeconds: LockDelay;
  /** `Date.now()` de quando o app foi para segundo plano; `null` = nunca saiu. */
  backgroundedAt: number | null;
  /**
   * O app abriu um seletor de arquivo, a câmera ou o prompt de autenticação?
   *
   * ⚠️ **No Android isso dispara `background`**, e sem esta bandeira importar um extrato trancaria
   * o app no meio da operação — a pessoa escolhe o arquivo, volta, e leva um pedido de senha por
   * cima da tela de importação. Vale para `DocumentPicker`, foto de cupom e para o próprio
   * `authenticateAsync`, que também tira o app do primeiro plano.
   */
  systemUiOpen: boolean;
  /** Há conta aberta? Sem sessão não há o que trancar: a porta é o login. */
  temSessao: boolean;
}

/**
 * Deve trancar ao voltar para o primeiro plano?
 *
 * ⚠️ **`delaySeconds: 0` significa IMEDIATO, e `0` é falsy** — escrever `if (delay)` faz o modo
 * mais seguro virar o único que nunca tranca. É o padrão do nicho e o default daqui.
 */
export function deveTrancar(s: LockState, agora: number): boolean {
  if (s.mode === 'off') return false;
  if (!s.temSessao) return false;
  if (s.systemUiOpen) return false;
  if (s.backgroundedAt === null) return false;
  return agora - s.backgroundedAt >= s.delaySeconds * 1000;
}

/** O app abre trancado quando a trava está ligada — sempre, sem janela de carência. */
export function deveTrancarNoInicio(mode: LockMode): boolean {
  return mode !== 'off';
}

/**
 * Terminou uma operação que abriu UI do sistema — a bandeira `systemUiOpen` já pode cair?
 *
 * ⚠️ **Ela é consumida pelo `active` que o fechamento produz, NUNCA por um relógio.** Medido no
 * simulador iOS em 14/09/2026, com a bandeira caindo por `setTimeout` de 1 s:
 *
 * ```
 * 0,6s  autenticar()            → systemUiOpen = true
 * 0,6s  appstate=inactive       → backgroundedAt gravado
 * 13,4s resultado success:true  → app destrancado; timer de 1 s começa
 * 14,7s appstate=active         → bandeira JÁ caiu: deveTrancar = true
 * 14,7s autenticar()            → cortina de volta, pede de novo… e de novo
 * ```
 *
 * O `active` chegou **1,3 s** depois de `authenticateAsync` resolver. Quem via isso concluía que
 * o Face ID não funcionava — ele funcionava, e o app se trancava logo atrás. Esticar o prazo só
 * moveria a corrida de lugar: quem sabe que a UI do sistema fechou é o evento que ela produz.
 *
 * A única vez em que cai na hora é quando o app **nunca saiu do primeiro plano** (o
 * `BiometricPrompt` do Android é um diálogo, não uma tela): aí não vem `active` nenhum para
 * consumi-la, e deixá-la de pé engoliria o próximo retorno de verdade.
 */
export function bandeiraCaiAoTerminar(emVoo: number, saiuDoPrimeiroPlano: boolean): boolean {
  return emVoo === 0 && !saiuDoPrimeiroPlano;
}

/** E no `active`: ela cai assim que a última operação em voo terminou. */
export function bandeiraCaiNoActive(emVoo: number): boolean {
  return emVoo === 0;
}

/**
 * O prompt do sistema terminou — abre o app ou continua trancado?
 *
 * ⚠️ **Só `success` abre.** Com `disableDeviceFallback: false` o sistema já ofereceu a senha do
 * aparelho DENTRO do próprio prompt, então não existe mais o "caiu no nosso PIN": qualquer coisa
 * diferente de sucesso é a pessoa tendo desistido ou falhado, e a tela continua trancada com o
 * botão de tentar de novo. `user_fallback` — que na versão com PIN próprio era o caminho mais
 * usado e por pouco ficou morto — aqui nem chega: o "Usar senha" é resolvido pelo sistema.
 */
export function aposAutenticar(r: { success: boolean }): 'aberto' | 'trancado' {
  return r.success ? 'aberto' : 'trancado';
}

/**
 * O aparelho consegue autenticar alguém?
 *
 * ⚠️ **O número é `SecurityLevel` do `expo-local-authentication`, e `NONE` é 0.** Celular sem
 * bloqueio de tela nenhum não tem como provar quem é o dono — oferecer a trava ali é um botão
 * que só sabe falhar, e pior: ligada, ela trancaria o app para SEMPRE, porque nenhum prompt
 * conseguiria abrir. A tela mostra o que fazer (pôr um bloqueio no sistema) em vez do controle.
 */
export function podeTrancar(nivelDoAparelho: number): boolean {
  return nivelDoAparelho > 0;
}
