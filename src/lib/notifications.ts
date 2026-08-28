import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

/**
 * Recepção de push.
 *
 * Antes disto não existia **nada** do lado do app: sem `setNotificationHandler` a notificação com
 * o app aberto não aparecia, e sem listener tocar nela não levava a lugar nenhum. O lembrete
 * chegava e morria na bandeja.
 */

/** Com o app em primeiro plano a notificação também precisa aparecer — senão ela some. */
export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
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

function routeFor(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const target = (data as { target?: unknown }).target;
  if (typeof target !== 'string') return null;
  // `in` anda pela cadeia de protótipos: `'toString' in ALLOWED` é true e devolveria uma FUNÇÃO
  // para o `router.push`. A allowlist continuaria impedindo rota arbitrária, mas o app crasharia
  // ao tocar na notificação.
  return Object.hasOwn(ALLOWED, target) ? ALLOWED[target as Target] : null;
}

function open(response: Notifications.NotificationResponse) {
  const href = routeFor(response.notification.request.content.data);
  if (!href) return;
  // @ts-expect-error — a allowlist acima é a garantia; typedRoutes não estreita string.
  router.push(href);
}

/**
 * Liga os dois caminhos de entrada: app já aberto e app aberto PELA notificação (cold start).
 * Sem o segundo, tocar numa notificação com o app fechado abre a Home e perde o destino.
 */
export function attachNotificationListeners() {
  const sub = Notifications.addNotificationResponseReceivedListener(open);

  Notifications.getLastNotificationResponseAsync()
    .then((last) => {
      if (last) open(last);
    })
    .catch(() => {
      // cold start sem notificação é o caso normal
    });

  return () => sub.remove();
}
