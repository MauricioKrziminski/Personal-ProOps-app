# Conta (detalhe) — `src/app/(tabs)/finance/accounts/[id].tsx`

**Tela nova.** Hoje tocar numa conta abre o formulário de edição inline (`accounts.tsx:148` →
`:70-82`). Não existe nenhum caminho para "o que aconteceu nesta conta": `useTransactions`
filtra por mês, `kind` e `category` (`use-finance.ts:125-129`) e **não tem filtro de conta**.
Quem tem duas contas correntes não consegue, em lugar nenhum do app, responder "por que o saldo
do Itaú caiu".

A tela existe para fechar esse buraco — e **não** para virar um segundo `/finance/transactions`.

## Pergunta que responde

> "Por que o saldo desta conta está nesse número?"

Uma pergunta de **conferência**, não de navegação. O usuário chega com uma diferença em mãos
(o app diz X, o banco diz Y) e sai com a linha que explica a diferença — ou com a certeza de que
o app está certo.

## Persona

- **Primária: Camila, 34** — bate saldo. Ela não quer o mês inteiro: quer os últimos lançamentos
  daquela conta e o que ainda está `pending` (o que o banco ainda não viu).
- **Secundária: Jorge, 46** — abre a conta do **cartão** para ver a fatura atual sem passar por
  Cartões. Para ele esta tela é um atalho para `/finance/invoice/[id]`.
- **Casal** — a conta é compartilhada; a linha precisa dizer quem lançou quando os dois usam.

## O que entra, e o que é redundante com Transações

`/finance/transactions` já faz: navegação por mês (`transactions.tsx:87`), filtro por `kind`
(`:88`), filtro "só previstos" (`:90`), totais de entrada e saída do período (`:96-104`) e
toque na linha → edição. **Duplicar isso aqui seria manter duas telas de extrato.**

| Bloco | Entra? | Por quê |
|---|---|---|
| Saldo desta conta | **sim** | não existe em lugar nenhum hoje; é a resposta da tela |
| Como o saldo se forma (inicial + entradas − saídas) | **sim** | é o que explica a diferença com o banco; nenhuma tela mostra `initial_balance_cents` |
| Pendentes desta conta | **sim** | é a causa nº1 de "o app não bate com o banco" |
| Últimos ~15 lançamentos | **sim, cortado** | reconhecimento, não navegação — quem quer mais vai para Transações |
| Navegação mês a mês | **não** | é de Transações; aqui vira "Ver todos" com o filtro pré-aplicado |
| Chips de `kind` / categoria | **não** | filtro é de Transações |
| Totais do mês por conta | **não** | agregação de mês é do Financeiro |
| Ciclo e fatura (só cartão) | **sim** | o cartão é uma `accounts` (`0013:66-85`) e chega aqui pelo mesmo toque |
| Editar/arquivar a conta | **sim, no menu** | é onde o usuário procura, e tira o form do meio da lista de Contas |

A regra é: **esta tela reconhece, Transações investiga.** "Ver todos os lançamentos" faz
`push /finance/transactions?account=<id>` e a lista lá abre já filtrada.

O filtro de conta chega em Transações **como parâmetro de rota, não como chip na barra de
filtros** — é o mesmo mecanismo com que uma categoria do Financeiro já abre o extrato filtrado
(`financeiro.md`), e não contradiz `transacoes.md`, que deixa o *chip* de conta fora de escopo.
Quando o filtro vem por deep link, Transações mostra uma faixa "Filtrando por Itaú · limpar";
sem parâmetro, nada muda por lá.

## Entrada e saída

- **Entrada:** `push` da `Row` em Contas; da linha "Cartões" do Financeiro; deep link de alerta.
- **Saída:**
  - "Ver todos" → `push /finance/transactions?account=<id>`
  - lançamento → `modal /finance/transaction-form?id=`
  - (cartão) card da fatura → `push /finance/invoice/[id]`
  - menu → `modal /finance/account-form?id=`
- **Back:** pop para Contas. Arquivar a conta faz `router.back()` **depois** do sucesso da
  mutation, nunca antes — sair de uma tela cujo delete falhou é como o usuário perde a confiança.

## Anatomia

Duas variantes, mesma tela. O que muda é o card de destaque e um bloco.

1. **Header nativo** — large title com o nome da conta. `headerRight`: `ellipsis.circle` com
   Editar · Arquivar (action sheet).
2. **Card de destaque (o único `GlassCard`)**
   - **Conta comum:** saldo atual, grande, `tabular-nums`. Abaixo, a conta que fecha:
     `saldo inicial + entradas − saídas = saldo`. Se houver `pending` nesta conta, uma quarta
     linha discreta: *"+ R$ 340 previstos, ainda não confirmados"*.
     *Essa decomposição é a tela.* `account_balances()` (`0011_workspace_rpcs.sql:106-133`) soma
     **sem filtrar `status`**, então parcela futura já está descontada do saldo — e é exatamente
     por isso que o número não bate com o banco. Mostrar a linha resolve o suporte inteiro.
   - **Cartão:** total da fatura aberta, dias até fechar/vencer, e barra de limite usado.
     Toque leva à fatura.
3. **"Previstos"** (só se houver) — `Row`s de `status='pending'` desta conta, ordenadas por
   `coalesce(due_at, occurred_at)`. Vem **antes** do histórico porque é o que ainda vai mexer no
   saldo.
4. **"Últimos lançamentos"** — ~15 `Row`s agrupadas por dia. Cada uma: descrição, categoria,
   origem (`via WhatsApp`) e valor. Transferência mostra a contraparte ("→ Nubank"), que é a
   única informação que Transações não dá direito hoje (`transactions.tsx:60` cai em
   "Transferência" seco).
5. **"Ver todos os lançamentos"** — `Row` de navegação no fim. Único caminho para o extrato
   completo.
6. **(só cartão) "Faturas anteriores"** — `Row` de navegação para `faturas-historico.md`.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Saldo | `useAccountBalances()` (`use-finance.ts:199`), achando a linha do `id` | `['account-balances']` | RPC `account_balances` | `transactions` |
| Dados da conta (tipo, ciclo, limite) | `useAccounts()` (`use-finance.ts:211`) | `['accounts']` | tabela `accounts` | `accounts` |
| Lançamentos e previstos | `useTransactions({ accountId, limit })` — **campo `accountId` novo** em `TransactionFilters` (`use-finance.ts:125-129`) | `['transactions', mês, kind, category, accountId]` | tabela `transactions` | `transactions` |
| (cartão) fatura aberta | `useCardSummary()` (`use-finance.ts:318`), achando a linha do `id` | `['card-summary']` | RPC `card_summary` | `card_invoices`, `transactions` |

**Sem RPC nova.** O saldo já é servido por conta em `account_balances()`, e o resumo do cartão já
vem por conta em `card_summary()`. O que falta é um **filtro**, não uma agregação: adicionar
`accountId?: string` a `TransactionFilters` e, no `queryFn`, um
`.or('account_id.eq.<id>,counterparty_account_id.eq.<id>')`. O `or` é obrigatório — sem a
contraparte, uma transferência recebida some do extrato da conta que recebeu, e o saldo deixa de
ser explicável pelas linhas mostradas.

A decomposição do card (inicial, entradas, saídas) é derivada **das linhas já carregadas do mês**
e do `initial_balance_cents` que `useAccounts` traz — não vale criar RPC para somar quatro
números que já estão na memória do cliente. Se um dia o extrato virar paginado, aí sim vira
`account_statement(p_account_id)` **(novo)** no padrão interna/wrapper.

Três queries, **três estados**.

## Ação primária

**Encontrar a linha que explica a diferença.** Concretamente: o usuário lê o card, olha os
previstos, e ou acha o lançamento errado (toca e corrige) ou conclui que está certo.

Por isso a lista é curta e ordenada por data desc: quem confere confere o recente.

## Ações secundárias

- Context menu no lançamento: Editar · Mudar categoria · Apagar (action sheet no apagar).
- Menu do header: Editar conta · Arquivar conta.
- (cartão) ir para a fatura; ir para o histórico de faturas.
- "Ver todos" com filtro pré-aplicado.

## Estados

- **Loading** — `Skeleton` com a forma: bloco alto + três linhas. Card e lista resolvem
  independentes.
- **Empty: conta nova, zero lançamento** — `EmptyState` ícone `tray`, título "Nenhum lançamento
  nesta conta", dica: *"Manda `gastei 45 no mercado no <nome da conta>` no WhatsApp — citar o
  nome faz o lançamento cair aqui."* É a dica mais acionável do app inteiro, porque conta citada
  por nome resolve por `ilike` e sem match o lançamento fica sem conta.
- **Empty diferente: conta com saldo inicial e nenhum movimento** — o card aparece normal (o
  saldo inicial é informação legítima) e só a lista tem empty. Não esconder o card.
- **Empty diferente: cartão sem compra no ciclo** — "Nenhuma compra nesta fatura ainda", sem
  botão. É estado normal de começo de mês, não um problema.
- **Error** — por bloco. Falhar `account_balances` não pode apagar a lista de lançamentos, e
  vice-versa.
- **Conta arquivada aberta por deep link** — a tela abre em modo leitura, com faixa "Conta
  arquivada" e ação "Desarquivar". Não some.
- **Conteúdo longo** — descrição trunca em uma linha; valor nunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Saldo do card | mudança de estado | conta de/para em `Motion.base` (~250 ms) |
| Barra de limite (cartão) | mudança de estado | `withSpring(Motion.spring.settle)` a partir da largura anterior |
| Entrada dos blocos | continuidade | `FadeInDown`, stagger 60 ms, cap 400 ms |
| Press em `Row` | feedback | highlight de fundo, 120 ms |
| Lançamento apagado | mudança de estado | `LinearTransition`, `Motion.fast`; haptic `notificationAsync(Success)` |
| Ir para a fatura | continuidade espacial | push nativo; nada custom |

## Acessibilidade

- Card de destaque com uma label única e completa, não quatro fragmentos: "Saldo do Itaú, três
  mil e duzentos reais. Saldo inicial mil, entradas cinco mil, saídas dois mil e oitocentos."
- `Row` de lançamento com `accessibilityRole="button"` e label com valor e data.
- "Previsto" é dito na label, não sinalizado só por cor (`transactions.tsx:75` hoje depende de
  `theme.warning` mais um emoji).
- Valores `selectable` e `tabular-nums` — a tela existe para copiar número.
- Dynamic Type XL: a decomposição do card vira lista vertical, uma linha por termo.

## Fora de escopo

- Conciliação com extrato do banco (marcar linha como "conferida") — v2, e exige coluna nova.
- Gráfico de evolução do saldo desta conta: só existe reconstruído das transações, e para conta
  com importação parcial ele mentiria. Evolução de posição é `patrimonio.md`, por snapshot.
- Editar a conta aqui dentro: o form é modal, e é o mesmo de Contas.
- Exportar CSV desta conta — Relatórios.
