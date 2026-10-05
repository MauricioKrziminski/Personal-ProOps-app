# F15 — explicar por que o gasto mudou

Estado: contrato do incremento, antes do código. Staging `utkqoiigimqzeenxkxdl`. Não declara
implementação nem testes.

## Lente (uma só, dita na tela)

**Gastos lançados por data** — parecida com a do bloco "Onde foi o dinheiro" da raiz do Financeiro
(`transactions_summary`, por `occurred_at`): `kind='expense'`, previsto incluído, sem
transferência, sem `pays_invoice_id`, sem o principal adiado de fatura
(`rollover_of_invoice_id`). Diferente da rosca, ela EXCLUI o principal de fatura adiada e separa "Sem categoria" de "outros": em mês com adiamento o total pode diferir da rosca, e a tela diz o total dela. Os dois períodos são as janelas que a tela já resolveu
(`range` e `previousRange`, régua Mês/Ciclo da tela) e chegam **resolvidas** (`from`/`to`),
nunca recortadas de novo. O "+X% vs <mês>" do painel do topo é outra lente (caixa) e NÃO é a
entrada desta explicação.

Receita, transferência, aporte e crédito/estorno não reduzem gasto nesta lente; a tela diz isso
numa linha de rodapé ("Créditos e estornos aparecem em Entradas e não descontam daqui").

## Comportamento

No bloco "Onde foi o dinheiro", uma ação **Por que mudou?** abre `/finance/why` (rota de
detalhe, não uma segunda home) com:

- Topo: gasto do período atual, do anterior e a diferença (absoluta e, só com anterior > 0, em
  %; anterior 0 → "sem gasto em <mês>", percentual indisponível).
- `Segmented` da dimensão: **Categoria | Detalhe | Pagamento | Tipo** (subcategoria; forma de
  pagamento do F01; classificação fixa/variável do F06). A essencialidade fica dentro de Tipo
  como segunda leitura ("Essencial | Não essencial") — no máximo 4 segmentos.
- Lista de contribuições ordenada por |diferença|: rótulo, antes → depois, diferença com sinal
  e uma barra proporcional. Inclui **Sem categoria / Sem detalhe / Não informado**. A soma das
  diferenças fecha a diferença do topo **no centavo**; linhas com diferença 0 só aparecem em
  "Ver todas".
- Tocar numa linha abre Lançamentos filtrado por aquela dimensão em cada período ("Ver em
  setembro" / "Ver em outubro"), com `from`/`to` exatos — o total da lista bate com o número
  da linha.

Sem IA e sem frase causal: "contribuiu para a diferença", nunca "você gastou mais porque…".

## Regras

- Agregação no servidor; os itens são os da lista de Lançamentos (paginada como hoje).
- Item que mudou de categoria entre os períodos conta pela categoria ATUAL nos dois lados (a
  lente lê o registro como ele é hoje) — dito na ajuda.
- Período inválido (from > to, mais de 400 dias) recusado.

## Persistência / RPC

Sem tabela. Migration `<ts>_spending_change.sql`:

```ts
// public.spending_change(p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date,
//                        p_dimension text) returns jsonb
// dimension: 'category' | 'subcategory' | 'payment_method' | 'pattern' | 'necessity'
// → { current_cents, previous_cents, delta_cents, percent_bp | null,
//     rows: [{ key | null, label, current_cents, previous_cents, delta_cents }] }  // dinheiro em string
```

Invoker com a query inline por `private.my_workspace_ids()` (padrão do wrapper de agregação),
`search_path` explícito, revoke public/anon.

`/finance/transactions` passa a aceitar `from`/`to` (ISO) além de `month`, e o filtro de cada
dimensão (já existentes: `category`, `subcategoryId` com `none`, `paymentMethods`,
`expensePatterns`, `expenseNecessities`), garantindo o "sem X".

## Cliente

`src/lib/spending-change.ts` (+ teste): ordenação, percentual, rótulos, montagem do link por
linha. `src/hooks/use-spending-change.ts`. Rota `src/app/finance/why.tsx` com `Screen`, `Row`,
barras com `View` (como as barras existentes), `Segmented`, `EmptyState`/`ErrorState`. Link
"Por que mudou?" no bloco de categorias da raiz do Financeiro.

## Aceite (matriz)

Período anterior zero e sem dados; estorno/crédito (não desconta); item que mudou de categoria;
sem categoria / sem detalhe / não informado; filtros cruzados no link; régua de ciclo e de mês;
soma das contribuições = diferença no centavo nas 5 dimensões; tocar abre o conjunto correto
(total da lista = número da linha). Nativo nos dois sistemas, claro/escuro, fonte grande,
ocultar valores, Reduzir movimento.
