/**
 * Um portão de carregamento por TELA, em vez de um por bloco.
 *
 * A queixa que originou isto foi literal: *"o que eu mais vi nesse app é tendo loader skeleton em
 * alguns componentes e durante o skeleton de um componente, o outro já está montado e pronto"*.
 * Com cada bloco decidindo sozinho quando parar de carregar, uma tela de 14 consultas monta em
 * pipoca — o herói preenche, 300 ms depois a carteira salta, depois o gráfico, depois a lista.
 *
 * ⚠️ **É `isPending`, não `isLoading`.** `isLoading` é `isPending && isFetching`: numa query que
 * ainda não começou a buscar ele é `false` com zero linhas, e a tela pisca o estado vazio
 * ("Nada em outubro") antes de ter perguntado qualquer coisa.
 *
 * ⚠️ **E `isFetching` NÃO entra.** Refetch de fundo (realtime, voltar do background,
 * pull-to-refresh) não pode trazer o skeleton de volta por cima de conteúdo que já está na tela.
 * O portão é só a PRIMEIRA carga.
 */

/** O pedaço do resultado do TanStack Query que este portão lê — e é só isto. */
export interface Consulta {
  isPending: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
}

/**
 * A tela está pronta para sair do skeleton?
 *
 * ⚠️ **`isPending` sozinho nunca vira `false` numa query DESLIGADA.** No TanStack v5,
 * `enabled: false` deixa a query em `status: 'pending'` com `fetchStatus: 'idle'` para sempre —
 * e um portão que só olhasse `isPending` deixaria a tela no skeleton **eternamente**, sem erro,
 * sem log, sem nada na tela dizendo o que houve. É o pior defeito que esta fase podia introduzir,
 * e ele é silencioso.
 *
 * Por isso a régua é a dupla: **só segura quem está pendente E BUSCANDO**. `idle` com
 * `isPending` é query desligada (ninguém VAI buscar) e `paused` é o aparelho sem rede (ninguém
 * CONSEGUE buscar) — nos dois casos a tela tem que desenhar o conteúdo/vazio dela em vez de
 * esperar sentada. O `paused` não é escolha nova: com um portão por bloco, `isLoading` já era
 * `false` sem rede, e cada bloco já mostrava o estado vazio. Segurar aqui seria a regressão.
 *
 * O primeiro render de uma query LIGADA já chega com `fetchStatus: 'fetching'`: o
 * `getOptimisticResult` do observer conta a busca que vai começar no mesmo tique. Então não há
 * janela em que uma query normal seja confundida com uma desligada.
 *
 * Condição que não é query (`range.pronto`, um `id` que ainda não existe) entra com `&&` na
 * chamada — não tem `fetchStatus` para oferecer:
 *
 * ```ts
 * const pronta = telaPronta(summary, cycle, accounts) && range.pronto;
 * ```
 */
export function telaPronta(...consultas: Consulta[]): boolean {
  return consultas.every((c) => !c.isPending || c.fetchStatus !== 'fetching');
}
