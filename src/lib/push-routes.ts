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
} as const;

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
export function routeFor(data: unknown): { pathname: AllowedHref; params?: { month: string } } | null {
  if (!data || typeof data !== 'object') return null;
  const target = (data as { target?: unknown }).target;
  if (typeof target !== 'string') return null;
  // `in` anda pela cadeia de protótipos: `'toString' in ALLOWED` é true e devolveria uma FUNÇÃO
  // para o `router.push`. A allowlist continuaria impedindo rota arbitrária, mas o app crasharia
  // ao tocar na notificação.
  if (!Object.hasOwn(ALLOWED, target)) return null;
  const pathname = ALLOWED[target as Target];
  const ref = (data as { ref?: unknown }).ref;
  if (target === 'cycle' && typeof ref === 'string' && MES.test(ref)) {
    return { pathname, params: { month: ref } };
  }
  return { pathname };
}

