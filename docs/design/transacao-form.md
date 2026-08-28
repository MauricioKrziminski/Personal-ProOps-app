# Novo/editar lançamento — `src/app/finance/transaction-form.tsx`

Continua no **Stack raiz**, como `presentation: 'modal'` (`src/app/_layout.tsx:40`) — junto com
`import`, é a única tela de finanças que **não** migra para dentro da pilha da aba. Modal é o
significado certo: tarefa com etapas, Cancelar e Salvar próprios, e o usuário não deveria trocar de
aba no meio.

São 491 linhas e a **única** tela do app com `react-hook-form` + `zod` (`zodResolver`, linha 106) —
o padrão que a `frontend.md` manda usar em todo form. Ela também é a única que cria plano de
parcelamento (`useCreateInstallmentPlan`, linha 153).

## Bug conhecido: o modal de edição vira modal de criação em silêncio

```ts
// transaction-form.tsx:96-99
const { data: monthTx } = useTransactions({ month: params.month ?? localISODate().slice(0, 7) });
const editing = params.id ? monthTx?.find((t) => t.id === params.id) : undefined;
```

O item em edição é **garimpado do cache** da lista do mês. Se o cache estiver frio (cold start via
deep link, app relançado, `month` ausente ou diferente do mês do lançamento), ou se a query falhar,
`editing` fica `undefined` — e o modal, que o usuário abriu para **editar**, salva um lançamento
**novo**. Sem erro, sem aviso, com duplicata no extrato.

Some com isso: `useTransaction(id)` **(novo)** — o mesmo hook do detalhe, `['transactions','item',
id]`, `select` por id, `enabled: !!params.id`. O `month` deixa de ser parâmetro necessário e o form
passa a ter um estado de carregamento honesto: enquanto `isLoading`, o modal mostra skeleton e o
botão fica desabilitado. **Salvar nunca pode acontecer antes de saber se é edição.**

## Pergunta que responde

> "Quero registrar (ou corrigir) isso aqui, agora."

## Persona

- **Primária: Camila, 34** — lança na hora, com categoria e conta certas.
- **Secundária: Jorge, 46** — compra parcelada no cartão: precisa dizer 10x e não pensar mais nisso.
- **Terciária: qualquer um corrigindo** o que a IA entendeu errado.
- O Rafa quase não usa esta tela: o caminho dele é o áudio no WhatsApp. **O form é a rota de
  exceção, e é por isso que ele não pode ser longo.**

## Entrada e saída

- **Entrada:** FAB do Financeiro e da lista de lançamentos (criação); **Editar** no detalhe do
  lançamento (`?id=`); "Vou pagar depois" no fluxo de conta a pagar (ver `conta-a-pagar.md`).
- **Saída:** `router.back()` no sucesso, com haptic `notificationAsync(Success)` (linhas 164, 184).
- **Cancelar** — `headerLeft` nativo. Com campo preenchido, confirma por **action sheet**
  ("Descartar lançamento?"); em branco, fecha direto.
- **Back:** volta para quem abriu. Nunca cai numa tela diferente da de origem.

## Anatomia

1. **Header do modal** — `<Stack.Title>` "Novo lançamento" / "Editar lançamento", `headerLeft`
   Cancelar, `headerRight` **Salvar** (o rótulo é sempre "Salvar" — hoje alterna entre "Adicionar" e
   "Salvar alterações", linhas 410-412, duas palavras para a mesma intenção). Hoje o cabeçalho é um
   `ScreenHeader` desenhado à mão dentro do `ScrollView` (linha 208).
2. **Valor** — `MoneyInput` grande, `autoFocus` na criação (linha 231). É o primeiro campo porque é
   o único obrigatório e porque o teclado numérico já abre com ele.
3. **Tipo** — segmented control: Gasto · Receita · Transferência. **Sem emoji** (hoje `💸 Gasto`,
   linhas 37-39).
4. **Categoria** — chips de `SUGGESTED_CATEGORIES` + campo livre (categoria é texto livre no
   domínio, e a lista é sugestão). Some quando `kind === 'transfer'`.
5. **Conta** — chips das contas ativas; em transferência, vira "Da conta" + "Para a conta".
6. **Data** — chips Hoje/Ontem + campo `dd/mm/aaaa`. O campo de texto com máscara manual (linhas
   375-389) vira `DateTimePicker` nativo em `formSheet`: digitar data é o campo que mais dá erro
   de validação nesta tela.
7. **Parcelas** — só quando `kind='expense'` **e** conta escolhida **e** não é edição (`podeParcelar`,
   linha 147). Mantém a explicação de hoje ("o valor acima é o TOTAL da compra", linhas 303-308),
   que é o mal-entendido nº 1 do parcelamento.
8. **Avançado** (recolhido) — Descrição · Estabelecimento (`merchant`) · **"Vou pagar depois"**
   (ver `conta-a-pagar.md`). Recolhido porque 90% dos lançamentos não precisam disso, e a tela já
   é longa demais para um modal.
9. **Apagar** — só em edição, no fim, em `danger`, com **action sheet** nativo (hoje apaga direto,
   linhas 191-199: um toque sem confirmação numa área destrutiva).

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Item em edição | `useTransaction(id)` **(novo)** | `['transactions','item', id]` | tabela `transactions` | `transactions` |
| Contas | `useAccounts()` | `['accounts']` | tabela `accounts` | `accounts` |
| Salvar | `useSaveTransaction()` | — | insert/update em `transactions` (`use-finance.ts:1099`) | — |
| Parcelar | `useCreateInstallmentPlan()` | — | RPC `create_installment_plan` (`use-finance.ts:380`) | — |
| Apagar | `useDeleteTransaction()` | — | delete em `transactions` (`use-finance.ts:1117`) | — |

**`TransactionInput` precisa crescer** (`use-finance.ts:1089-1097`). Hoje tem `kind`,
`amount_cents`, `category`, `description`, `account_id`, `counterparty_account_id`, `occurred_at` —
e faltam quatro colunas que já existem no banco:

| Campo | Origem | Por que |
|---|---|---|
| `status` | `0013:139` | criar conta a pagar (`pending`) — hoje o app só dá baixa, não sabe criar |
| `due_at` | `0013:140` | vencimento; é o que alimenta `upcoming_bills` e a projeção |
| `merchant` | `0013:144` | já é coletado pela importação e pelo parcelamento, nunca pelo form |
| `currency` | `0005:32` | não vai para a UI — entra no tipo com default `'BRL'` para o insert não depender do default do banco |

`useCreateInstallmentPlan` (`use-finance.ts:380-405`) também não passa `p_merchant`, embora a RPC
aceite (`0013_cards_and_installments.sql:230`). Uma linha, e o plano parcelado passa a saber a loja
— que é o que a tela de parceladas quer mostrar.

**Validação zod** ganha as regras novas: `due_at` obrigatório quando `status='pending'`, e
`due_at >= occurred_at`. O schema atual (linhas 42-75) já é o modelo a seguir — `refine` com
`path`, mensagem em pt-BR.

## Ação primária

**Salvar.** Um botão, no `headerRight`, sempre com o mesmo rótulo, sempre no mesmo lugar. O caminho
mínimo é: valor → Salvar. Todo o resto tem default.

## Ações secundárias

Trocar tipo · escolher categoria e conta · parcelar · abrir "Avançado" · apagar (edição).

## Estados

- **Loading** — só em edição, enquanto `useTransaction` resolve: `Skeleton` com a forma dos campos e
  **Salvar desabilitado**. Nunca renderizar o form em branco durante o carregamento: foi exatamente
  isso que virou o bug de duplicação.
- **Empty** — não existe. O modo de criação **é** o formulário vazio. Sem conta cadastrada, a área
  de contas mostra uma linha acionável (hoje é texto morto, linhas 276-280): *"Nenhuma conta ainda —
  cadastrar"*, que abre Contas. **Conta é opcional**: lançamento sem conta é válido e conta no caixa
  (`private.cash_total()`, `0028`).
- **Error** — erro de validação **no campo**, em `danger`, e o scroll leva até ele (hoje o erro de
  data fica fora da tela se o teclado estiver aberto). Falha de save: toast persistente,
  **o formulário continua preenchido**, botão volta a "Salvar". Nunca fechar o modal com erro.
- **Conteúdo longo** — descrição longa cresce até três linhas; muitas contas fazem a faixa de chips
  rolar horizontalmente, não quebrar em cinco fileiras.
- **Teclado** — o campo em foco fica visível. `KeyboardAvoidingView` com `behavior` só no iOS
  (linhas 204-206) deixa o Android com campo escondido atrás do teclado.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Abrir o modal | continuidade espacial | apresentação nativa de `modal`, sem custom |
| Trocar de tipo | mudança de estado | campos que somem/aparecem usam `LinearTransition` em `Motion.fast`; haptic `selectionAsync` |
| Abrir "Avançado" | explicação | `LinearTransition`, `Motion.base` (~250 ms) |
| Erro de campo | feedback | mensagem entra com `FadeIn` 150 ms; **sem shake** — shake é ruído em form curto |
| Salvar | feedback | botão vira "Salvando…" (já existe, linhas 408-409); no sucesso, haptic `notificationAsync(Success)` e o modal fecha |
| Parcelas | explicação | a linha "10x de R$ 45,90" faz cross-fade em `Motion.fast` a cada troca |

## Acessibilidade

- Todo campo com `accessibilityLabel` próprio; o `MoneyInput` anuncia o valor formatado, não os
  dígitos crus.
- Chips com `accessibilityState={{ selected }}`; a faixa de categorias é uma lista navegável.
- Erro de campo com `accessibilityLiveRegion="polite"` — hoje o leitor de tela não é avisado.
- "Salvar" desabilitado precisa dizer **por quê** ("Informe o valor"), não só ficar cinza.
- Alvos ≥ 44pt em chip e seta.
- Dynamic Type XL: o `MoneyInput` reduz um passo em vez de truncar; os chips passam a rolar.

## Fora de escopo

- Anexar comprovante aqui. Anexo é ação do **detalhe** — no form ele competiria com o valor, que é
  o único campo que importa.
- Editar um plano de parcelamento por este form. Editar uma parcela é editar uma transação; mexer no
  plano inteiro é outra tela (`parceladas.md`).
- Criar recorrência a partir do form ("todo mês igual a este"). Recorrente tem tela e RRULE próprios.
- Multi-moeda: `currency` entra no `TransactionInput` como `'BRL'` fixo, sem seletor na UI.
- Rascunho persistido do modal. É um modal efêmero, e é assim que ele deve continuar.
