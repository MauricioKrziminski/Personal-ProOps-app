# Faturas do cartão — `src/app/(tabs)/finance/accounts/[id]/invoices.tsx`

**Tela nova, e um beco sem saída hoje.** Não existe caminho nenhum para uma fatura passada. A
única porta para `/finance/invoice/[id]` é o toque em Cartões (`cards.tsx:60-69`), que usa
`card.invoice_id` — e `card_summary()` devolve **só a fatura não-paga mais antiga** por cartão
(CTE `aberta`, `0013_cards_and_installments.sql:411-417`: `distinct on (ci.account_id) … where
ci.status <> 'paid' order by ci.account_id, ci.reference_month`).

Ou seja: **no instante em que o usuário paga a fatura, ela some do app para sempre.** A linha
continua em `card_invoices` com `status='paid'`, `paid_at` e `payment_transaction_id`
(`0013:97-99`), as compras continuam em `transactions` com aquele `invoice_id` — e nada nem
ninguém consegue abrir. É o dado mais bem guardado e menos acessível do produto.

## Pergunta que responde

> "Quanto eu paguei de cartão nos últimos meses — e onde está aquela compra?"

Duas leituras: a **série** (a fatura está subindo?) e o **arquivo** (achar a compra de abril).

## Persona

- **Primária: Jorge, 46** — "a fatura está sempre maior". Ele precisa ver os últimos seis meses
  lado a lado para saber se é impressão ou não.
- **Secundária: Camila, 34** — quer conferir se aquela cobrança recorrente entrou de novo, e em
  qual fatura.
- **Terciária: qualquer um em fim de ano** — juntar comprovante. Complementa Relatórios, que
  agrega por categoria e não por fatura.

## Entrada e saída

- **Entrada:** context menu do cartão em Cartões; menu do header da Fatura; `Row` "Faturas
  anteriores" em `conta-detalhe` do cartão.
- **Saída:** linha → `push /finance/invoice/[id]` (a mesma tela de `fatura.md`, que já lida com
  `status='paid'`); a barra do gráfico é o mesmo alvo que a linha.
- **Back:** pop. Nada muda de estado aqui — é uma tela de leitura pura.

> **28/08/2026** — com uma fatura só, a tela era três parágrafos cinzas soltos. A explicação
> virou `Card` ("Só uma fatura até agora"), o mesmo tratamento de "A curva ainda não tem
> história" em Patrimônio, e o nome do cartão no topo só aparece quando há mais de um para
> desambiguar.

## Anatomia

1. **Header nativo** — large title "Faturas", subtítulo com o nome do cartão.
2. **Card de destaque (o único `GlassCard`) — a série**
   Gráfico de barras dos últimos 12 meses de fatura, em `@shopify/react-native-skia`, com a média
   como linha de referência e o mês corrente destacado. Abaixo: *"média de R$ 1.180 nos últimos 6
   meses"*.
   *É o card porque é a única leitura que a lista sozinha não dá.* Doze números em coluna não
   respondem "está subindo?"; doze barras respondem em um segundo.
   Toque numa barra rola a lista até aquele mês (não navega — navegar de um gráfico é surpresa).
3. **Lista de faturas** — uma `Row` por mês, `reference_month desc`:
   `Agosto de 2026 · R$ 1.230 · Paga em 05/09`, com o estado como texto
   (`Aberta` · `Fechada` · `Paga` · `Atrasada`) e o valor com `tabular-nums`.
   Fatura **não paga e vencida** vem marcada em `danger` com a palavra "Atrasada" — e é a única
   linha desta tela que pede ação.
4. **Rodapé** — *"Faturas começam a aparecer aqui quando a primeira compra cai no cartão."*
   Uma linha, explicando por que o histórico começa onde começa.

Sem filtros, sem busca, sem seletor de período. Doze linhas cabem numa tela e meia; filtro em
lista curta é ruído. Busca por compra é de `/finance/transactions`.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Série + lista | `useCardInvoices(accountId, months)` **(novo)** | `['card-invoices', accountId, months]` | RPC `card_invoice_history` **(novo)** | `card_invoices`, `transactions` |
| Nome do cartão | `useAccounts()` (`use-finance.ts:211`) | `['accounts']` | tabela `accounts` | `accounts` |

### A RPC que falta

**Não dá para ser um `select` direto em `card_invoices`.** A tabela guarda só o ciclo — o total
**nunca é materializado** (`0013:5-7`) e sai de `sum(transactions.amount_cents) where invoice_id
= … and kind='expense'`. Um `select` na tabela devolveria doze faturas sem valor nenhum, e somar
no cliente seria doze queries ou uma query de todas as transações do cartão desde sempre.

```
card_invoice_history(p_account_id uuid, p_months int default 12)
  → (invoice_id, reference_month, closing_date, due_date, status, paid_at,
     total_cents, tx_count)
```

Convenções obrigatórias (`.claude/rules/supabase.md`):

- **Só o wrapper**, `security invoker`, com a query inline filtrando
  `workspace_id in (select private.my_workspace_ids())` — o padrão duplo interna/wrapper existe
  para agregação que as Edge Functions também consomem, e nenhuma consome esta. Se um dia o
  WhatsApp responder "quanto foi a fatura de junho?", aí entra `_card_invoice_history(uid, …)` no
  par completo.
- `left join` nas transações: fatura criada pelo trigger e depois esvaziada existe com total 0 e
  precisa aparecer.
- `set search_path = public`.
- `order by reference_month desc`, `limit` derivado de `p_months` (clamp 1..60, como
  `net_worth_series` faz em `0026_net_worth.sql:211`).
- Índice já existe: `card_invoices_ws_idx (workspace_id, due_date)` e
  `transactions_invoice_idx (invoice_id)` (`0013:104`, `:155`).

`card_invoices` já está na publicação realtime (`0013:437-440`), então a lista se atualiza
sozinha quando o `finance-scheduler` fecha uma fatura.

**`card_summary()` não muda.** Ela responde "qual fatura eu pago agora" e está certa assim;
histórico é outra pergunta e outra query.

## Ação primária

**Abrir a fatura de um mês.** É uma tela de índice: o sucesso é o usuário sair dela rápido, na
fatura certa.

## Ações secundárias

- Toque na barra do gráfico → rola até o mês.
- Context menu na linha: Ver fatura · Ver a transferência de pagamento (quando
  `payment_transaction_id` existe, `0013:99`) — o link que hoje não existe entre a fatura paga e
  o lançamento que a pagou.
- Nenhuma ação destrutiva. Não se apaga fatura: ela é consequência das compras.

## Estados

- **Loading** — `Skeleton` com a forma: bloco de gráfico + seis linhas.
- **Empty: cartão sem nenhuma fatura** — `EmptyState` ícone `calendar`, "Nenhuma fatura ainda",
  dica: *"A primeira fatura nasce junto com a primeira compra no cartão — manda `almocei 40 no
  Nubank` no WhatsApp."*
- **Empty diferente: só existe a fatura atual** — a lista mostra a linha única e o **gráfico não
  aparece**, com uma linha no lugar: *"Comparação aparece a partir do segundo mês."* Gráfico de
  uma barra é decoração, e sumir sem explicação é o erro que `patrimonio.md` documenta.
- **Error** — inline, com "Tentar de novo". Uma query só.
- **Conteúdo longo** — 60 meses: `FlatList`, cabeçalho por ano.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Barras entrando | continuidade | crescem da base com `withSpring(Motion.spring.settle)`, stagger 40 ms, cap 400 ms |
| Barra selecionada | feedback | opacidade das outras cai para 0.5 em `Motion.fast` (~150 ms); haptic `selectionAsync` |
| Rolagem até o mês | continuidade espacial | `scrollToIndex` animado, `Motion.base` |
| Entrada das linhas | continuidade | `FadeInDown`, stagger 40 ms |
| Press em `Row` | feedback | highlight de fundo, 120 ms |

Nada mais. É uma tela de arquivo.

## Acessibilidade

- **O gráfico não é a única forma de ler a série.** A lista abaixo tem os mesmos doze valores em
  texto — o gráfico é `accessibilityRole="image"` com um resumo ("fatura entre 890 e 1.560 reais
  nos últimos 12 meses, média 1.180") e cada barra individual fica fora do foco.
- `Row` com label completa: "Agosto de 2026, mil duzentos e trinta reais, paga em cinco de
  setembro".
- "Atrasada" com palavra e ícone, nunca só cor.
- `tabular-nums` em todo valor e `selectable`.
- Dynamic Type XL: a `Row` quebra em duas linhas; o gráfico ganha altura mínima fixa e não
  encolhe o rótulo.

## Fora de escopo

- **Comparar dois cartões no mesmo gráfico.** A tela é de um cartão; comparação entre cartões é
  do Financeiro.
- **Exportar PDF da fatura.** Relatórios, e exigiria renderização própria.
- **Editar fatura passada.** As compras se editam individualmente, na fatura; o ciclo é do banco.
- **Desfazer pagamento** — registrado como pendência em `fatura.md`; o dado (`payment_transaction_id`)
  já existe, a RPC não.
