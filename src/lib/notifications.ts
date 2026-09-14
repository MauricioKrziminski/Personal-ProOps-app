import type { NotificationResponse } from 'expo-notifications';
import { router } from 'expo-router';

import { notifications } from '@/lib/push-module';
import { routeFor } from '@/lib/push-routes';

/**
 * Recepção de push.
 *
 * Antes disto não existia **nada** do lado do app: sem `setNotificationHandler` a notificação com
 * o app aberto não aparecia, e sem listener tocar nela não levava a lugar nenhum. O lembrete
 * chegava e morria na bandeja.
 *
 * Tudo passa por `notifications` (`push-module.ts`), que é `null` no Expo Go do Android — lá o
 * pacote nem pode ser importado. Sem push nesse ambiente as duas funções viram no-op.
 */

/** Com o app em primeiro plano a notificação também precisa aparecer — senão ela some. */
export function configureNotificationHandler() {
  notifications?.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function open(response: NotificationResponse) {
  const rota = routeFor(response.notification.request.content.data);
  if (!rota) return;
  router.push(rota);
}

/**
 * Liga os dois caminhos de entrada: app já aberto e app aberto PELA notificação (cold start).
 * Sem o segundo, tocar numa notificação com o app fechado abre a Home e perde o destino.
 */
export function attachNotificationListeners() {
  if (!notifications) return;

  const sub = notifications.addNotificationResponseReceivedListener(open);

  notifications
    .getLastNotificationResponseAsync()
    .then((last) => {
      if (last) open(last);
    })
    .catch(() => {
      // cold start sem notificação é o caso normal
    });

  return () => sub.remove();
}
