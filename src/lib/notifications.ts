import type { NotificationResponse } from 'expo-notifications';
import { router } from 'expo-router';

import { notifications } from '@/lib/push-module';

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

/**
 * Rotas que um push pode abrir.
 *
 * **Allowlist, não string livre.** O `data` vem de fora do app; navegar para uma rota arbitrária
 * a partir de payload externo é uma porta que não precisa existir.
 */
const ALLOWED = {
  reminders: '/reminders',
  today: '/',
  forecast: '/finance/forecast',
  cards: '/finance/cards',
  budgets: '/finance/budgets',
  transactions: '/finance/transactions',
} as const;

type Target = keyof typeof ALLOWED;
type AllowedHref = (typeof ALLOWED)[Target];

function routeFor(data: unknown): AllowedHref | null {
  if (!data || typeof data !== 'object') return null;
  const target = (data as { target?: unknown }).target;
  if (typeof target !== 'string') return null;
  // `in` anda pela cadeia de protótipos: `'toString' in ALLOWED` é true e devolveria uma FUNÇÃO
  // para o `router.push`. A allowlist continuaria impedindo rota arbitrária, mas o app crasharia
  // ao tocar na notificação.
  return Object.hasOwn(ALLOWED, target) ? ALLOWED[target as Target] : null;
}

function open(response: NotificationResponse) {
  const href = routeFor(response.notification.request.content.data);
  if (!href) return;
  router.push(href);
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
