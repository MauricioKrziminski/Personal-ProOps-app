/**
 * Para onde um push pode levar — lógica pura, em `lib/` porque `node --test` não carrega `.tsx` e
 * porque isto é uma FRONTEIRA DE CONFIANÇA: o `data` é escrito por quem manda a notificação.
 * Mesmo motivo e mesmo formato de `cycle-routes.ts`.
 */

/**
 * Rotas que um push pode abrir.
 *
 * **Allowlist, não string livre.** O `data` vem de fora do app; navegar para uma rota arbitrária
 * a partir de payload externo é uma porta que não precisa existir.
 */
export const ALLOWED = {
  reminders: '/reminders',
  today: '/',
  forecast: '/finance/forecast',
  cards: '/finance/cards',
  budgets: '/finance/budgets',
  cycle: '/finance/cycle',
  invoice: '/finance/invoice/[id]',
  transaction: '/finance/[txId]',
} as const;

/** Alvos de ITEM: sem uuid válido no `ref` caem na lista de antes (a mesma do servidor). */
const LISTA_DO_ITEM = { invoice: '/finance/cards', transaction: '/' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PushRoute =
  | { pathname: Exclude<AllowedHref, '/finance/invoice/[id]' | '/finance/[txId]'>; params?: { month: string } }
  | { pathname: '/finance/invoice/[id]'; params: { id: string } }
  | { pathname: '/finance/[txId]'; params: { txId: string } };

/** O alvo que o app abre para um alerta salvo (`kind` + `ref`), o mesmo que o servidor manda. */
export function alvoDoAlerta(kind: string): Target | null {
  if (kind === 'invoice_due') return 'invoice';
  if (kind === 'bill_due') return 'transaction';
  return null;
}

/**
 * ⚠️ **`transactions` saiu daqui em 14/09/2026, e `cycle` entrou.** Esta lista e a `TARGETS` de
 * `agent/app/services/push.py` são as duas metades de um contrato: alvo que existe só de um lado
 * é caminho morto. O servidor nunca produziu `transactions` (nenhum ramo de `target_for` devolve
 * isso, e `send` reescreve para `today` o que não estiver em `TARGETS`), então ele era uma rota
 * que o app sabia abrir e ninguém mandava. `src/lib/push-targets-contract.test.ts` quebra o build
 * se as duas divergirem de novo.
 */

type Target = keyof typeof ALLOWED;
type AllowedHref = (typeof ALLOWED)[Target];

/** Só `YYYY-MM` ou `YYYY-MM-DD`. Nada mais vira parâmetro de rota. */
const MES = /^\d{4}-\d{2}(-\d{2})?$/;

/**
 * ⚠️ **A allowlist é o `target`; o `ref` nunca escolhe PARA ONDE se navega.**
 * `ref` chega de fora (é a chave de dedupe do alerta) e só é lido no destino que sabe o que fazer
 * com ele — hoje `cycle`, onde ele é o mês do ciclo que fechou. Passa por regex antes de virar
 * parâmetro; qualquer outra coisa é ignorada e a rota abre sem parâmetro, no ciclo corrente.
 *
 * ⚠️ O `ref` do fechamento é a data de FIM do ciclo (`2026-09-10`), um dia do MEIO do mês. Isso
 * só funciona porque `primeiroDiaDoMes`/`mesmoMes` (`lib/dates.ts`) normalizam os dois formatos;
 * antes disso, `2026-09-10` abria a tela do ciclo vazia, sem erro nenhum.
 */
export function routeFor(data: unknown): PushRoute | null {
  if (!data || typeof data !== 'object') return null;
  const target = (data as { target?: unknown }).target;
  if (typeof target !== 'string') return null;
  // `in` anda pela cadeia de protótipos: `'toString' in ALLOWED` é true e devolveria uma FUNÇÃO
  // para o `router.push`. A allowlist continuaria impedindo rota arbitrária, mas o app crasharia
  // ao tocar na notificação.
  if (!Object.hasOwn(ALLOWED, target)) return null;
  const ref = (data as { ref?: unknown }).ref;
  if (target === 'invoice' || target === 'transaction') {
    // `ref` que não é uuid nunca vira rota montada com texto cru.
    if (typeof ref !== 'string' || !UUID.test(ref)) return { pathname: LISTA_DO_ITEM[target] };
    return target === 'invoice'
      ? { pathname: '/finance/invoice/[id]', params: { id: ref } }
      : { pathname: '/finance/[txId]', params: { txId: ref } };
  }
  const pathname = ALLOWED[target as Exclude<Target, 'invoice' | 'transaction'>];
  if (target === 'cycle' && typeof ref === 'string' && MES.test(ref)) {
    return { pathname, params: { month: ref } };
  }
  return { pathname };
}

