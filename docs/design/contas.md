# Contas — `src/app/(tabs)/finance/accounts.tsx`

Hoje a tela vive em `src/app/finance/accounts.tsx` (383 linhas) e faz três coisas ao mesmo tempo
dentro de um `ScrollView`: lista saldos, edita conta e cria conta. O formulário é **inline
expansível** (`accounts.tsx:179-276`) — abre no meio do scroll, empurra a lista para baixo e é o
único form de criação do app que não é modal. `transaction-form`, `budgets` e `goals` são modais;
esta não. Isso é um padrão inconsistente, e é o que a migração conserta.

Também não é uma "tela de contas": é uma tela de **saldos** com um form pendurado. O que ela
mostra vem de `account_balances()`, não de `accounts` — a lista inclui a linha sintética
`account_id: null` "Sem conta" (`0005_finance_core.sql:241-245`, versão viva em
`0011_workspace_rpcs.sql:126-132`), que não é editável e ganha uma checagem de guarda em
`accounts.tsx:70-72` e `:107-108`.

## Pergunta que responde

> "Quanto eu tenho, e onde?"

Não é "quanto eu gastei" (isso é o Financeiro) nem "o que vence" (isso é Hoje). É **posição**:
a soma do que existe agora, quebrada por lugar.

## Persona

- **Primária: Camila, 34** — tem conta corrente, poupança, um cartão e dinheiro vivo. Quer bater
  o saldo do app com o do banco. Se os dois números não fecham, ela para de usar o app.
- **Secundária: Jorge, 46** — chega aqui uma vez, para cadastrar o cartão com fechamento e
  vencimento. Se esse cadastro for confuso, todo o resto do produto de cartão nasce errado.
- **Casal** — a conta é do workspace, não do usuário (`accounts_ws_name_key` unique
  `(workspace_id, name)`, `0010_workspaces.sql:149`). Duas pessoas veem e editam as mesmas contas.

## Entrada e saída

- **Entrada:** `Financeiro › Gerenciar › Contas`; empty state de Cartões (`cards.tsx:131-143`
  manda para cá); primeiro uso, quando o usuário precisa cadastrar antes de ter dado.
- **Saída:**
  - toque na conta → `push /finance/accounts/[id]` (conta-detalhe)
  - toque em "Sem conta" → `push /finance/transactions` com o filtro de transações sem conta
  - novo/editar → `modal /finance/account-form?id=` **(rota nova)**
- **Back:** pop normal para Financeiro. Nada de porta de mão única aqui.

## Anatomia

1. **Header nativo** — large title "Contas". `headerRight`: `plus` → form modal.
   Hoje o título é um `ScreenHeader` desenhado dentro do `ScrollView` (`accounts.tsx:126`), e o
   botão de criar é um `Pressable` com o glyph `＋` como texto (`accounts.tsx:288`).
2. **Card de destaque (o único `GlassCard`) — "Dinheiro disponível"**
   Valor em `Fonts.rounded` com `tabular-nums`, e abaixo, em linha secundária:
   `em conta · investido · dívida de cartão`.
   *Por que não "Saldo total":* hoje `accounts.tsx:55` soma **todas** as linhas de
   `account_balances()`, inclusive as de `credit_card`, que são negativas. O número no topo é
   "dinheiro menos fatura", apresentado como se fosse dinheiro. Pior: `account_balances()`
   (`0011_workspace_rpcs.sql:106-133`) **não filtra `status`**, então parcela futura `pending` já
   está descontada ali — enquanto `private.cash_total` (`0028_cash_includes_accountless.sql:26`)
   filtra `status='cleared'` e exclui `credit_card`. **Contas e Patrimônio mostram caixas
   diferentes hoje, e nenhuma tela avisa.** O card de destaque usa a definição de caixa do
   domínio e separa dívida em vez de subtrair calada.
3. **"Contas"** — `Section` de `Row`s opacas, agrupadas por natureza, nesta ordem:
   **dinheiro** (`checking`, `savings`, `cash`) → **investimento** → **cartão**.
   Cada `Row`: ícone SF por tipo, nome, tipo em texto secundário, saldo à direita com
   `tabular-nums` (negativo em `danger`).
   *A ordem é a ordem da pergunta:* o que dá para gastar vem antes do que é dívida. Hoje a ordem é
   `created_at` (`use-finance.ts:220`) misturando cartão com corrente.
4. **"Sem conta"** — a linha sintética fica **fora** do agrupamento, com o rótulo
   *"lançamentos que não citam conta"* e um toque que leva ao extrato correspondente.
   Hoje ela aparece no meio da lista com o emoji `❔` e um tipo que não existe
   (`accounts.tsx:32`, `:156` cai no fallback "Sem conta"). Quem só usa o WhatsApp tem a maior
   parte do dinheiro aqui, e a tela trata isso como erro de dado.
5. **"Arquivadas"** — `Row` de navegação no fim, com contagem. Hoje conta arquivada
   simplesmente evapora (`use-finance.ts:219` filtra `archived=false`) e não existe caminho
   nenhum para desarquivar.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Card de destaque | `useAccountBalances()` (`use-finance.ts:199`) | `['account-balances']` | RPC `account_balances` | `transactions` |
| Lista (tipo, ciclo do cartão) | `useAccounts()` (`use-finance.ts:211`) | `['accounts']` | tabela `accounts` | `accounts` |
| Arquivadas (contagem) | `useArchivedAccounts()` **(novo)** | `['accounts','archived']` | tabela `accounts` com `archived=true` | `accounts` |
| Salvar | `useSaveAccount()` (`use-finance.ts:1129`) | — | insert/update em `accounts` | — |
| Arquivar | `useArchiveAccount()` (`use-finance.ts:1158`) | — | update `archived=true` | — |

**As duas queries precisam de estado próprio.** Hoje `accounts.tsx:37` pega `isError`/`isLoading`
de `useAccountBalances` e `accounts.tsx:38` pega **só `data`** de `useAccounts` — se a lista de
contas falhar, a tela não mostra erro nenhum: os saldos aparecem, o toque para editar não acha a
conta (`accounts.tsx:71-72` faz `return` mudo) e o usuário conclui que o app travou.

`useAccounts` é quem tem `closing_day`/`due_day`/`credit_limit_cents`; `account_balances()` não
devolve nada disso. A `Row` de cartão precisa das duas — sem `accounts`, ela não sabe que é
cartão de crédito com ciclo, só que o saldo é negativo.

## Ação primária

**Ler o saldo e confiar nele.** É uma tela de leitura: o sucesso é o usuário bater o número com o
extrato do banco e fechar o app. Toda a energia de design vai em o número estar certo, ser
copiável e estar explicado (o que entra, o que não entra).

Cadastrar conta é **frequência 1**, e por isso não pode ocupar o corpo da tela.

## Ações secundárias

- **Nova conta** — `headerRight` → `modal /finance/account-form`. Modal com Cancelar/Salvar
  próprios: o cadastro de cartão tem quatro campos condicionais e é uma tarefa com etapas.
- **Context menu nativo** na `Row` (`Link.Menu`): Ver extrato · Editar · Arquivar.
  Hoje é `onPress` = editar e `onLongPress` = `Alert` de arquivar (`accounts.tsx:146-148`,
  `:106-120`) — o padrão explicitamente proibido, e uma tela que precisa de uma legenda no rodapé
  explicando os próprios gestos (`accounts.tsx:293-295`) já perdeu.
- **Arquivar** — action sheet nativo com o texto que já está certo hoje ("os lançamentos são
  mantidos"). **Precisa de `onError`**: `useArchiveAccount` (`use-finance.ts:1158-1168`) não tem
  nenhum, e `accounts.tsx:116` chama `mutate` sem callbacks — arquivar uma conta com FK viva pode
  falhar e a lista simplesmente não muda.
- **Desarquivar** — na tela de arquivadas, um toque.

### O formulário (modal, fora desta tela)

Nome · tipo (segmented, não chips) · e então:

- **não-cartão:** saldo inicial (`MoneyInput`).
- **cartão:** fecha dia · vence dia · limite · **conta que paga a fatura**.
  O `payment_account_id` existe no schema desde `0013_cards_and_installments.sql:71`, com check de
  não-auto-referência (`:83-85`), e o app **nunca escreve nele**: `accounts.tsx:95` manda
  `payment_account_id: null` fixo. Preenchê-lo é o que deixa a fatura sugerir a conta pagadora
  sozinha (ver `fatura.md`) em vez de pedir para o usuário escolher toda vez.

O texto "Compra depois do fechamento cai na fatura do mês seguinte" (`accounts.tsx:239-241`)
**fica** — é a regra de `private.invoice_window` (`0013:44-64`) dita em uma linha, no único
momento em que o usuário decide algo que depende dela.

## Estados

- **Loading** — `Skeleton` com a forma final: um bloco alto e quatro linhas. Hoje é um
  `ActivityIndicator` centralizado (`error-card.tsx:10-20`) que não parece com nada.
- **Empty (nenhuma conta e nenhum lançamento)** — `EmptyState`, ícone `wallet.bifold`, título
  "Nenhuma conta ainda", dica: *"Cadastre onde o dinheiro fica — corrente, poupança, dinheiro,
  cartão. Depois é só mandar `gastei 45 no mercado no Nubank` no WhatsApp."* Botão "Cadastrar
  conta".
- **Empty diferente: nenhuma conta, mas já tem lançamento.** É o caso de quem só usa o WhatsApp,
  e é o mais comum. Aqui o texto é outro: *"Seus lançamentos estão em 'Sem conta'. Cadastre suas
  contas para saber quanto tem em cada uma."* Mandar essa pessoa para o mesmo empty de usuário
  novo esconde dela que o dinheiro **já está no app**.
- **Error de saldos** — inline no lugar do card de destaque, com "Tentar de novo".
- **Error de contas** — inline acima da lista. Os saldos continuam visíveis; some só o que
  depende de `accounts` (ícone de tipo, ciclo do cartão) e as ações de editar.
- **Conteúdo longo** — nome de conta trunca em uma linha; valor nunca trunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Valor do card de destaque | mudança de estado | conta de/para em `Motion.base` (~250 ms), `tabular-nums` segura a largura |
| Entrada das seções | continuidade | `FadeInDown`, stagger 60 ms, cap 400 ms (é o que a tela já faz, `accounts.tsx:145`) |
| Press em `Row` | feedback | highlight de fundo, 120 ms — **não** `scale` |
| Linha arquivada saindo | mudança de estado | `LinearTransition` em `Motion.fast`; haptic `notificationAsync(Success)` |
| Abrir o form | continuidade espacial | apresentação `modal` da plataforma. Hoje o form aparece *dentro* do scroll e empurra a lista — salto de layout puro |

Nada mais anima. Saldo é dado que o usuário está lendo.

## Acessibilidade

- `Row` com `accessibilityRole="button"` e label completa: "Nubank, cartão de crédito, deve mil
  duzentos e trinta reais".
- Saldo negativo **nunca** comunicado só por cor (`accounts.tsx:161` hoje usa só `theme.danger`):
  a label diz "deve", e o valor sai com sinal.
- Valores `selectable` — bater com o extrato do banco é o caso de uso da tela.
- Botão de criar com `accessibilityLabel="Nova conta"` (ícone sozinho não basta).
- Dynamic Type XL: a `Row` quebra em duas linhas (nome em cima, tipo e valor embaixo) em vez de
  truncar o valor.
- Alvos ≥ 44pt na `Row` inteira.

## Fora de escopo

- **Open Finance / sincronizar com banco.** O produto é WhatsApp + importação de extrato.
- **Saldo materializado.** Saldo é derivado (`account_balances`), e continua sendo — coluna
  materializada é a origem clássica de saldo que não bate.
- **Reordenar contas na mão.** A ordem é por natureza; se alguém pedir, é preferência, não
  arquitetura.
- **Multi-moeda.** `accounts.currency` existe e o produto é BRL. Não exibir seletor.
- **Extrato completo da conta** — é `conta-detalhe.md`, e o extrato geral é `/finance/transactions`.
