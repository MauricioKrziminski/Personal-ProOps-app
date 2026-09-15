# Sem rede, a tela fica em ESQUELETO para sempre — em vez de mostrar erro

**Aberto em 14/09/2026. Vale para o app inteiro, não só para Notas.**

## O que acontece

Com o aparelho sem rede e a consulta ainda **sem cache**, a tela desenha `Skeleton` e não sai
mais disso. Medido no emulador em modo avião: a Lixeira ficou **dois minutos** "carregando".

Isso contraria §7 de `.claude/rules/design.md`, que exige erro inline e específico com "Tentar de
novo". Um esqueleto eterno é pior que um erro: ele promete que ainda vai dar certo.

## Como reproduzir

1. `adb shell svc wifi disable && adb shell settings put global airplane_mode_on 1`
2. Abrir uma tela cuja consulta ainda não rodou nesta sessão (a Lixeira serve).
3. Esperar. Nada muda.

## O que JÁ funciona (não confundir)

- **Mutação** que falha aparece: toast vermelho + rollback visível. Verificado no mesmo teste
  ("Não deu para desarquivar", com o item voltando para a lista).
- A tela **tem** o estado de erro escrito (`isError` → card com "Tentar de novo"). O problema é
  que a consulta nunca chega lá.

## Causa provável, NÃO confirmada

O `fetch` do `supabase-js` não tem timeout: a promessa não rejeita, a query não sai de
`isLoading` e o `retry` nem acontece. As requisições saem (log confirma quatro tentativas em
`/rest/v1/notes`) e nenhuma resolve.

⚠️ **Um teto de `AbortSignal.timeout` foi tentado e NÃO produziu o estado de erro** — nem com
1 ms, com o aparelho online e cache frio. `AbortSignal.timeout` existe no runtime (conferido) e o
`fetch` embrulhado é o que roda (conferido), então o que engole a rejeição está entre o
`supabase-js` e o TanStack Query, e não foi encontrado. A tentativa foi revertida para não deixar
no código um mecanismo que ninguém provou.

## Por onde continuar

1. Instrumentar o `queryFn` de `useNotesList` e ver o que ele recebe quando o `fetch` aborta —
   se o erro chega e o TanStack o trata como **cancelamento** (que volta ao estado anterior em
   vez de virar erro), a correção é outra: não usar `AbortSignal` e sim uma corrida com
   `Promise.race` + rejeição própria.
2. Decidir se o app passa a ter `onlineManager` ligado ao NetInfo. Hoje não tem: o TanStack
   acredita que está sempre online, então nem o modo "pausado" dele existe aqui.
