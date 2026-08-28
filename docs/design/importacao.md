# Importar extrato — `src/app/import.tsx` (Stack raiz)

O substituto do Open Finance: em vez de R$ 2,5k/mês de agregador, o usuário exporta o OFX/CSV do
banco e o app transforma em lançamentos revisáveis. É a **única** Edge Function que o app invoca
(`useImportStatement`, `use-finance.ts:508`); todo o resto é supabase-js direto.

**Fica no Stack raiz, fora das abas**, porque é tarefa com etapas: escolher arquivo → revisar →
confirmar. Tab bar visível no meio de uma revisão de 80 linhas é convite para sair pela metade.

Hoje são 322 linhas e dois estados controlados por um `useState` (`import.tsx:43`). Três defeitos
que a tela nova precisa fechar:

- **A mensagem certa não chega.** Plano Free recebe 402 com um texto pronto e gentil
  (*"Importar extrato é do plano Pro. No free dá para registrar pelo WhatsApp à vontade."*,
  `import-statement/index.ts:50`). Mas `functions.invoke` lança `FunctionsHttpError` em qualquer
  não-2xx (`@supabase/functions-js`, `FunctionsClient.js:268`) — `data` vem `null`, o `if (data &&
  'error' in data)` de `use-finance.ts:531` nunca roda, e o usuário lê
  `Alert.alert(..., String(err))` (`import.tsx:81-84`): *"Edge Function returned a non-2xx status
  code"*. O 402 e o 422 ("não encontrei lançamentos nesse arquivo") existem e **ninguém vê**.
- **A conta não fecha.** `pendentes` inclui `duplicate` (`import.tsx:52`) e o cabeçalho diz "N
  lançamentos para revisar" (`:161`), mas `aprovarTodos` filtra só `status === 'pending'`
  (`:89`). Confirmar 12 importa 10 e a tela não explica os 2 que ficaram.
- **Descarte destrutivo em um toque longo, sem volta e em silêncio.** `onLongPress` →
  `descartar.mutate` direto (`:188-191`), e `useDiscardImportItems` (`use-finance.ts:571`) e
  `useUpdateImportItem` (`:586`) não tratam erro: a UI muda, o banco não, e ninguém fica sabendo.

## Pergunta que responde

> "Meu banco tem 80 lançamentos que eu nunca vou digitar. Dá para trazer tudo de uma vez sem virar
> bagunça?"

## Persona

- **Primária: Rafa, 29** — autônomo, conta PJ com movimento demais para lançar no WhatsApp.
- **Secundária: Camila, 34** — organiza o mês fechado a partir do extrato.
- **Terciária: Jorge, 46** — traz a fatura do cartão. *A dele quase sempre é PDF, e PDF entra pelo
  WhatsApp (Gemini multimodal), não por aqui.* A tela precisa dizer isso **antes** de ele tentar.

## Entrada e saída

- **Entrada:** menu do header do Financeiro › Importar extrato · Perfil › Dados › Importações ·
  retomar um lote pelo histórico (`/import?batch=<id>`).
- **Saída:** confirmar → volta para o Financeiro com toast *"12 lançamentos importados"*.
  Bloqueado por plano → `modal /paywall` com a origem `import`.
- **Back:** com lote em revisão, `pop` **pergunta** (action sheet: "Sair e continuar depois?" ·
  "Descartar o lote"). Sair não perde nada — o lote fica em `import_batches` e volta pelo
  histórico —, mas o usuário não sabe disso, e é a tela que tem que dizer.

## Anatomia

A tela tem **duas etapas** e cada uma é uma tela inteira. Nunca as duas no mesmo scroll.

### Etapa 1 — trazer o arquivo

1. **Header nativo** — "Importar extrato", com **Cancelar** à esquerda (é `modal` de fluxo).
2. **Card de destaque (o único `GlassCard`) — a instrução**: ícone `arrow.down.doc`, título
   "Traga o extrato do seu banco", e o passo a passo em uma frase: *"Exporte em OFX ou CSV no app
   do banco. Eu categorizo tudo e você confere antes de entrar."*
   Abaixo, a linha que evita o erro mais comum: *"Foto de cupom e PDF de fatura? Manda direto no
   WhatsApp."* (hoje já existe em `import.tsx:118` — manter, subir).
3. **"Lançar na conta"** — chips de contas (`useAccounts`). Opcional: sem conta escolhida, o
   lançamento nasce sem conta, que é legítimo no modelo.
4. **Ação primária** — "Escolher arquivo" (`expo-document-picker`, `import.tsx:59`).
5. **Rodapé**: *"Até 500 lançamentos por arquivo."* O corte existe (`MAX_ITEMS`,
   `import-statement/index.ts:21`, `.slice(0, MAX_ITEMS)`) e hoje é **silencioso** — extrato de
   ano inteiro perde o resto sem avisar.

### Etapa 2 — revisar o lote

1. **Header nativo** — "Revisar 32 lançamentos". `headerRight`: menu com Descartar lote ·
   Selecionar todos.
2. **Card de destaque (o único `GlassCard`) — o resumo do lote**: quantos entram, quanto somam em
   despesa, quantos vieram categorizados por regra sua e quantos pela IA. Botão **"Confirmar N"**
   com o número **de verdade** — o que exclui as duplicatas não marcadas, fechando o buraco do
   `:161` vs `:89`.
3. **"Possíveis repetidos"** — seção **própria, no topo da lista**, com as linhas `duplicate`.
   Duplicata é **marcação, não bloqueio** (`0019`: dois cafés iguais no mesmo dia são legítimos) —
   quem decide é o usuário. Cada linha mostra a transação existente que casou (data, valor,
   descrição) e dois caminhos: **Importar assim mesmo** · **Descartar**.
   *Vem primeiro porque é a única decisão que exige pensar; o resto é conferência.*
4. **"Para revisar"** — `Row` por item: descrição, data, categoria sugerida, valor à direita com
   sinal e `tabular-nums`. Categoria é um chip **inline tocável** (abre `formSheet` de categorias),
   não um accordion que empurra a lista (`import.tsx:215-232`).
   Item sem categoria aparece como **"sem categoria"** em `warning`, não em cinza: é o que o
   usuário deveria olhar.
5. **"Já revisados"** — colapsada, com aprovados e descartados. Existe só para o "cadê aquele
   item que eu descartei?" e para desfazer.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Enviar arquivo | `useImportStatement()` | — | Edge Function `import-statement` | — |
| Lista do lote | `useImportItems(batchId)` | `['import-items', batchId]` | `import_items` | `import_items` (`0017`) |
| Confirmar | `useApproveImportItems()` | — | RPC `approve_import_items` (`0017`) | invalida financeiro inteiro |
| Descartar | `useDiscardImportItems()` | — | update `status='discarded'` | invalida `['import-items']` |
| Trocar categoria | `useUpdateImportItem()` | — | update `suggested_category` | idem |
| Contas | `useAccounts()` | `['accounts']` | `accounts` | `accounts` |

O que a Edge Function faz e a tela **não** duplica: parse (OFX/CSV), aplicação das regras do
usuário e marcação de duplicata numa chamada (`_prepare_import_batch`, `0019`), e a categorização
do resto em **uma única chamada Gemini para o lote inteiro** (`categorizeBatch`) — só das linhas
que as regras não resolveram. Uma chamada por linha seria cara e lenta; a tela nunca chama a IA
por item.

`useImportStatement` precisa **ler o corpo do erro**: `FunctionsHttpError` traz a `Response` em
`err.context`, então `await err.context.json()` devolve o `{ error }` que a function escreveu. Sem
isso, 402 e 422 são indistinguíveis de "deu ruim".

## Ação primária

**Confirmar o lote.** Um toque, com o número certo escrito no botão, e um action sheet nativo
resumindo o que vai acontecer: *"Lançar 30 itens? Os 2 possíveis repetidos ficam de fora."*

## Ações secundárias

- Trocar a categoria de um item (`formSheet` de categorias).
- **"Sempre categorizar assim"** no context menu do item → cria a regra (`categorization_rules`) e
  reaplica ao lote. É aqui que a regra nasce com contexto — dez itens do mesmo mercado numa tela só.
- Descartar item (context menu, com desfazer no toast).
- Importar mais um arquivo, ao terminar.

## Estados

- **Loading (enviando)** — o arquivo é lido inteiro para memória e vai como string no corpo do
  JSON (`import.tsx:70` + `use-finance.ts:520`): num extrato grande isso demora. Botão vira
  "Lendo o arquivo…" e a tela mostra `Skeleton` com a forma da lista — nunca um spinner mudo.
- **Loading (lote)** — `Skeleton` de 6 linhas.
- **Empty (nenhum item)** — não acontece: 422 antes disso.
- **Empty (tudo revisado)** — `EmptyState` ícone `checkmark.circle`, título "Tudo revisado", com
  **"Importar outro arquivo"** e **"Ver no financeiro"**.
- **Error 402 (plano sem importação)** — não é erro, é **paywall**: o texto do `can_import`
  (`private.plan_limits`, `0029`: só Pro e Família) vira o `modal /paywall`, com a frase que a
  function já escreveu.
- **Error 422 (arquivo ilegível)** — mensagem específica: *"Não achei lançamentos nesse arquivo.
  Ele é o extrato em OFX ou CSV, e não o comprovante em PDF?"* + "Escolher outro arquivo".
  `ACCEPTED` inclui `*/*` (`import.tsx:36`) de propósito (banco brasileiro manda MIME errado), o
  que significa que **qualquer arquivo passa pelo picker** — o erro amigável é a única barreira.
- **Error 500 / rede** — "Não deu para importar agora. Tenta de novo." com retry.
- **Error nas mutations** — descartar e trocar categoria falham em silêncio hoje; passam a fazer
  rollback visível + toast.
- **Conteúdo longo** — descrição de extrato é longa e feia; trunca em uma linha, com o texto
  completo no detalhe. Valor nunca trunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Etapa 1 → etapa 2 | continuidade espacial | push dentro do `modal`, transição nativa. Sem cross-fade próprio |
| Item confirmado | mudança de estado | sai da lista com `LinearTransition` em `Motion.fast`, stagger 30 ms (`import.tsx:185` já usa 30 ms — manter) |
| Confirmar todos | mudança de estado | lista esvazia com stagger curto e cai no empty; haptic `notificationAsync(Success)` |
| Descartar | mudança de estado | linha sai em `Motion.fast`; haptic `impactAsync(Medium)`; toast com **Desfazer** |
| Chip de categoria | feedback | `selectionAsync`, fundo em 120 ms |
| Barra de progresso do envio | explicação | indeterminada, `Motion.slow`; some quando o lote chega |

## Acessibilidade

- Cada item anuncia uma frase: *"Mercado São João, 12 de agosto, 45 reais, categoria mercado"*.
- Duplicata **nunca** é só o emoji ⚠️ (`import.tsx:196`): é ícone `exclamationmark.triangle` +
  a palavra "possível repetido".
- Aprovado/descartado idem (hoje ✅ e 🚫, `:197-198`).
- Alvos ≥ 44pt no chip de categoria dentro da linha.
- Dynamic Type XL: descrição e valor empilham.
- O botão "Confirmar N" anuncia o número.

## Fora de escopo

- **Parse de PDF e de foto aqui.** Vai pelo WhatsApp, com o mesmo `responseSchema` do Gemini. Duas
  portas para a mesma coisa é como o produto vira dois produtos.
- Conexão direta com banco (Open Finance/agregador): a decisão de custo está no `0017` e não muda
  por causa de tela.
- Editar valor, data ou descrição do item no staging: importação é conferir e aprovar. Corrigir é
  depois, no lançamento — onde já existe tela.
- Mapear colunas de CSV exótico à mão. Se o parser não leu, o erro amigável manda para o WhatsApp.
- Agendar importação recorrente. Extrato não chega sozinho.
