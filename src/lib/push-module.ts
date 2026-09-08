import { isRunningInExpoGo } from 'expo';
import type * as NotificationsModule from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Ponte única para o `expo-notifications`.
 *
 * No Expo Go do Android o pacote **não pode nem ser importado**. Ele tem um módulo de efeito
 * colateral (`DevicePushTokenAutoRegistration.fx`) que registra um listener de token no escopo
 * global, e desde o SDK 53 esse caminho chama `warnOfExpoGoPushUsage()`, que no Android **lança**
 * ("Android Push notifications ... was removed from Expo Go"). O throw acontece na AVALIAÇÃO do
 * módulo: `try/catch` em volta da chamada não adianta, e o `import` no `_layout.tsx` derrubava o
 * app inteiro antes de qualquer tela renderizar.
 *
 * Por isso o require é preguiçoso e condicional. Em dev build (e no iOS, onde a limitação é só um
 * warning) o pacote entra normal; no Expo Go/Android `notifications` é `null` e cada chamador
 * trata a ausência — push de verdade só existe em development build de qualquer forma.
 */
export const pushBlockedByExpoGo = Platform.OS === 'android' && isRunningInExpoGo();

export const notifications: typeof NotificationsModule | null = pushBlockedByExpoGo
  ? null
  : // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('expo-notifications') as typeof NotificationsModule);

/**
 * O canal de notificação do Android — **obrigatório, e antes do token**.
 *
 * Desde o Android 8 toda notificação precisa de um canal; desde o **Android 13** a doc do
 * `expo-notifications` é explícita: *"requires at least one notification channel to be created
 * before requesting push tokens"* — sem canal, o prompt de permissão pode simplesmente **não
 * aparecer**, e o push nunca funciona. No iOS nada disso existe, então o defeito é invisível
 * para quem só testa lá: a mesma armadilha do teclado.
 *
 * O id é **`default`** e não um nome nosso porque o servidor não manda `channelId`
 * (`agent/app/services/push.py`), e nesse caso a Expo entrega no canal `default`. Criar
 * `proops-alertas` deixaria a notificação cair num canal que ninguém configurou.
 *
 * `PRIVATE` esconde o conteúdo na tela de bloqueio: os avisos deste app dizem quanto você deve e
 * quando o saldo fica negativo, e isso não precisa aparecer para quem pega o celular na mesa.
 */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android' || !notifications) return;
  await notifications.setNotificationChannelAsync('default', {
    name: 'Lembretes e avisos',
    importance: notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: notifications.AndroidNotificationVisibility.PRIVATE,
  });
}
