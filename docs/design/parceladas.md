# Compras parceladas — `src/app/(tabs)/finance/installments.tsx`

**Tela nova.** A tabela `installment_plans` existe desde a `0013_cards_and_installments.sql:116-129`,
a RPC `create_installment_plan` (`0013:223`) escreve nela, o form do app chama a RPC
(`transaction-form.tsx:153`) e a tabela está na publicação realtime (`0013:442-443`) — **e nada, em
lugar nenhum do app, lê de volta**. `grep -rn "installment_plans" src/` só encontra o tipo gerado.

O que o usuário vê hoje da compra que ele parcelou em 10x: dez linhas soltas no extrato, uma por
mês, com a descrição que a RPC monta — `Geladeira (3/10)` (`0013:276`). Ele não vê o total, não vê
quantas faltam, não vê o quanto isso pesa em novembro. Comprou parcelado justamente para diluir, e o
app não conta como está a diluição.

## Pergunta que responde

> "O que eu já comprometi nos próximos meses — e quanto falta para acabar?"

## Persona

- **Primária: Jorge, 46** — cartão e dívida. Parcelamento é a dívida que ele não chama de dívida.
- **Secundária: Rafa, 29** — antes de parcelar mais uma, quer saber quanto já está pendurado.
  É o complemento natural do "posso comprar isso?" (`affordability`).
- **Terciária: Camila, 34** — quer o mês em que a última parcela cai, para planejar.

## Entrada e saída

- **Entrada:** Financeiro → "Gerenciar" → **Parceladas**; do detalhe de um lançamento com
  `installment_plan_id` ("Parcela 3 de 10 — Magalu"); da fatura do cartão.
- **Saída:**
  - plano → `push /finance/installments/[id]` (as parcelas daquele plano, uma por mês).
  - parcela → `push /finance/transactions/[id]`.
  - fatura de uma parcela → `push /finance/invoice/[id]`.
- **Back:** pop na pilha do Financeiro.

## Anatomia

1. **Header nativo** — large title "Parceladas". Sem `headerRight`: **não se cria plano por aqui**.
   Parcelamento nasce da compra (form ou WhatsApp), e um "+" nesta tela convidaria a inventar uma
   compra que não aconteceu.
2. **Card de destaque (o único `GlassCard`) — "Comprometido nos próximos 12 meses"**
   Valor grande, `Fonts.rounded`, `tabular-nums`. Abaixo: *"R$ 1.240,00 por mês em média · última
   parcela em março de 2027"*. É o card porque é o número que ninguém sabe de cabeça e que muda a
   decisão de parcelar de novo.
3. **Barras por mês** — os próximos 6 meses, quanto de parcela cai em cada um. A barra mais alta é
   a informação: *"novembro é o mês pesado"*. Mesma linguagem visual das barras de categoria do
   Financeiro.
4. **"Em andamento"** — uma `Row` por plano, ordenada por **quanto falta pagar** (não por data): o
   que dói é o saldo, não a idade da compra. Cada linha:
   - título: `merchant` quando existe, senão `description`, senão "Compra parcelada";
   - `3 de 10 · R$ 458,90 por mês` (`tabular-nums`);
   - à direita: **falta R$ 3.212,30**;
   - barra de progresso fina (parcelas pagas / total) e o cartão em que caiu.
5. **"Terminadas"** — seção recolhida, últimos 12 meses. Existe porque "acabou de quitar a
   geladeira" é uma informação boa, e porque some sozinha quando não há nada.

**Por que nesta ordem:** total → distribuição no tempo → planos → histórico. Do compromisso agregado
ao item; quem chega aqui quer primeiro o susto, depois o detalhe.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Comprometido + barras | `useInstallmentLoad(12)` **(novo)** | `['installments','load','12']` | RPC `installments_load` **(nova)** | `transactions` |
| Em andamento / terminadas | `useInstallmentPlans()` **(novo)** | `['installments','plans']` | RPC `installment_plans_summary` **(nova)** | `installment_plans`, `transactions` |
| Parcelas de um plano | `useInstallmentPlan(id)` **(novo)** | `['installments','plan', id]` | tabela `transactions` `.eq('installment_plan_id', id).order('installment_no')` | `transactions` |

**As duas agregações têm de ser RPC**, par interna/wrapper como manda `supabase.md` — não `reduce`
no cliente. Dois motivos concretos:

- `finance.md` é explícita: *"Toda leitura agregada via RPC. Não somar transações no cliente."*
- **`installment_plans` não tem coluna de status nem de arquivamento** (`0013:116-129`: só
  `total_cents`, `installments`, `first_occurred_at`, `merchant`, `category`, `account_id`). "Em
  andamento" é **derivado** — existe alguma `transactions` do plano com `status='pending'`. Isso é um
  `exists` correlacionado por plano; fazer no cliente exigiria baixar todas as parcelas de todos os
  planos, inclusive os de 2024.

`installment_plans_summary()` devolve, por plano: `id, merchant, description, category, account_id,
account_name, total_cents, installments, installments_paid, installment_cents, remaining_cents,
first_occurred_at, last_occurred_at, active`. `installments_load(months)` devolve `mês,
total_cents` das parcelas `pending` agrupadas por mês.

**Regra do domínio que a tela precisa respeitar:** o resto da divisão inteira vai na **última**
parcela (`0013:265-268` — `p_total_cents - base_cents * (p_installments - 1)`). Ou seja
`installment_cents` é o valor da parcela **corrente**, não `total / n` arredondado, e a soma das
parcelas sempre bate exatamente com `total_cents`. A UI mostra "R$ 458,90 por mês" a partir da
parcela real, e no detalhe do plano a última linha pode ter centavos a mais — com uma nota discreta:
*"a última parcela fecha a conta com os centavos da divisão"*. Sem isso a tela vira um relatório de
bug para quem confere no braço.

**Uma pendência de escrita:** `useCreateInstallmentPlan` (`use-finance.ts:380-405`) **não passa
`p_merchant`**, embora a RPC aceite (`0013:230`). Todo plano criado pelo app tem `merchant = null`,
então a coluna que esta tela quer como título nunca é preenchida por ele. Uma linha no hook, um campo
"Estabelecimento" no form (ver `transacao-form.md`).

## Ação primária

**Entender o compromisso.** Não há mutation nesta tela — é leitura pura, e isso é uma decisão: a
única escrita razoável seria "quitar o parcelamento antecipadamente", que no cartão brasileiro é um
pedido ao banco, não um `update` no app.

## Ações secundárias

- Toque no plano → parcelas, com o `status` de cada uma.
- **Context menu nativo** na `Row`: Ver parcelas · Ver no cartão · Ver a primeira compra.
- Toque numa barra de mês → lista de lançamentos filtrada por aquele mês, chip "Previstos" ligado.

## Estados

- **Loading** — `Skeleton` com a forma: card alto + faixa de seis barras + três linhas. O card e a
  lista resolvem independentes (são duas RPCs).
- **Empty — nunca parcelou nada:** ícone `creditcard`, título *"Nenhuma compra parcelada"*, dica:
  *"Quando você lançar uma compra em 10x, ela aparece aqui com quanto falta."* — a dica ensina o
  fluxo em vez de mandar o usuário para o WhatsApp, porque parcelamento não se cria por mensagem.
- **Empty — tudo quitado:** *"Nada parcelado em aberto."* + a seção "Terminadas" já visível. É uma
  boa notícia e a tela diz isso, em vez de mostrar o mesmo vazio de quem nunca usou.
- **Empty — sem parcelas nos próximos meses** (só planos terminados): a faixa de barras some, o card
  de destaque não.
- **Error** — por bloco. Se `installments_load` falhar, o card diz "Não deu para calcular" com
  "Tentar de novo" e **a lista de planos continua na tela**.
- **Conteúdo longo** — nome de loja trunca em uma linha; valor e "3 de 10" nunca truncam.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Valor do card | mudança de estado | conta de/para em `Motion.base`; `tabular-nums` evita salto de largura |
| Barras por mês | mudança de estado | crescem com `withSpring(Motion.spring.settle)`, stagger 40 ms |
| Barra de progresso do plano | mudança de estado | anima quando a parcela é quitada — valor que salta é bug visual |
| Entrada da lista | continuidade | `FadeInDown`, stagger 40 ms, cap 400 ms |
| Press na `Row` | feedback | highlight de fundo, 120 ms |
| Abrir "Terminadas" | continuidade | `LinearTransition` em `Motion.base` |

## Acessibilidade

- `Row` com label completo: *"Geladeira, Magalu, parcela 3 de 10, 458 reais e 90 centavos por mês,
  faltam 3 mil 212 reais e 30 centavos"*. A barra de progresso não é a informação: o texto é.
- Barras por mês com `accessibilityLabel` por barra ("novembro, 1.240 reais em parcelas").
- Progresso com `accessibilityRole="progressbar"` e `accessibilityValue`.
- Valores `selectable` e `tabular-nums`.
- Dynamic Type XL: a faixa de barras vira lista vertical; a `Row` quebra em duas linhas.

## Fora de escopo

- **Criar plano por aqui.** Parcelamento nasce da compra.
- **Editar ou cancelar um plano.** `installment_plans` não tem status, e apagar o plano faz cascade
  nas transações (`0013:142`, `on delete cascade`) — apagar dez linhas de extrato por um toque numa
  tela de leitura é o tipo de destruição silenciosa que não se projeta.
- **Simular quitação antecipada** (com desconto de juros embutidos). O modelo não guarda a taxa da
  compra parcelada — `interest_rate_monthly` é de `debts` (`0023:16`), não daqui. Simular sem taxa é
  inventar número.
- **Juntar parcelado com dívida numa visão só.** São modelos diferentes (`installment_plans` sem
  juros, `debts` com Price); fundir os dois é decisão de produto, não de tela.
- Parcelamento de receita ou de transferência. A RPC só cria `expense` (`0013:274`).
