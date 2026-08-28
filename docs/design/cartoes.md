# Cartões — `src/app/(tabs)/finance/cards.tsx`

Hoje em `src/app/finance/cards.tsx` (207 linhas): um `GlassCard` por cartão, com total, prazo,
barra de limite e um toque que leva à fatura. É a tela mais próxima de pronta da área — e é
também a que mostra **dois números diferentes como se fossem o mesmo**.

## A regra do domínio (não reimplementar aqui)

Duas coisas que esta tela **não faz e nunca deve fazer**:

1. **A regra de ciclo mora no banco, em um lugar só.** O trigger `set_invoice`
   (`0013_cards_and_installments.sql:210-213`) chama `private.invoice_window(closing_day, due_day,
   occurred_at)` (`:44-64`) e resolve a fatura de cada compra — no app, no WhatsApp e na
   importação. Compra **até** o dia de fechamento cai na fatura do próprio mês; depois, na do mês
   seguinte; dia 31 em mês curto cai no último dia (`private.day_in_month`, `:18-27`). A tela lê
   `closing_date`/`due_date` prontos e **não recalcula nada**. Se um dia aparecer aritmética de
   ciclo em TS aqui, é bug de arquitetura, não detalhe.
2. **Cartão é conta comum em partida dobrada** (`0013:10-13`). A compra deixa o saldo do cartão
   negativo — é dívida — e o **pagamento da fatura é `transfer`** da conta pagadora para o cartão
   (`public.pay_invoice`, `0013:292-342`), nunca despesa nova: o gasto já contou quando a compra
   foi feita. A tela nunca oferece "lançar pagamento da fatura como despesa", e o texto que
   explica isso vive em `fatura.md`.

## Pergunta que responde

> "Quanto vou pagar de cartão, e quando?"

Não "quanto gastei" — isso é o Financeiro. É **compromisso futuro**: valor e data.

## Persona

- **Primária: Jorge, 46.** O cartão é o medo dele. Abre esta tela para saber se dá para respirar
  até o vencimento e se o limite aguenta o mês.
- **Secundária: Rafa, 29** — quer saber quanto de limite sobrou antes de parcelar alguma coisa.
- **Casal** — dois cartões de duas pessoas no mesmo workspace; a lista precisa dizer de quem é
  sem virar tela de gestão de pessoas.

## Entrada e saída

- **Entrada:** `Financeiro › Cartões` (a seção resumida do Financeiro leva para cá); `Gerenciar`.
- **Saída:**
  - card → `push /finance/invoice/[id]` (fatura aberta)
  - "faturas anteriores" → `push /finance/accounts/[id]/invoices`
  - menu → `modal /finance/account-form?id=` (é a mesma conta)
  - empty → Contas
- **Back:** pop para Financeiro.

## Anatomia

> **28/08/2026** — o card de destaque "Total a pagar" agora só aparece **com mais de um cartão**.
> Com um só ele repetia, palavra por palavra, o total, o nome e o vencimento do card logo abaixo.
> Soma de um item não é resumo.

1. **Header nativo** — large title "Cartões". `headerRight`: `plus` → form de conta já com
   `type='credit_card'` pré-selecionado.
2. **Card de destaque (o único `GlassCard`) — "Total a pagar"**
   A soma de `unpaid_total_cents` de todos os cartões, com a **data do vencimento mais próximo**
   embaixo. Uma pessoa com três cartões hoje precisa somar de cabeça.
   *Existe porque a pergunta da tela é uma só, e com N cartões ela não tem resposta visível.*
3. **Um `Card` opaco por cartão**, e é aqui que está o conserto principal:
   - **Nome + bandeira do estado**: `Aberta` / `Fechada` / `Atrasada`, como texto, não como cor.
   - **Valor grande**: o total **daquela fatura** (`invoice_total_cents`).
   - **Linha de contexto**: `fecha em 6 dias · vence 05/09`, de `closing_date`/`due_date`.
   - **Barra de limite** com rótulo honesto: `usado R$ X de R$ Y · livre R$ Z`, onde `X` é
     `unpaid_total_cents` (**todas** as faturas não pagas) — e quando `X ≠ invoice_total_cents`,
     uma linha a mais: *"inclui R$ N de fatura anterior em aberto"*, tocável, levando ao
     histórico.
     **É o bug de leitura de hoje:** `cards.tsx:82-84` mostra `invoice_total_cents` como o número
     grande e `cards.tsx:103` mostra `unpaid_total_cents` como "usado", sem dizer que são coisas
     diferentes. `_card_summary` (`0013:376-382`) calcula um por fatura e o outro somando **todas
     as faturas com `status <> 'paid'`**. Quem atrasou uma fatura vê "R$ 800" no topo e
     "R$ 2.300 de R$ 5.000" logo abaixo, sem nenhuma explicação.
   - **Ação na linha: "Paguei"** quando a fatura está fechada e tem total > 0 — leva à fatura com
     a conta pagadora já sugerida.
4. **"Parcelas em andamento"** — resumo de `installment_plans` ativos: quantas compras parceladas,
   quanto por mês, até quando. É a segunda pergunta de todo mundo que usa cartão, e hoje o dado
   existe (`0013:116-129`) e nenhuma tela o mostra.

**Ordem:** vencimento mais próximo primeiro. Hoje é `order by c.name` (`0013:386`) — ordem
alfabética não é ordem de urgência.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Card de destaque | `useCardSummary()` (`use-finance.ts:318`) | `['card-summary']` | RPC `card_summary` | `card_invoices`, `transactions` |
| Lista de cartões | `useCardSummary()` | `['card-summary']` | RPC `card_summary` | idem |
| Estado da fatura | **coluna `status` a somar em `card_summary()`** — `_card_summary`/`card_summary` (`0013:345-432`) **(novo)** | — | `card_invoices.status` | — |
| Parcelas em andamento | `useInstallmentPlans()` **(novo)** | `['installment-plans']` | tabela `installment_plans` | `installment_plans` (já publicada, `0013:441-444`) |

**`card_summary()` só devolve a fatura não-paga mais antiga.** A CTE `aberta`
(`0013:411-417`) é `distinct on (ci.account_id) … where ci.status <> 'paid' order by
ci.account_id, ci.reference_month` — a **primeira** por mês de referência. Consequências que a
tela precisa assumir:

- Fatura mais nova, ainda acumulando compras, **não aparece** enquanto a anterior não for paga.
  Por isso o rótulo fixo "fatura aberta" (`cards.tsx:87`) pode estar mentindo.
- **A RPC não devolve `status`** (retorno em `0013:346-350`): a tela literalmente não tem como
  saber se aquela fatura está `open` ou `closed`. É a menor mudança que resolve o rótulo, o botão
  "Paguei" e a ordenação — uma coluna a mais nas duas versões, interna e wrapper.
- Fatura passada só existe em `faturas-historico.md`.

## Ação primária

**Ver a fatura que vai vencer.** Um toque, sem decisão intermediária.

Hoje o toque é `disabled={!card.invoice_id}` (`cards.tsx:61`): cartão recém-cadastrado, sem
nenhuma compra, é um card morto — não navega, não explica, não sugere. Cartão sem fatura precisa
levar para o **detalhe da conta** com um empty que diz o que fazer.

## Ações secundárias

- Context menu no cartão (`Link.Menu`): Ver fatura · Faturas anteriores · Editar cartão ·
  Arquivar.
- "Paguei" na linha da fatura fechada → fatura com pagador sugerido.
- Header: novo cartão.

## Estados

- **Loading** — `Skeleton` com a forma: bloco alto + dois cards com barra. Hoje é
  `ActivityIndicator` (`cards.tsx:47`).
- **Empty (nenhum cartão)** — `EmptyState` ícone `creditcard`, título "Nenhum cartão cadastrado",
  dica: *"Cadastre o cartão com o dia que fecha e o dia que vence. Aí é só mandar `parcelei a
  geladeira em 12x no Nubank` no WhatsApp."* Botão "Cadastrar cartão" → Contas. O texto de hoje
  (`cards.tsx:127-130`) já é bom; muda o emoji para ícone SF e o `\n` manual para layout.
- **Empty diferente: cartão existe, nenhuma compra no ciclo** — não é o empty da tela, é o estado
  do card: "Nenhuma compra neste ciclo · fecha em 12 dias". O card continua tocável.
- **Empty diferente: cartão sem limite cadastrado** — a barra some (é o que `cards.tsx:91` já
  faz) e no lugar entra uma dica tocável: "Cadastre o limite para acompanhar quanto sobra".
  Barra ausente sem explicação parece bug.
- **Estado de risco: limite estourado** — `available_limit_cents` negativo. Hoje sai
  "−R$ 300 livres" (`cards.tsx:106`), que não é português. Vira "R$ 300 acima do limite", em
  `danger`, com ícone.
- **Atrasada** — `due_date` no passado. Vem primeiro na lista, com a palavra "Atrasada", não só
  cor (`cards.tsx:76` hoje só troca a cor do texto de prazo).
- **Error** — inline, com "Tentar de novo". É uma query só: aqui o estado único é correto.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Barra de limite | mudança de estado | `withSpring(Motion.spring.settle)` a partir da largura anterior. Hoje é `width` em `%` num `View` (`cards.tsx:96-99`) e salta |
| Total a pagar | mudança de estado | conta de/para em `Motion.base`, `tabular-nums` |
| Entrada dos cards | continuidade | `FadeInDown`, stagger 60 ms, cap 400 ms (já existe, `cards.tsx:59`) |
| Press no card | feedback | `scale 0.97`, 120 ms; haptic `selectionAsync` na navegação |
| Ir para a fatura | continuidade espacial | push nativo |

## Acessibilidade

- Label do card completa e em uma frase: "Nubank, fatura de agosto, mil duzentos e trinta reais,
  vence em seis dias, limite usado quarenta e seis por cento".
- Barra de limite com `accessibilityValue={{ min, max, now }}` — barra sem valor é decoração para
  quem usa leitor de tela.
- "Atrasada" e "acima do limite" **sempre** com palavra e ícone, nunca só `danger`.
- Alvo do card ≥ 44pt (já é, mas o card desabilitado de hoje é um alvo que não responde — pior
  que alvo pequeno).
- Dynamic Type XL: a linha `usado / limite / livre` quebra em duas.
- Valores `selectable`, `tabular-nums`.

## Fora de escopo

- **Recalcular ciclo no app.** Ver a regra do domínio no topo.
- **Pagar a fatura aqui.** O pagamento tem escolha de conta e confirmação: é `fatura.md`.
- **Bandeira/cor do cartão, últimos 4 dígitos.** Não existem no schema (`accounts`, `0013:66-71`)
  e inventar campo por estética é dívida.
- **Fatura futura projetada.** O que ainda vai fechar aparece como `pending` na projeção
  (`cash_flow_forecast`), não como um cartão a mais.
- **Antecipar/parcelar fatura.** Operação de banco, não de app de anotação.
