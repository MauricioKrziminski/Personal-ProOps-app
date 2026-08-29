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
