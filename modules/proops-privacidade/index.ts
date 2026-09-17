import { requireOptionalNativeModule } from 'expo-modules-core';

type ProOpsPrivacidadeNativeModule = {
  definirProtecao(ativa: boolean): void;
};

const nativeModule = requireOptionalNativeModule<ProOpsPrivacidadeNativeModule>('ProOpsPrivacidade');

/**
 * Esconde o app da FOTO que o sistema tira ao sair dele (o cartão dos recentes e o quadro que
 * aparece na volta). Sem isso, com a trava ligada, a volta mostrava a Hoje por um instante antes
 * de a trava cobrir: a foto é tirada na pausa, antes de qualquer coisa do JS chegar à tela.
 *
 * - **iOS**: uma capa de tinta entra na janela no `didEnterBackground` (antes da foto) e sai no
 *   `didBecomeActive`. Só no segundo plano de verdade — `inactive` é também o Face ID e a central
 *   de controle, e cobrir ali apagaria a marca durante o prompt da abertura.
 * - **Android 13+**: `setRecentsScreenshotEnabled(false)`. Sem módulo (web, build antigo) ou
 *   Android mais antigo, não faz nada — a tinta do JS continua cobrindo a tela viva.
 */
export function protegerAoSair(ativa: boolean): void {
  nativeModule?.definirProtecao(ativa);
}
