# Lançamentos — `src/app/(tabs)/finance/transactions.tsx`

Hoje a tela é `src/app/finance/transactions.tsx` (282 linhas), registrada no **Stack raiz**
(`src/app/_layout.tsx:25`) — entrar nela faz a tab bar sumir. Ela desenha o próprio cabeçalho
(`ScreenHeader`, linha 109), tem um navegador de mês que é cópia literal do de `budgets.tsx`
(`transactions.tsx:32-41` e `budgets.tsx:27-36` são a mesma função, com estilos diferentes), cinco
chips com emoji (linhas 136-144) e **uma `GlassCard` por linha de lista** (linha 56) — vinte glass
na mesma tela. Os dados vêm de `useTransactions({ month, kind })`, que puxa o mês inteiro em
`.limit(200)` (`use-finance.ts:146`) e nunca pagina; o filtro "Previstos" nem chega ao banco, é
`.filter()` em memória (linhas 93-96); e os totais do topo são `reduce` no cliente (linhas 98-104),
que a `finance.md` proíbe e que passa a mentir assim que existir paginação.

Colunas que já vêm no `select` e a UI ignora: `merchant`, `due_at`, `invoice_id`
(`use-finance.ts:122-123`). E duas que **nem estão no select**, embora existam no banco:
`recurring_id` (`0014_forecast.sql:32`) e `debt_id` (`0023_debts.sql:39`).

## Pergunta que responde

> "Cadê aquele lançamento — e o que realmente entrou e saiu neste mês?"

## Persona

- **Primária: Camila, 34** — audita o mês. Quer procurar por "uber", ver por dia, e conferir se a
  categoria está certa.
- **Secundária: o casal** — workspace compartilhado. "Quem lançou isso?" é pergunta de rotina, e
  hoje a tela não tem resposta: `user_id` é o autor do lançamento e **não sai no select**
  (`use-finance.ts:122-123`).
- **Terciária: Rafa, 29** — mandou áudio, quer confirmar que virou o valor certo.

## Entrada e saída

- **Entrada:** Financeiro → "Todos os lançamentos"; toque numa categoria do bloco "Onde o dinheiro
  foi" (chega com `category` pré-aplicada); toque em "ver todos" de "Últimos lançamentos".
- **Saída:**
  - linha → `push /finance/transactions/[id]` (**detalhe**, tela nova — ver `transacao-detalhe.md`).
    Hoje a linha abre direto o form de edição (`transactions.tsx:54`), o que faz o usuário editar
    para *ler*.
  - FAB → `modal /finance/transaction-form` (Stack raiz, continua fora das abas).
- **Back:** pop dentro da pilha do Financeiro. A tab bar **fica**.

## Anatomia

1. **Header nativo** — large title "Lançamentos", colapso no scroll, e **`<Stack.SearchBar>`**
   (busca em `description`, `merchant` e `category`). A busca nativa só existe depois da migração
   para a pilha da aba: no Stack raiz atual não há header de navegador para pendurá-la.
2. **Navegador de mês** — o **mesmo componente** usado por `budgets.tsx` e pelo Financeiro. Uma
   implementação, um visual, um `accessibilityLabel`. As duas de hoje são dívida, não escolha.
3. **Card de destaque (o único `GlassCard` da tela) — "Entrou · Saiu · Sobra"** do mês selecionado.
   Vem de `transactions_summary`, **não** do `reduce` local: o número precisa ser do mês inteiro,
   não do que a paginação já baixou.
4. **Faixa de filtros** — chips **sem emoji**: `Tudo · Gastos · Receitas · Transferências ·
   Previstos · Pessoa`. "Previstos" passa a ser filtro de query (`status='pending'`), não `.filter()`
   em memória. "Pessoa" é um chip que abre **menu nativo** com os membros do workspace.
5. **Lista agrupada por dia** — cabeçalho de seção *sticky*: `sáb, 23 de agosto · −R$ 218,40`.
   Agrupar é o que transforma 60 linhas soltas num extrato legível, e é de graça: os dados já vêm
   ordenados por `occurred_at desc, created_at desc` (`use-finance.ts:144-145`).
6. **Linha (`Row`, opaca)** — ícone SF por `kind` (`arrow.down.left` / `arrow.up.right` /
   `arrow.left.arrow.right`), título `description || merchant || category`, subtítulo
   `categoria · conta · origem`, valor à direita com `tabular-nums`. Badges discretas quando houver:
   **"Previsto · vence 05/09"** (`status`/`due_at`), **"3/10"** (`installment_no`), **"Fatura"**
   (`invoice_id`), **"Recorrente"** (`recurring_id`), **"Dívida"** (`debt_id`).
7. **Rodapé de paginação** — `useInfiniteQuery`, 50 por página. Sem "carregar mais" manual: o
   `onEndReached` do `FlashList` resolve.

**Por que nesta ordem:** o usuário chega com uma pergunta de escopo (mês, tipo, pessoa) e uma de
busca (texto). Filtro antes da lista, total antes do filtro — porque o total é o que diz se vale a
pena filtrar.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Entrou/Saiu | `useTransactionsSummary(from, to)` | `['tx-summary', from, to]` | RPC `transactions_summary` | `transactions` |
| Lista | `useInfiniteTransactions(filtros)` **(novo)** | `['transactions', mês, kind, category, status, autor, busca]` | tabela `transactions` | `transactions` |
| Filtro Pessoa | `useWorkspaceMembers()` **(novo)** | `['workspace-members']` | RPC `workspace_members_list` **(nova migration)** | — |

`useInfiniteTransactions` substitui `useTransactions` nesta tela: mesma `queryKey` de prefixo
`['transactions', …]` (para o `useRealtimeInvalidate` de `use-finance.ts:134` continuar valendo),
`.range()` por página de 50, e `status` / `user_id` / busca como filtros **de query**.
`TRANSACTION_COLUMNS` (`use-finance.ts:122-123`) precisa ganhar `user_id`, `recurring_id` e
`debt_id`.

**O filtro por pessoa funciona; o rótulo não.** `transactions` é escopada por workspace, então
`eq('user_id', x)` já devolve as linhas do parceiro. Mas `profiles` tem RLS *own row*
(`0001_init.sql:23`) e **não tem coluna de nome** — só `phone`. Ou seja: sem uma RPC nova que
exponha os membros do workspace, o app sabe filtrar por pessoa e não sabe como chamá-la. Enquanto a
RPC não existir, o chip mostra **"Eu" / "Outra pessoa"**, que é honesto, e não um uuid.

## Ação primária

**Encontrar um lançamento.** Concretamente: busca nativa + agrupamento por dia. Tudo o mais na tela
existe para estreitar essa busca.

## Ações secundárias

- **Context menu nativo** (`Link.Menu`) na linha: Ver detalhe · Editar · Mudar categoria · Apagar.
  Apagar abre **action sheet** nativo. `onLongPress` + `Alert` está proibido.
- Linha `pending`: **"Paguei"** na própria linha (botão trailing), como na aba Hoje. Um toque.
- FAB → novo lançamento.
- Menu do header (`ellipsis.circle`): Importar extrato · Regras.

## Estados

- **Loading** — `Skeleton` com a forma final: barra de resumo alta + dois cabeçalhos de dia com
  três linhas cada. Nunca spinner de tela cheia; hoje o `LoadingCard` entra como
  `ListEmptyComponent` (linha 164), o que faz a lista "piscar vazia" a cada troca de mês.
- **Empty — nunca teve nada:** ícone `tray`, título *"Nenhum lançamento ainda"*, dica:
  *"Manda `gastei 45 no mercado` no WhatsApp — ou toca no + para lançar aqui."*
- **Empty — mês sem movimento:** *"Nada em setembro de 2026."* + botão **"Ver agosto"** (o mês
  anterior com dado). Sem repetir o onboarding para quem já usa o app.
- **Empty — filtro/busca sem resultado:** *"Nenhum lançamento com "uber" em setembro."* + botão
  **"Limpar filtros"**. Três empties diferentes porque são três problemas diferentes: um é
  onboarding, um é calendário, um é filtro.
- **Error** — `ErrorCard` inline com "Tentar de novo" (`refetch`). O resumo e a lista falham
  separado: resumo quebrado não pode esconder a lista.
- **Conteúdo longo** — descrição trunca em uma linha; **valor nunca trunca**; badge some antes da
  descrição quando o espaço aperta.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Troca de mês | continuidade espacial | cross-fade do conteúdo em `Motion.fast` (~180 ms); o valor do card conta de/para |
| Aplicar chip | mudança de estado | `LinearTransition` na lista, `Motion.fast`; haptic `selectionAsync` |
| Press na linha | feedback | highlight de fundo, 120 ms — **não** scale |
| Entrada da lista | continuidade | `FadeInDown`, stagger 40 ms, **cap 400 ms** (já é o que `transactions.tsx:50` faz) |
| Página seguinte | continuidade | itens novos entram sem animar; só o spinner de rodapé aparece |
| "Paguei" | feedback | linha some com `LinearTransition` `Motion.fast`; haptic `notificationAsync(Success)`; toast com desfazer |

Nova dependência: **`@shopify/flash-list`** (não está no `package.json`). É a lista que cresce sem
teto do app — `FlatList` com 12 meses de extrato é onde o scroll começa a engasgar.

## Acessibilidade

- `Row` com `accessibilityRole="button"` e label completo: *"Mercado Extra, 218 reais e 40 centavos,
  despesa, 23 de agosto, categoria mercado"*.
- Chips com `accessibilityState={{ selected }}` — hoje a seleção é só cor.
- Cabeçalho de dia é `accessibilityRole="header"`.
- Valores `selectable` e `tabular-nums`.
- Badge "Previsto" nunca comunica só por cor: tem ícone e palavra.
- Alvos ≥ 44pt, inclusive no botão "Paguei" e nas setas do mês.
- Dynamic Type XL: a faixa de chips rola horizontalmente em vez de quebrar em três fileiras.

## Fora de escopo

- Edição em lote (selecionar N e recategorizar): mora na tela de **Importação**, que já tem
  seleção múltipla.
- Exportar CSV/PDF: é assunto de **Relatórios**.
- Filtro por conta e por faixa de valor — só depois que a busca nativa estiver em campo; hoje seria
  chrome antes de necessidade.
- Gráfico dentro do extrato. Gráfico é o Financeiro; aqui é lista.
