# Orçamentos — `src/app/(tabs)/finance/budgets.tsx`

Hoje é `src/app/finance/budgets.tsx`, 354 linhas. A tela tem um navegador de mês próprio
(`budgets.tsx:112-134`) visualmente **diferente** do de `transactions.tsx:111-133`, apesar de os dois
usarem `shiftMonth`/`monthLabel` copiados linha a linha — e os dois usam os glyphs de texto `‹` e `›`
como se fossem ícone (`budgets.tsx:120`, `:132`), o que o design.md §2 proíbe. Todo card é
`GlassCard` (`:149`, `:178`, `:188`), o formulário é um bloco inline que expande no fim da lista
(`:187-261`), a remoção é `onLongPress` + `Alert` (`:147`, `:93`) e o erro de `useBudgets`
(`:45`, desestruturado só como `data`) **não aparece em lugar nenhum**.

## Pergunta que responde

> "Quanto ainda posso gastar em cada categoria este mês?"

Não é "quanto eu gastei" — isso é a aba Financeiro. Aqui a resposta é **o que sobra do limite**.

## Persona

- **Primária: Camila, 34** — organizada, é ela quem define limite. A pergunta dela é "onde furei?",
  e a resposta útil é o que passou de 80%, não a lista alfabética.
- **Secundária: Rafa, 29** — renda irregular. Para ele o rollover é o recurso principal: mês fraco
  deixa sobra, mês forte usa. Ele precisa entender a regra sem ler documentação.
- **Casal (workspace compartilhado)** — o limite é do workspace, o gasto de qualquer membro conta.
  A tela não pode dar a impressão de que o orçamento é pessoal.

## Entrada e saída

- **Entrada:** `push` da seção "Gerenciar" da aba Financeiro; `push` do bloco "Passando do
  orçamento" da aba Hoje; push de alerta de orçamento estourado (`send-alerts`).
- **Saída:** toque numa categoria → `push /finance/transactions` com o filtro de categoria e mês já
  aplicados (é a única pergunta que segue naturalmente: *"onde foram esses R$ 480?"*). Criar/editar
  abre `formSheet`, não navega.
- **Back:** pop para a origem. O mês selecionado **não** volta com o usuário — cada entrada começa no
  mês corrente.

## Anatomia

1. **Header nativo** — large title "Orçamentos" com colapso no scroll. `headerRight` = `plus`
   (`Icon`, `expo-symbols`) que abre o `formSheet` de novo orçamento. O `＋ Novo orçamento`
   (`budgets.tsx:258`) desce da ponta da lista para o header: botão de criar não pertence ao fim do
   conteúdo, onde só chega quem rola tudo.
2. **`MonthPicker` compartilhado (novo)** — logo abaixo do header, **o mesmo componente** de
   `transactions.tsx` e da aba Financeiro. Setas viram `chevron.left` / `chevron.right` do
   `expo-symbols`, o rótulo do mês é `tabular-nums`. Duas implementações do mesmo controle é a razão
   de as duas telas parecerem de apps diferentes.
3. **Card de destaque (o único `GlassCard` da tela) — "Sobrou do mês"**
   Soma dos `limit_cents` menos soma dos `spent_cents` das linhas de `budgets_status`, valor grande
   em `Fonts.rounded` + `tabular-nums`, e abaixo `X de Y categorias no limite`. Somar as linhas no
   cliente é aceitável aqui (mesma precedência de `debts.tsx:119`): é agregação de uma lista já
   carregada, não uma segunda leitura do banco.
   *É o destaque porque é o único número da tela que decide comportamento hoje à noite.*
4. **"Passando do limite"** — categorias ≥ 80%, ordenadas pelo percentual, em `Card` **opaco**.
   Barra + categoria + `faltam R$ 120`. Vem antes do resto porque é a única parte acionável.
5. **"No controle"** — o restante, mesma linha, sem alarme. Colapsável, começa aberta.
6. **"Sem limite definido"** — categorias com gasto no mês e **sem** orçamento, com uma ação
   "Definir limite" que abre o sheet já com a categoria preenchida. É a conversão mais natural da
   tela e hoje não existe: o usuário teria que adivinhar em qual categoria ele gasta.

Cada linha mostra a origem do limite: `só este mês` quando `month` não é nulo, e
`R$ 500 + R$ 80 que sobrou` quando `rollover_cents > 0` — os dois já vêm prontos de
`budgets_status` (`0022`), e é isso que faz o número parar de parecer arbitrário.

### Criar e editar — `formSheet`, não bloco inline

O form sai do corpo da tela e vira `formSheet` com detent médio, Cancelar/Salvar próprios. Campos:

- **Categoria** — chips de `SUGGESTED_CATEGORIES` menos `INCOME_CATEGORIES` (orçamento de receita não
  existe). Em edição, fixa e não editável: a identidade do orçamento é `(workspace_id, category)`.
- **Limite** — `MoneyInput`, sempre `amount_cents`. Em edição o valor pré-carregado é o
  `base_limit_cents`, **não** o `limit_cents` (que já inclui o rollover) — `budgets.tsx:72` acerta
  isso hoje e é fácil de quebrar.
- **Escopo** — `Todo mês` / `Só este mês`, segmented. Não chip com emoji `📅` (`budgets.tsx:212`).
  Legenda: *"Só este mês sobrescreve o limite padrão em agosto e não mexe nos outros."*
- **Acumular sobra** — `Switch` nativo. Legenda que muda com o estado, e que precisa dizer a regra
  inteira: *"O que sobrar de julho soma no limite de agosto. Um mês só — sobra de junho não empilha.
  E vale a partir do primeiro mês inteiro depois de você criar o orçamento."* A última frase é a
  `0032`: o limite padrão só conta como sobra do mês anterior se `created_at` for **anterior** ao
  início do mês corrente, senão um orçamento criado hoje ganharia sobra de um mês em que não existia
  (era o bug de "lazer 500" criado hoje virar 1000 em agosto).

Salvar é sempre a RPC `save_budget` (`0031`), nunca `.upsert()`: os dois unique de `budgets` são
**parciais** (`where month is null` e `where month is not null`, porque no Postgres NULL não colide
com NULL) e o PostgREST não tem como mandar o predicado no `ON CONFLICT` — todo upsert morria com
`42P10` e a tela só dizia "Não deu para salvar".

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Destaque + linhas | `useBudgetsStatus(mês)` | `['budgets-status', 'YYYY-MM-01']` | RPC `budgets_status(ref_month)` | `transactions`, `budgets` |
| Identidade da linha (id, month) | `useBudgets()` | `['budgets']` | tabela `budgets` | `budgets` |
| "Sem limite definido" | `useTransactionsSummary(mês)` | `['tx-summary', from, to]` | RPC `transactions_summary` | `transactions` |
| Salvar | `useSaveBudget()` | — | RPC `save_budget` | — |
| Remover | `useDeleteBudget()` | — | `delete from budgets` | — |

`useBudgetsStatus` devolve `category, limit_cents, spent_cents, base_limit_cents, rollover_cents,
rollover, month` — tudo que a linha precisa, exceto o `id` para apagar, que vem de `useBudgets`.

⚠️ **`useBudgets` precisa passar a selecionar `month` (novo).** Hoje o select é
`'id, category, limit_cents'` (`use-finance.ts:270`) e `confirmDelete` pega **a primeira linha com
aquela categoria** (`budgets.tsx:91`). Com um limite padrão *e* um override do mês na mesma
categoria — exatamente o que o "Só este mês" cria — dá para apagar o errado sem nenhum aviso.

## Ação primária

**Definir ou ajustar um limite.** Concretamente: abrir o sheet, mexer no valor, salvar. Tudo o mais
na tela existe para o usuário decidir *qual* limite mexer.

## Ações secundárias

- **Context menu nativo** na linha (`Link.Menu`, nunca `onLongPress` + `Alert` como em
  `budgets.tsx:147`): Editar limite · Ver lançamentos · Remover.
- **Remover é action sheet nativo com duas opções distintas** quando a categoria tem override e
  padrão: `Remover só o limite de agosto` · `Remover o limite padrão` · Cancelar. Uma opção só,
  como hoje, é uma aposta na sorte.
- Toque na linha → transações filtradas.
- Pull-to-refresh refaz as três queries.

## Estados

Por seção, sempre — a tela tem três queries e hoje o `isError` de uma só (`budgets.tsx:136`) fala
por todas, enquanto o de `useBudgets` não fala por nenhuma.

- **Loading** — `Skeleton` com a forma final: um bloco alto (destaque) + quatro linhas com barra.
  Nunca spinner de tela cheia.
- **Empty (nunca teve orçamento)** — `EmptyState`, ícone `chart.bar.doc.horizontal`, título
  *"Você ainda não tem limite nenhum"*, dica: *"Comece pelo que mais aperta: mercado. Toque em + e
  defina quanto quer gastar por mês."* Se houver gasto no mês, a seção "Sem limite definido" aparece
  **junto** com o empty e pré-preenche a categoria mais cara — é o caminho mais curto para o primeiro
  orçamento.
- **Empty (mês futuro sem override)** — texto diferente, porque a causa é outra: *"Setembro ainda usa
  seus limites padrão. Toque em + para sobrescrever só este mês."*
- **Erro do status** — inline, no lugar da lista: *"Não deu para carregar os orçamentos."* +
  "Tentar de novo".
- **Erro do `useBudgets`** — a lista aparece normalmente, mas o menu de item entra em modo degradado:
  Editar continua, Remover fica desabilitado com a explicação *"Recarregue para poder remover"*.
  Silenciar isso é o que hoje permite apagar o orçamento errado.
- **Falha ao salvar / remover** — toast persistente com o motivo e rollback visível. `save_budget`
  levanta exceção com mensagem própria (limite ≤ 0, categoria vazia, sem workspace); mostrar
  "Não deu para salvar. Tenta de novo." para os três, como hoje (`budgets.tsx:243`), esconde o que o
  banco já explicou.
- **Conteúdo longo** — nome de categoria trunca em uma linha; valor e percentual nunca truncam.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Barra de progresso | mudança de estado | `withSpring(Motion.spring.settle)` no `width`; hoje é `View` com `%` fixo (`budgets.tsx:160`) e o valor salta |
| Valor do destaque | mudança de estado | conta de/para em `Motion.base` (~300 ms), `tabular-nums` segura a largura |
| Troca de mês | continuidade espacial | cross-fade do conteúdo em `Motion.fast` (~180 ms); o `MonthPicker` não se move |
| Entrada das linhas | continuidade | `FadeInDown`, stagger 60 ms, cap 400 ms (já é o padrão em `budgets.tsx:145`) |
| Linha cruzando 100% | mudança de estado | cor da barra vai para `danger` em `Motion.fast` + `notificationAsync(Warning)` — uma vez, quando cruza, nunca a cada render |
| Sheet de criar/editar | continuidade | `Motion.spring.sheet` (teve dedo envolvido) |
| Remover | feedback | linha sai com `LinearTransition` em `Motion.base`; toast "Limite removido" com Desfazer |

Barras animam; o texto do valor não se move enquanto o usuário lê.

## Acessibilidade

- Cada linha é um `accessibilityRole="button"` com label completo: *"Mercado, gastou 480 de 600
  reais, 80 por cento"* — a barra sozinha não comunica nada para leitor de tela.
- Estouro **nunca** só por cor: 100%+ ganha ícone `exclamationmark.triangle` e a palavra
  "estourou" no texto secundário.
- `MonthPicker` com label "Agosto de 2026" e hint "mês anterior" / "próximo mês" nas setas.
- Botão só-ícone do header com `accessibilityLabel="Novo orçamento"`.
- Alvos ≥ 44pt nas setas de mês (hoje o `hitSlop={12}` compensa um alvo pequeno; o alvo é que precisa
  crescer).
- Dynamic Type XL: a linha vira duas — categoria em cima, valores embaixo — em vez de truncar.
- Valores `selectable`.

## Fora de escopo

- **Histórico de limite.** Não guardamos o limite que valia em julho; a `0032` já assume o limite
  atual como aproximação e só quando ele é anterior ao mês. Desenhar um gráfico de "evolução do
  limite" seria inventar dado.
- **Rollover de mais de um nível.** Decisão de domínio (`0022`): acumular indefinidamente vira um
  número que ninguém consegue explicar.
- **Orçamento de receita.** `INCOME_CATEGORIES` fica fora do seletor de propósito.
- **Orçamento por conta ou por membro do workspace.** O escopo do dado é o workspace inteiro.
- Sugerir limite automático a partir da média dos meses anteriores — boa ideia, fase futura, e exige
  dado histórico que a maioria dos usuários novos não tem.
