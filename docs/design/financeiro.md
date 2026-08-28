# Financeiro — `src/app/(tabs)/finance/index.tsx`

## Estrutura de rota

A aba vira diretório com `<Stack>` aninhado (requisito para header nativo em `NativeTabs`), e as
16 telas que hoje vivem em `src/app/finance/*` **migram para dentro dele** —
`(tabs)/finance/{index,transactions,accounts,cards,budgets,…}.tsx`. Ganham large title, back
nativo, e a tab bar deixa de sumir ao navegar (hoje elas estão no Stack raiz).

Continuam no **Stack raiz**, acima das abas, só as telas de atenção total: `transaction-form`
(modal) e `import` (fluxo com etapas).

Aba 3. Hoje esta tela tem 493 linhas e termina em **13 links com emoji**
(`🧾 Todos os lançamentos`, `🔮 Projeção e simulador`, `💳 Cartões e faturas`, …). Isso é um
sumário de departamentos, não um painel. O usuário chega com uma pergunta e recebe um menu.

## Pergunta que responde

> "Como está o meu mês?"

E o corolário imediato, que é o que realmente move comportamento: **"posso gastar?"**

## Persona

- **Primária: Camila, 34** — CLT + freela, organiza tudo. Domingo à noite quer saber onde o
  dinheiro foi e onde ela furou.
- **Secundária: Rafa, 29** — quer o veredito, não o extrato. Para ele existe o simulador.
- O Jorge (contas vencendo) é atendido na aba **Hoje**; aqui ele aparece resumido, não repetido.

## Entrada e saída

- **Entrada:** aba.
- **Saída:** transações (com filtro pré-aplicado ao vir de uma categoria), projeção, orçamentos,
  e a faixa de atalhos → `/finance/manage` para o resto.
- **Back:** aba raiz. Re-tap volta ao topo.
- **FAB** → `modal /finance/transaction-form`.

## Anatomia

1. **Header nativo** — large title "Financeiro". `headerRight` = menu (`ellipsis.circle`) com
   Importar extrato · Regras · Atividade da IA (`/ai-activity`, no Stack raiz — a tela deixa de
   morar em `finance/` porque registra nota e lembrete também). *Ferramenta de manutenção não
   ocupa corpo de tela.*
2. **Seletor de mês** — segmented/stepper no topo, um só componente (hoje existem duas
   implementações visualmente diferentes, em `transactions.tsx` e `budgets.tsx`).
3. **Card de destaque (único `GlassCard`) — "Sobra até o fim do mês"**
   Projeção, não saldo bruto. Saldo bruto mente para quem tem fatura fechando. Abaixo do valor:
   `entrou · saiu · previsto`, e uma `Sparkline` do caixa projetado.
   Fonte: `cash_flow_forecast`.
4. **Faixa "Gerenciar"** — logo abaixo do card de destaque: `SectionHead` com "Ver tudo"
   (→ `/finance/manage`) e **quatro atalhos** em tiles quadrados — Lançamentos · Contas ·
   Cartões · Orçamentos. Os outros oito destinos vivem no "Ver tudo" (ver `gerenciar.md`).
   *A faixa fica sempre visível, inclusive no empty: sem conta cadastrada não existe dado a
   mostrar, e é daqui que o usuário sai para cadastrar.*
5. **"Posso comprar isso?"** — linha de ação levando ao simulador (`affordability`). É a feature
   mais forte do produto e hoje está enterrada dentro de `/finance/forecast`.
6. **"Onde o dinheiro foi"** — barras por categoria do mês **com comparação ao mês anterior**
   (a comparação é o que transforma número em informação). Toque na categoria → transações
   filtradas. Fonte: `transactions_summary`.
7. **"Passando do limite"** — só orçamentos ≥ 80%. Fonte: `budgets_status`.
8. **"Cartões"** — um `Row` por cartão: fatura atual, quanto falta fechar, limite livre.
   Fonte: `card_summary`.
9. **"Últimos lançamentos"** — 5 itens agrupados por dia, com fonte (`via WhatsApp`) visível e
   correção em um toque. **É o fim da tela** — o menu de 12 linhas que terminava aqui virou a
   faixa de atalhos do bloco 4 (28/08/2026, a pedido do usuário).

## Dados

| Bloco | Hook | RPC / tabela | Realtime |
|---|---|---|---|
| Sobra | `useCashFlowForecast` | `cash_flow_forecast` | `transactions` |
| Simulador | `useAffordability` (lazy) | `affordability` | — |
| Categorias | `useTransactionsSummary(mês)` | `transactions_summary` | `transactions` |
| Comparação | `useTransactionsSummary(mês-1)` | `transactions_summary` | `transactions` |
| Orçamentos | `useBudgetsStatus(mês)` | `budgets_status` | `transactions`, `budgets` |
| Cartões | `useCardSummary` | `card_summary` | `card_invoices`, `transactions` |
| Últimos | `useRecentTransactions(5)` | `transactions` | `transactions` |

Sete queries. **Cada uma com o seu estado** — hoje `hasError` (linha 138) cobre cinco e esquece
`bills`, e `isLoading` cobre só duas.

## Ação primária

**Entender onde furou e agir na categoria.** Concretamente: tocar numa categoria e cair no
extrato filtrado. O FAB (criar lançamento) é secundário de propósito — a captura principal do
produto é o WhatsApp.

## Ações secundárias

- FAB → novo lançamento (`modal`).
- Menu do header → importar, regras, atividade da IA.
- Context menu em lançamento → editar · mudar categoria · apagar.
- Toque em cartão → fatura.

## Estados

- **Loading** — `Skeleton` com a forma: card alto, faixa de barras, três linhas. Blocos entram
  conforme resolvem.
- **Empty (sem nenhuma transação)** — `EmptyState` ícone `chart.pie`, título "Ainda não tem
  movimento", dica: *"Manda `gastei 45 no mercado` no WhatsApp — ou toca no + para lançar aqui"*.
  A faixa "Gerenciar" **continua visível** (o usuário precisa cadastrar conta antes de ter dado).
- **Empty parcial** — sem orçamento, a seção some e o destino continua na faixa. Sem cartão, idem.
- **Error** — por bloco, inline, com retry.
- **Conteúdo longo** — nome de categoria trunca; valor nunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Troca de mês | continuidade espacial | conteúdo faz cross-fade em `Motion.fast`; o valor conta de/para |
| Barras de categoria | mudança de estado | crescem com `withSpring(Motion.spring.settle)`, stagger 40 ms |
| Sparkline | mudança de estado | path anima em `Motion.slow` |
| FAB | feedback | entra com `scale 0.9 → 1`, press-in `0.97`, haptic `impactAsync(Medium)` |
| Blocos | continuidade | `FadeInDown`, stagger 60 ms, cap 400 ms |
| Atalho da faixa | feedback | press-in `scale 0.97` em `Motion.fast`, haptic `selectionAsync` |

## Acessibilidade

- Barra de categoria não comunica só por cor/comprimento: a `Row` diz o valor e o percentual.
- `accessibilityLabel` no seletor de mês ("Agosto de 2026, mês anterior / próximo").
- FAB com label "Novo lançamento".
- Dynamic Type XL: a faixa de barras vira lista vertical.
- Valores `selectable`, `tabular-nums` em todos.

## Fora de escopo

- Dashboard customizável (arrastar/esconder blocos). A ordem é opinião do produto.
- Investimentos com cotação ao vivo — `assets` é marcação manual, e inventar preço seria mentir.
- Multi-moeda: `currency` existe no schema e o produto é BRL. Não exibir seletor.
- Repetir "o que vence" em detalhe: isso é da aba **Hoje**. Aqui só o resumo do mês.
