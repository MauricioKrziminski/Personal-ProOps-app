# Fatura — `src/app/(tabs)/finance/invoice/[id].tsx`

Hoje em `src/app/finance/invoice/[id].tsx` (243 linhas): resumo, bloco de pagamento com chips de
conta, e a lista de compras. É a tela com a **ação de maior consequência do app** — registrar um
pagamento de fatura cria uma transferência de verdade (`pay_invoice`,
`0013_cards_and_installments.sql:292-342`) — e ao mesmo tempo a que confunde erro com estado
vazio.

## Pergunta que responde

> "O que tem nesta fatura, e como eu marco como paga?"

Duas perguntas, e a ordem importa: ninguém paga sem antes reconhecer o que está sendo cobrado.

## Persona

- **Primária: Jorge, 46** — abre perto do vencimento, confere se tem alguma compra estranha, paga.
- **Secundária: Camila, 34** — desce a lista inteira procurando a compra que não lembra.
- **Casal** — a fatura pode ter compra do outro. A linha precisa dizer de quem foi, ou a tela
  vira discussão.

## O total nunca é materializado

`card_invoices` guarda **só o ciclo** — mês de referência, fechamento, vencimento, status
(`0013:88-103`). O total sai de `sum(transactions.amount_cents) where invoice_id = … and
kind='expense'`, e é assim em **dois lugares independentes**: `_card_summary`
(`0013:361-364`) e `pay_invoice` (`0013:320-322`). Não existe coluna de total, e nunca deve
existir — é o mesmo princípio do saldo de conta derivado.

Consequência direta para esta tela: **o número que ela mostra tem que ser o mesmo que
`pay_invoice` vai cobrar.** Hoje ela soma no cliente (`invoice/[id].tsx:39-41`), sobre as linhas
que o `select` devolveu. Os filtros batem com os do banco (`kind='expense'`), então o valor está
certo hoje — mas é uma soma de cliente sobre uma lista sem `limit` explícito
(`use-finance.ts:344-348`), num produto onde uma fatura de cartão de casal passa de cem linhas
fácil. Um dia o PostgREST corta a lista, a soma silenciosamente encolhe, o botão diz "Paguei
R$ 900" e o banco registra R$ 2.100.

**Decisão:** o total vem do servidor. `invoice_total(p_invoice_id)` **(novo)**, wrapper
`security invoker` com a query inline filtrando `workspace_id in (select
private.my_workspace_ids())`, no padrão de `supabase.md`. A soma do cliente vira só conferência
de desenvolvimento, e o botão de pagar nunca mostra número que o banco não confirmou.

## Entrada e saída

- **Entrada:** `push` de Cartões; do Financeiro (seção Cartões); de "o que vence" na aba Hoje;
  deep link de alerta de vencimento; de `conta-detalhe` do cartão.
- **Saída:**
  - compra → `modal /finance/transaction-form?id=`
  - "faturas anteriores" → `push /finance/accounts/[id]/invoices`
  - pagar → `formSheet` de pagamento, volta para cá com a fatura marcada
- **Back:** pop. Pagar **não** sai da tela: o usuário quer ver o resultado (status "Paga em
  05/09") na tela onde tomou a decisão.

## Anatomia

1. **Header nativo** — título "Fatura de agosto", subtítulo com o nome do cartão. `headerRight`:
   `ellipsis.circle` com Faturas anteriores · Ver cartão.
   Hoje o título é `ScreenHeader title="Fatura"` (`invoice/[id].tsx:73`), fixo: o usuário que
   chegou por deep link não sabe de qual cartão nem de qual mês.
2. **Card de destaque (o único `GlassCard`) — o total**
   Valor grande em `Fonts.rounded`, `tabular-nums`. Acima: estado (`Aberta` · `Fechada` ·
   `Paga`). Abaixo: `fecha 28/08 · vence 05/09` e a contagem de lançamentos.
   Quando paga: linha em `success` "Paga em 05/09" com ícone `checkmark.circle.fill` — hoje é o
   emoji `✅` (`invoice/[id].tsx:96`), emoji na chrome.
3. **Botão de pagar** — ação primária, ancorada, **fora** do scroll da lista. Rótulo com o valor:
   "Paguei R$ 1.230". Abre o `formSheet` de pagamento.
4. **Compras** — `Row`s agrupadas por dia, ordenadas por `occurred_at desc` (já é o caso,
   `use-finance.ts:348`). Cada linha: descrição, categoria, e para parcela `3/12` como marcador
   próprio, não como sufixo do texto. Parcela futura (`status='pending'`) recebe a palavra
   "prevista", não só um sufixo cinza (`invoice/[id].tsx:158`).
5. **Rodapé explicativo, uma linha** — *"O pagamento entra como transferência: as compras já
   contaram como gasto quando foram feitas."* Texto já existe hoje (`invoice/[id].tsx:134-137`)
   e é a melhor frase da tela — ela impede que o usuário lance a fatura como despesa e conte tudo
   duas vezes. Sai de dentro do bloco de pagamento (onde some depois de pago) e vira rodapé
   permanente.

### O `formSheet` de pagamento

Escolha curta, `formSheet` com detents — não um bloco no meio do scroll, e não um `Alert`
(`invoice/[id].tsx:46-66`).

- **Conta pagadora** — `Row`s de contas que guardam dinheiro. A regra de filtro de hoje está
  certa e fica: `type !== 'credit_card'` e não o próprio cartão (`invoice/[id].tsx:36-38`) — que
  é a mesma checagem que `pay_invoice` faz no banco (`0013:316-318`).
  **Pré-selecionar `payment_account_id` do cartão** quando existir (`0013:71`). Hoje o campo
  nunca é preenchido pelo app (ver `contas.md`), e por isso o usuário escolhe a mesma conta todo
  mês.
- **Data do pagamento** — hoje é sempre `localISODate()` (`invoice/[id].tsx:55`); quem paga no
  dia seguinte e registra depois não tem como corrigir. `pay_invoice` já aceita `p_paid_at`
  (`0013:295`).
- **Valor** — só leitura, do servidor. Pagamento parcial não existe no schema: `pay_invoice` paga
  o total e marca `status='paid'`.
- Botão "Paguei R$ 1.230" · haptic `notificationAsync(Success)` no retorno.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Fatura + compras | `useInvoice(id)` (`use-finance.ts:332`) | `['invoice', id]` | `card_invoices` + `transactions` | `transactions` |
| Total | `useInvoiceTotal(id)` **(novo)** → RPC `invoice_total` **(novo)** | `['invoice','total', id]` | `sum(transactions)` no banco | `transactions` |
| Nome do cartão, `payment_account_id` | `useAccounts()` (`use-finance.ts:211`) | `['accounts']` | tabela `accounts` | `accounts` |
| Contas pagadoras | `useAccounts()` | `['accounts']` | tabela `accounts` | `accounts` |
| Pagar | `usePayInvoice()` (`use-finance.ts:361`) | — | RPC `pay_invoice` | — |

**`useAccounts` sem tratamento de erro é o pior defeito da tela.** `invoice/[id].tsx:29`
destrutura só `data`. Quando a query falha, `payers` fica vazio (`:36`) e a tela mostra
*"Cadastre uma conta corrente para registrar o pagamento"* (`:104-107`) — a mesma frase que
mostra para quem realmente não tem conta. Um usuário com cinco contas cadastradas é mandado
cadastrar conta. **São dois estados diferentes e precisam de dois textos:** "não deu para carregar
suas contas · Tentar de novo" e "você ainda não tem conta para pagar · Cadastrar conta".

`useInvoice` invalida em `transactions` (`use-finance.ts:333`), não em `card_invoices`: uma
mudança de status vinda do `finance-scheduler` (fechamento da fatura) não chega sozinha. Somar
`useRealtimeInvalidate('card_invoices', ['invoice'])` é uma linha.

## Ação primária

**Registrar o pagamento.** É a ação de maior consequência do app: cria uma transferência real e
muda o patrimônio (`private.net_worth_now` conta fatura não paga como passivo,
`0028_cash_includes_accountless.sql:71-73`).

Por isso: confirmação com o valor e a conta escritos por extenso, feedback háptico no resultado,
e **erro visível** — `pay_invoice` levanta exceção em quatro casos (fatura não encontrada, já
paga, conta pagadora = o próprio cartão, fatura sem lançamentos, `0013:310-326`). Hoje todos
viram a mesma frase "Não deu para registrar. Tenta de novo." (`invoice/[id].tsx:140`). "Fatura já
paga" e "fatura sem lançamentos" não são falhas de rede e não se resolvem tentando de novo:
mapear pela mensagem e dizer o que aconteceu.

## Pagar uma parte (09/09/2026)

`pay_invoice` só sabia pagar o valor cheio, e a vida do dono do produto não é assim: em setembro
ele pagou R$ 2.080,00 em 04/09 e mais R$ 809,00 em 08/09 de uma fatura de R$ 3.271,77, ficando
com R$ 371,67 no rotativo. Não havia como registrar isso — e é literalmente o que ele pediu:
*"estou sentindo falta de pagar as coisas parcialmente ... seria mais fatura e o que mais fizer
sentido pagar parcialmente"*.

### O que a fatura passa a guardar

**`card_invoices.paid_cents`**, somado a cada pagamento. É a ÚNICA coisa materializada aqui, e a
exceção é deliberada: a regra "o total nunca é materializado" existe porque o total é uma soma de
linhas que o usuário edita o tempo todo, então uma cópia derivaria. Pagamento não é isso —
ninguém edita um pagamento por fora, e o único caminho de escrita é `pay_invoice`.

A alternativa derivada seria marcar a transferência com `invoice_id` e somar. Não dá: o trigger
`set_invoice` (`0013:175-188`) **zera `invoice_id` de qualquer linha cuja conta não seja cartão**,
e a conta da transferência de pagamento é a PAGADORA. Fazer a transferência ser exceção dentro
desse trigger é carvar um desvio no caminho por onde passa toda linha de cartão do app, para
economizar uma coluna.

### Quanto a fatura ainda deve

`private.invoice_open_cents(invoice_id)` = soma das compras − `paid_cents`. Um lugar só, porque
**oito funções calculavam isso inline** — `_card_summary`, `_upcoming_bills`,
`_cash_flow_forecast`, `_alerts_to_send`, `net_worth`, `month_lines_for`, `month_summary_for` e
os wrappers de cada uma. Pagamento parcial que não passe por todas produz a contradição que a
`0046 §4` descreve: o saldo do cartão diz −371,67 e a tela de Cartões diz −3.271,77.

⚠️ **`invoice_total_cents` continua sendo a soma das compras**, não o que falta. É o valor de face
da fatura — o número impresso no PDF —, e trocá-lo por "o que falta" faria a tela de Cartões
mentir sobre o que foi cobrado.

### Juros e IOF de rotativo não são modelados

Eles chegam como duas despesas comuns na fatura seguinte (`Juros de rotativo R$ 54,07` e
`IOF de rotativo R$ 2,13` estão assim na fatura de setembro). Modelar juros aqui seria reimplementar
no app uma conta que o emissor já fez e já cobrou — e que o app não tem como conferir.

### Na tela

- O sheet de pagamento ganha **campo de valor**, pré-preenchido com o que falta. Pagar tudo
  continua sendo um toque: o valor já vem certo.
- Fatura com `paid_cents > 0` e ainda em aberto mostra **"Pago R$ X · Falta R$ Y"** abaixo do
  total, e o botão passa a dizer o que falta.
- `settle_invoice` (quitação histórica sem caixa) continua existindo e não mexe em `paid_cents`:
  são coisas diferentes — uma é dinheiro que saiu, a outra é dado antigo.
- **O WhatsApp alcança os dois desde 09/09/2026.** "paguei 800 da fatura do nubank" é `pay_invoice`
  (parcial, com transferência); "quita a fatura do nubank sem caixa" / "já estava paga" é
  `mark_paid` com a FATURA como alvo, que chama `settle_invoice`. Não deu para criar um tipo de
  ação novo — `FinanceAction` está no teto medido de 252/32 — e o verbo já era o mesmo de dar
  baixa. A confirmação escreve *"marcar como paga, SEM tirar do caixa"*, porque as duas terminam
  com a fatura paga e mexem no caixa de forma diferente. `scripts/probe_settle_vs_pay.py` mede
  que as redações não se cruzam.

**Fora de escopo:** pagamento parcial de conta a pagar avulsa. O pedido foi sobre fatura, e conta
avulsa já tem "Paguei" que resolve o caso comum.

## Ações secundárias

- Context menu na compra: Editar · Mudar categoria · Apagar (action sheet).
- Menu do header: faturas anteriores · ver cartão.
- **Desfazer o pagamento** — não existe hoje e é o arrependimento mais previsível da tela. Fica
  registrado como pendência: exige `unpay_invoice` **(novo)** apagando a transferência
  (`payment_transaction_id`, `0013:99`) e voltando `status`/`paid_at`. Fora do escopo desta
  entrega, mas o dado necessário já está guardado.

## Estados

- **Loading** — `Skeleton` com a forma: bloco alto + botão + cinco linhas.
- **Empty (fatura sem lançamento)** — `EmptyState` ícone `doc.text`, "Nenhuma compra nesta
  fatura", dica: *"Compras no cartão caem aqui sozinhas — é só mandar `paguei 80 no mercado no
  Nubank` no WhatsApp."* O botão de pagar **não aparece**: `pay_invoice` recusa
  (`0013:324-326`). Hoje a condição `total > 0` (`:101`) já cobre isso, e é para manter.
- **Empty diferente: sem conta pagadora cadastrada** — no `formSheet`, com botão "Cadastrar
  conta".
- **Error de fatura** — inline, com "Tentar de novo".
- **Error de contas** — dentro do `formSheet`, texto próprio (ver Dados). Nunca reaproveitar o
  texto de empty.
- **Fatura paga** — a tela continua útil: card em `success`, sem botão, com "Ver a transferência"
  levando ao lançamento de pagamento.
- **Conteúdo longo** — fatura com 200 linhas: lista virtualizada (`FlatList`, como
  `transactions.tsx` já usa), cabeçalho por dia fixo, botão de pagar ancorado fora do scroll.
  Hoje tudo é `ScrollView` com um `GlassCard` por linha (`invoice/[id].tsx:146-164`) — N blurs
  empilhados, cada um caro.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Total | mudança de estado | conta de/para em `Motion.base`, `tabular-nums` |
| `formSheet` de pagamento | continuidade espacial | `Motion.spring.sheet` (teve dedo → mola) |
| Confirmação do pagamento | mudança de estado | card faz cross-fade para o estado "Paga" em `Motion.base`; haptic `notificationAsync(Success)`; botão some com `LinearTransition` |
| Entrada das linhas | continuidade | `FadeInDown`, stagger 40 ms, cap 400 ms (já existe, `invoice/[id].tsx:149`) |
| Press em `Row` | feedback | highlight de fundo, 120 ms |
| Botão pagando | feedback | rótulo troca para "Registrando…" e o botão desabilita, sem spinner de tela cheia (já é assim, `:131`) |

## Acessibilidade

- Botão de pagar com label completa: "Pagar fatura do Nubank, mil duzentos e trinta reais, com a
  conta Itaú". Um botão que só diz "Paguei" não descreve uma ação irreversível.
- Estado da fatura como texto, sempre — `Aberta`/`Fechada`/`Paga` (`STATUS_LABEL`,
  `invoice/[id].tsx:19-23`, já correto) e nunca só por cor.
- "Parcela prevista" dita na label da linha.
- Valores `selectable` e `tabular-nums`.
- Dynamic Type XL: o botão ancorado cresce e quebra em duas linhas; nunca trunca o valor.
- Alvos ≥ 44pt nas `Row`s de conta pagadora dentro do sheet.

## Fora de escopo

- **Pagamento parcial.** `pay_invoice` paga o total e marca `paid` — pagamento parcial exigiria
  modelo novo (`card_invoices.paid_cents`) e é decisão de produto, não de tela.
- **Pagar de verdade** (Pix, boleto, banco). O app **registra**, não paga.
- **Recalcular ciclo aqui.** É do banco (ver `cartoes.md`).
- **Contestar/marcar compra como não reconhecida.** Não existe coluna, e inventar estado que não
  chega em lugar nenhum é pior que não ter.
- Fatura de mês passado: `faturas-historico.md`.
