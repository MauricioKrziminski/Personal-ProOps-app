# Sem rede, a tela ficava em ESQUELETO para sempre — em vez de mostrar erro

**Aberto e FECHADO em 14/09/2026.** Valia para o app inteiro, não só para Notas.

## O que acontecia

Com o aparelho sem rede e a consulta ainda **sem cache**, a tela desenhava `Skeleton` e não saía
mais disso. Medido no emulador em modo avião: a Lixeira ficou **dois minutos** "carregando".

Isso contrariava §7 de `.claude/rules/design.md`, que exige erro inline e específico com "Tentar
de novo". Um esqueleto eterno é pior que um erro: ele promete que ainda vai dar certo.

## A causa, confirmada

**O `fetch` do React Native não tem timeout nenhum.** O `OkHttpClientProvider` monta o cliente
com `connectTimeout(0)`, `readTimeout(0)` e `writeTimeout(0)`, e zero quer dizer INFINITO. Sem
rede a conexão fica pendurada em vez de ser recusada, então:

1. a promessa do `fetch` não resolve **e não rejeita**;
2. o `supabase-js` só transforma em `{ error }` o que REJEITA — nada chega;
3. a `queryFn` fica presa no `await`, o `retry: 1` nunca dispara;
4. `isPending` continua `true` com `fetchStatus: 'fetching'`, que é exatamente a combinação que
   `telaPronta` segura — e com razão: do ponto de vista dela a busca ainda está acontecendo.

Nada engolia erro nenhum. **Não havia erro** — era uma espera sem fim.

## A correção

`comTeto` (`src/lib/com-teto.ts`), ligado em `global.fetch` do cliente em `src/lib/supabase.ts`:
uma corrida entre a requisição e um `setTimeout` de 15 s que rejeita. Vale para PostgREST, Auth e
Storage de uma vez — o conserto é no cliente, não em cada hook.

⚠️ **Não é `AbortSignal.timeout`, e a tentativa com ele foi revertida antes** por não produzir o
estado de erro nem com 1 ms. A corrida não depende de o polyfill de `fetch`, o `AbortSignal` do
runtime e o `...init` do `supabase-js` concordarem sobre a mesma instância de sinal: quem rejeita
primeiro ganha. O custo é que a requisição original continua correndo — desperdício de bytes num
GET, não efeito colateral.

## Como foi verificado (14/09/2026, emulador Android, build de desenvolvimento)

1. **Prova do mecanismo, com o aparelho ONLINE.** Teto temporário de **1 ms** só nas URLs
   `/rest/v1/notes`, com log em cada elo. A cadeia inteira apareceu: o teto estourou → o
   `supabase-js` devolveu `{"message":"Error: Sem resposta do servidor…"}` → a `queryFn` recebeu
   o erro e lançou → a tela desenhou **"Não deu para carregar as notas · Tentar de novo"**.
   Isto é o que a tentativa anterior nunca conseguiu mostrar.
2. **O caso real.** Modo avião ligado, consulta nova (um termo de busca que nunca rodou), teto de
   15 s: o esqueleto apareceu e, dentro da janela do teto + `retry`, virou o mesmo card de erro.

⚠️ **O aparelho precisa ser o pacote de DESENVOLVIMENTO** (`com.proops.personal.dev`). O
`com.proops.personal` instalado no emulador é build de release: ele não lê o Metro, e medir nele
é medir código velho. O sinal de que se está no errado é o botão "Entrar como teste (dev)" não
existir na tela de login. E com o simulador iOS ligado ao mesmo Metro, os dois escrevem no mesmo
log — a linha diz de quem é pelo `platform=` da URL do bundle.

## O que muda de comportamento junto (aceito, não é regressão)

Refetch de fundo que falha agora **erra** em ~31 s (15 s + `retry: 1`) em vez de ficar pendurado
para sempre. Onde a tela lê `isError ? [] : (data ?? [])` — que é a convenção escrita em ~10
arquivos, com o motivo: mostrar dado velho depois de uma falha é mentir sobre atualidade — o
conteúdo em cache dá lugar ao card de erro. Era o que aquelas linhas sempre quiseram dizer; antes
elas simplesmente nunca eram alcançadas sem rede.

## O que ficou de fora, e quando fazer

`onlineManager` do TanStack ligado a uma fonte de conectividade (`expo-network`) faria a tela
reagir **na hora**, sem esperar os 15 s, e retomar sozinha quando a rede voltar — `telaPronta` já
trata `fetchStatus: 'paused'` para isso. Não entrou porque é dependência nativa nova para um
ganho de tempo de espera, não de correção. Vale a pena no dia em que os ~31 s virarem queixa.
