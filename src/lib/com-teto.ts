/**
 * Um TETO de tempo para uma promessa que pode não terminar nunca.
 *
 * ## Por que isto existe (14/09/2026)
 *
 * O `fetch` do React Native no Android é o OkHttp que o `OkHttpClientProvider` monta com
 * `connectTimeout(0)`, `readTimeout(0)` e `writeTimeout(0)` — **zero quer dizer infinito**. Com o
 * aparelho sem rede a conexão fica pendurada em vez de ser recusada: a promessa não resolve e não
 * rejeita, o `retry` do TanStack Query nunca dispara, `fetchStatus` fica em `fetching` para sempre
 * e a tela mostra o esqueleto até o app ser fechado. Medido no emulador: dois minutos na Lixeira.
 *
 * Um esqueleto eterno é pior que um erro — ele promete que ainda vai dar certo. §7 do
 * `design.md` manda erro inline com "Tentar de novo", e o caminho para lá passa por alguém
 * REJEITAR.
 *
 * ## Por que corrida, e não `AbortSignal.timeout`
 *
 * ⚠️ O `AbortSignal` foi tentado primeiro e **não produziu o estado de erro** nem com 1 ms, com o
 * aparelho online e o cache frio — e o motivo nunca foi encontrado (o polyfill de `fetch` do RN,
 * o `AbortSignal` do runtime e o `...init` do `supabase-js` são três peças que precisam concordar
 * sobre a mesma instância de sinal). Uma corrida não depende de nenhuma delas concordar: o
 * `setTimeout` rejeita, e quem rejeita primeiro ganha.
 *
 * O custo aceito é que a requisição original CONTINUA correndo em segundo plano — ninguém a
 * cancela. Para um GET de leitura isso é desperdício de bytes, não efeito colateral; e é o preço
 * de um mecanismo que funciona sem saber por que o outro não funcionou.
 *
 * ⚠️ O timer é limpo no `finally` da promessa original. Sem isso, cada requisição bem-sucedida
 * deixaria um `setTimeout` vivo até o fim do teto — no Android isso segura o JS timer module
 * acordado e aparece como bateria, não como bug.
 */
export function comTeto<T>(promessa: Promise<T>, ms: number, motivo: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promessa.finally(() => clearTimeout(timer)),
    new Promise<never>((_, rejeitar) => {
      timer = setTimeout(() => rejeitar(new Error(motivo)), ms);
    }),
  ]);
}
