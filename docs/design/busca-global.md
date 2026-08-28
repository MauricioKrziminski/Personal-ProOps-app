# Busca — `src/app/(tabs)/today/search.tsx` *(tela nova)*

**Não existe hoje.** O app tem 100 notas com `limit(100)` (`src/hooks/use-items.ts:58`), 100
lembretes (`:76`), e uma tela de transações com filtros por período e categoria — e nenhum campo
onde escrever uma palavra. Quem anotou "senha do wifi da casa da praia" há três meses não tem como
achar. Quem lembra que gastou "uns 300 no pneu" só tem o extrato do mês, se acertar o mês.

Isto é a busca que **atravessa** notas, transações e lembretes. A busca dentro das Notas continua
existindo, escopada, no `<Stack.SearchBar>` da própria aba (`docs/design/notas.md`) — são coisas
diferentes: lá é filtrar uma lista, aqui é achar uma coisa sem saber onde ela está.

## Onde ela entra (e por quê)

**Rota própria dentro da pilha da aba Hoje**, aberta pelo botão `magnifyingglass` no header:

```
(tabs)/today/_layout.tsx   → <Stack>
(tabs)/today/index.tsx     → /today
(tabs)/today/search.tsx    → /today/search   ← esta tela
```

O header dela tem `<Stack.SearchBar autoFocus>` — busca nativa, como manda o `design.md §8`.

Três alternativas foram consideradas e descartadas:

| Alternativa | Por que não |
|---|---|
| Modal `/search` no Stack raiz | Modal é para tarefa com começo e fim. Busca é navegação: o resultado leva a outro lugar, e voltar tem que voltar para o resultado, não fechar a tarefa. |
| `<Stack.SearchBar>` na própria `/today` | Transformaria a tela de "o que preciso saber agora" num modo de busca. Hoje é a tela de cold start e a única com resposta em três segundos — ela não pode ter dois estados. |
| Uma aba "Buscar" | Quinta aba para uma ação ocasional. As quatro abas estão decididas. |

Ficar na pilha da aba Hoje é a escolha certa porque **Hoje é onde o cold start cai** e porque a
busca cruza domínios — ela não pertence a Notas mais do que a Financeiro. A tab bar continua
visível, o back volta para Hoje, e o re-tap na aba volta à raiz.

Resultado de outro domínio navega para a aba dele (`/notes/[id]`, `/finance/transactions`,
`modal /reminder-form?id=`) — o expo-router troca de aba e empilha lá. É o comportamento certo:
depois de achar a nota, o usuário está **em Notas**, não numa cópia da nota dentro de Hoje.

## Pergunta que responde

> "Onde está aquilo?"

Sem que o usuário precise lembrar **em que parte do app** aquilo virou.

## Persona

- **Primária: Marina, 26** — segundo cérebro. 300 notas em seis meses; sem busca, nota antiga é
  nota morta. Ela busca em português, com acento errado e no plural.
- **Secundária: Camila, 34** — "quanto eu gastei com aquele curso?" A memória dela é do
  estabelecimento, não do mês nem da categoria.
- **Terciária: Jorge, 46** — "eu criei um lembrete pro IPVA ou não criei?" Buscar é como ele
  confere se pediu.

## O que a busca alcança de verdade (e o que ela não alcança)

Ser honesto aqui é o que impede a tela de prometer o que o banco não entrega:

| Domínio | Como | Ceiling |
|---|---|---|
| **Notas** | `search_tsv` gerado, config `pt_unaccent` (`portuguese` + `unaccent`) + GIN, migration `0038` | Busca de verdade: "reunioes" acha "reunião". `toTsQuery` (`src/lib/search.ts`) põe `:*` no último termo → busca enquanto digita |
| **Transações** | `ilike` em `description`, `merchant`, `category` | **Sem índice full-text.** Sem stemming e **sem acento-insensibilidade**: "acai" não acha "açaí". Varre as linhas do workspace |
| **Lembretes** | `ilike` em `title` | Mesma limitação, volume irrisório (tabela de dezenas de linhas) |

**A tela não esconde isso.** No escopo "Lançamentos", o rodapé da seção diz, uma vez, em
`textSecondary`: *"Lançamento é buscado por texto exato — escreve como você escreveu."* É uma
linha, e ela evita a conclusão errada ("o app perdeu meu gasto") que um resultado vazio produz.

O custo do `ilike '%x%'` é linear no número de transações do workspace. Em finanças pessoais isso
é ordem de milhares de linhas, com RLS já cortando por `workspace_id` (índice
`transactions_ws_occurred_idx`, `0010_workspaces.sql:155`) — cabe. O teto conhecido e o caminho de
saída: `pg_trgm` com GIN sobre `lower(unaccent(description))`, que exige um wrapper `IMMUTABLE` de
`unaccent` e uma migration própria. **Não agora**: índice de busca para transação antes de existir
um usuário que reclame é otimização por antecipação.

Uma RPC única que faz `union all` dos três domínios com ranking foi considerada e recusada por
enquanto: ela transformaria três estados de erro independentes em um só (contra `design.md §7`) e
tiraria a possibilidade de a seção de notas aparecer instantânea enquanto a de transações ainda
roda.

## Entrada e saída

- **Entrada:** `push /today/search` pelo header da aba Hoje. Teclado abre junto — quem tocou na
  lupa quer digitar.
- **Saída:** nota → `/notes/[id]`; transação → `/finance/transactions?highlight=<id>`; lembrete →
  `modal /reminder-form?id=`.
- **Back:** pop para Hoje. Voltar de um resultado devolve **a busca com o texto e a rolagem
  intactos** — quem procura costuma abrir dois ou três candidatos antes de achar. Isso sai de
  graça mantendo o texto em estado da tela e o resultado no cache do TanStack Query.
- **O que o back faz:** nada escreve. Três `select` sob RLS, cada um com `limit`.

## Anatomia

1. **Header nativo com `<Stack.SearchBar autoFocus placeholder="Buscar em tudo">`** — nativo,
   com o Cancelar da plataforma. Nenhuma barra desenhada dentro do `ScrollView`.
2. **Chips de escopo** — `Tudo · Notas · Lançamentos · Lembretes`, fixos abaixo do header
   (reusa `src/components/finance/chip.tsx`). Cada chip mostra a contagem quando há resultado
   (`Notas 12`). Em "Tudo", o chip é o atalho para ver a lista inteira de um domínio.
3. **Resultados** (`FlashList`), agrupados por domínio com cabeçalho de seção. Em "Tudo": **até 5
   por domínio**, com "Ver todos os 23" no fim de cada seção. Um domínio com muitos resultados não
   pode empurrar os outros dois para fora da tela — é exatamente isso que faz busca global parecer
   quebrada.
   - **Nota**: primeira linha como título, prévia de uma linha, pasta e `via WhatsApp`.
   - **Lançamento**: descrição, valor com `tabular-nums` **à direita**, data e categoria. Valor à
     direita porque é o que o olho procura numa lista de dinheiro.
   - **Lembrete**: título, próximo disparo, recorrência via `describeRRule`, e "pausado" quando
     `active = false`.
4. **Ordem das seções em "Tudo": Notas → Lançamentos → Lembretes.** Não é alfabética: é a ordem de
   probabilidade. Busca por texto livre é comportamento de segundo cérebro; dinheiro tem uma tela
   própria com filtros, e lembrete se acha pela aba Hoje.
5. **Sem card de destaque.** Esta tela não tem um número que responda a nada — o único glass é a
   chrome (header e tab bar). Uma tela de busca com um `GlassCard` de resumo seria decoração.

## Dados

`src/hooks/use-search.ts` **(arquivo novo)**.

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Notas | `useSearchNotes(q)` **(novo)** | `['search','notes',q]` | `notes`, `.textSearch('search_tsv', toTsQuery(q), { config: 'pt_unaccent' })`, `deleted_at is null`, `limit 30` | — |
| Lançamentos | `useSearchTransactions(q)` **(novo)** | `['search','transactions',q]` | `transactions`, `.or('description.ilike.%q%,merchant.ilike.%q%,category.ilike.%q%')`, `order occurred_at desc`, `limit 30` | — |
| Lembretes | `useSearchReminders(q)` **(novo)** | `['search','reminders',q]` | `reminders`, `title.ilike`, `limit 30` | — |

**Três queries, três estados.** Montadas com `useQueries` e renderizadas por seção: notas
resolvendo em 40 ms e transações em 400 ms significa notas na tela em 40 ms. Falha em transações
mostra erro **naquela seção** e não apaga as outras duas — a regra do `design.md §7` é literal
aqui, e esta é a tela onde ela mais aparece.

- `enabled: q.trim().length >= 2` nos três. Uma letra devolve o app inteiro.
- Debounce de **250 ms** no texto, com `keepPreviousData` — a lista não pisca entre teclas.
- `toTsQuery` já é o helper de `src/lib/search.ts` previsto em `docs/design/notas.md`, com
  `src/lib/search.test.ts`. Nada novo: a busca de notas e a busca global usam a **mesma** função,
  senão as duas divergem em um mês.
- **Sem realtime.** Resultado de busca é um retrato; invalidar a cada mensagem que chega do
  WhatsApp reordenaria a lista embaixo do dedo de quem está lendo. Reconsultar acontece ao mudar
  o texto ou o escopo.
- Escopo não é `queryKey`: trocar de chip **filtra o que já foi buscado**, sem rede. Ir de "Tudo"
  para "Notas" é instantâneo por construção.
- Notas na lixeira ficam de fora (`deleted_at is null`); o empty de busca oferece procurar lá,
  como já previsto em `notas.md`.

## Ação primária

**Abrir o resultado certo.** O sucesso é medido em quantos toques da lupa até o item — e o alvo é
dois: digitar, tocar.

## Ações secundárias

- Trocar escopo.
- Context menu nativo no resultado, com as ações do domínio (nota: fixar, mover, lixeira;
  lançamento: editar, mudar categoria; lembrete: pausar, editar). **As mesmas ações das listas de
  origem** — item que se comporta diferente dependendo de onde apareceu é item que ninguém confia.
- "Ver todos" por seção.
- Buscar na lixeira, a partir do empty.

## Estados

- **Estado inicial (nada digitado)** — **não é um empty state**: é a tela em repouso. Sem ilustração,
  sem "comece a digitar". Fundo limpo com os chips de escopo. Quem chegou aqui já sabe o que fazer,
  o teclado está aberto e o cursor está piscando.
- **Loading** — `Skeleton` na forma da linha do domínio (três por seção), **por seção**, entrando
  conforme cada query resolve.
- **Empty — nunca teve nada** (`q` válido, e o usuário não tem nem notas nem transações nem
  lembretes): ícone `sparkles`, *"Ainda não tem nada para achar"*, dica acionável: *"Manda `gastei
  45 no mercado` ou `anota: senha do wifi` no WhatsApp — depois é só procurar aqui."*
- **Empty — busca sem resultado** (tem dado, a busca não achou): ícone `magnifyingglass`,
  *"Nada encontrado para «pneu»"*, e três saídas concretas, não um parágrafo:
  *"Tenta outra palavra · Procurar na lixeira · Ver todos os lançamentos"*.
  Dizer "ainda não tem nada" para quem tem 300 notas é mentira, e é o erro de empty mais comum.
- **Empty de uma seção só** — a seção **não some**: ela aparece com uma linha discreta
  (*"nenhum lançamento"*). Sumir sugeriria que aquele domínio não foi consultado, e é a diferença
  entre "não achei" e "não procurei".
- **Error** — inline, por seção, com "Tentar de novo" que refaz **só** aquela query.
- **Conteúdo longo** — título de nota em uma linha, prévia em uma; descrição de lançamento trunca;
  **valor nunca trunca**.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Abertura da tela | continuidade espacial | `push` nativo do Stack. Teclado sobe junto, sem atraso artificial |
| Resultados chegando | mudança de estado | cross-fade do bloco da seção em `Motion.fast` (120 ms). **Nada de `FadeInDown` com stagger aqui**: o texto está sendo lido enquanto muda a cada tecla, e movimento em lista que se refaz sozinha vira tremor |
| Troca de escopo | mudança de estado | `LinearTransition` nas seções em `Motion.base`; haptic `selectionAsync` |
| Press no resultado | feedback | highlight de fundo (não scale), 120 ms |
| Skeleton → conteúdo | continuidade | cross-fade 120 ms, mesma altura de linha, para a lista não pular |
| Cancelar a busca | continuidade | a barra nativa cuida; nada custom |

Regra dura desta tela: **nada anima por causa de uma tecla.** Só a troca de escopo e a chegada
de uma seção inteira têm movimento.

## Acessibilidade

- Barra de busca nativa → `accessibilityLabel` e comportamento de teclado vêm da plataforma.
- Contagem de resultados anunciada uma vez, com debounce, via `accessibilityLiveRegion="polite"`:
  *"12 resultados"*. Anunciar a cada tecla é insuportável no VoiceOver.
- Cabeçalho de seção com `accessibilityRole="header"` — é assim que se pula de domínio em domínio
  sem ouvir 30 linhas.
- Linha de resultado com label composto que **inclui o domínio**: *"Nota: senha do wifi"*,
  *"Lançamento: pneu, trezentos reais, 12 de junho"*. Fora de contexto visual, o agrupamento
  desaparece; o label é o que devolve.
- Alvos ≥ 44pt, inclusive nos chips de escopo.
- Dynamic Type XL: a prévia cai para uma linha e o valor desce para a linha de baixo, alinhado à
  esquerda, em vez de truncar.
- Nada de destaque só por cor no trecho que casou (o realce de termo é um upgrade futuro; se
  entrar, vem com peso, não só cor).

## Fora de escopo

Ranking por relevância entre domínios (exigiria a RPC única e `ts_rank`; a ordem hoje é
recência dentro de cada domínio, e a agrupada é opinião do produto) · realce do termo encontrado ·
histórico de buscas recentes (guardar o que a pessoa procurou é dado sensível para ganho pequeno) ·
buscas salvas · busca por valor ou faixa de valor ("gastos acima de 300" é filtro, mora em
`/finance/transactions`) · busca dentro de metas, dívidas, contas e cartões (são poucos itens e
todos cabem numa tela) · `pg_trgm` em transações · busca offline · busca por voz.
