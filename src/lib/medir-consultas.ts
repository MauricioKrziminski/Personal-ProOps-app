import type { QueryClient } from '@tanstack/react-query';

/**
 * Medição de consultas — só para investigar lentidão, desligada por padrão.
 *
 * Com `EXPO_PUBLIC_MEDIR_CONSULTAS=1` (e `__DEV__`), loga `[consulta] <chave> início|fim <ms>` a
 * cada transição de `fetchStatus`. O relógio recomeça quando uma consulta começa depois de 1 s
 * sem nenhuma ativa — o toque que abre uma tela —, então os "ms" são desde a navegação. Sem a env
 * o custo é zero: nada se assina.
 */
const ligada = __DEV__ && process.env.EXPO_PUBLIC_MEDIR_CONSULTAS === '1';
const OCIOSO_MS = 1000;

export function medirConsultas(client: QueryClient) {
  if (!ligada) return;
  const ultimo = new Map<string, string>();
  const ativas = new Set<string>();
  let zero = Date.now();
  let ociosoDesde = Date.now();
  client.getQueryCache().subscribe((evento) => {
    if (evento.type !== 'updated') return;
    const { queryHash, queryKey, state } = evento.query;
    if (ultimo.get(queryHash) === state.fetchStatus) return;
    ultimo.set(queryHash, state.fetchStatus);
    const agora = Date.now();
    const comecou = state.fetchStatus === 'fetching';
    if (comecou && !ativas.size && agora - ociosoDesde > OCIOSO_MS) zero = agora;
    if (comecou) ativas.add(queryHash);
    else ativas.delete(queryHash);
    if (!ativas.size) ociosoDesde = agora;
    console.log(`[consulta] ${JSON.stringify(queryKey)} ${comecou ? 'início' : 'fim'} ${agora - zero}ms`);
  });
}
