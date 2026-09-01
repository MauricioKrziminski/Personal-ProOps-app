# Auditoria do app financeiro — liberdade de navegar e de corrigir

> 31/08/2026. Nasceu de um caso real: uma compra de PC gamer em 8x registrada pelo
> WhatsApp **estando na 5ª parcela**. A retroação (agente, etapa 2.8) funcionou e
> criou as 4 anteriores como pagas, em faturas de meses passados — e o app não
> tinha como mostrar nenhuma delas.

As três paredes do relato, e uma quarta que apareceu na conversa:

1. **Cartões** mostrava a fatura de **junho** (vencida há ~82 dias), não a atual.
2. Dentro da fatura **não havia como mudar de mês**, nem para trás nem para frente.
3. Apagar um lançamento parcelado apagava **uma parcela**, sem opção de apagar a compra.
4. As faturas retroativas apareciam como **"Atrasada"** e, na vida real, já tinham
   sido pagas antes de o app existir. Pagá-las pelo botão criaria uma transferência
   e **tiraria dinheiro do saldo de hoje**.

Os três primeiros são sintomas do mesmo desenho: **o app mostra o estado atual e
quase nunca o histórico**, e boa parte do que falta **já existe no banco** sem tela
que leia.

---

## Os 5 achados que explicam "não consigo ver tudo"

**1. Não existe extrato por conta nem por cartão.**
`useTransactions` (`src/hooks/use-finance.ts:135`) aceita `month`, `kind`,
`category`, `recurringId` — e nada mais. `accounts.tsx:234` oferece **"Ver
extrato"** e faz `router.push('/finance/transactions')` **sem parâmetro**: joga o
usuário na lista global do mês corrente. É o filtro mais básico de um app
financeiro e ele não existe.

**2. A fatura é uma janela de um mês, sem portas.**
`_card_summary` (`0013:366-372`) devolvia **só a fatura aberta mais antiga**.
`invoice/[id].tsx` usava o mês apenas como título. E `cards.tsx` **nunca** linkava
para `/finance/invoices`: o histórico só existia atrás de Financeiro → Gerenciar →
"Faturas anteriores" (`manage.tsx:26`). Consequência escrita no próprio código
(`use-finance.ts:1481`): *"paga a fatura, ela some do app"*.
→ **Resolvido na Fase 1.**

**3. Busca global quebrada para lançamentos.**
`search.tsx:143` navega para `/finance/transactions` sem `txId` e sem `month`.
Achar um gasto de março pela busca e tocar nele leva a uma tela onde ele não está.

**4. Parcelamento visível mas não navegável.**
`[txId].tsx` mostrava **"Parcela 3"** — nunca `3/8`, porque o total nunca era lido.
A linha não era pressável e o subtítulo mandava caçar mês a mês.
→ **Resolvido na Fase 1.**

**5. Todo recorte temporal é fixo ou de passo 1.**
`MonthPicker` é `‹ ›` de ±1 mês, em 3 telas. O resto tem janela cravada: 12 meses
em `net-worth.tsx:116`, 6 em `installments.tsx:43`, 3 anos em `reports.tsx:72`,
30/90/180 em `forecast.tsx:57`. Voltar 14 meses = 14 toques.

---

## Dado que o banco já sabe e o app joga fora

| O que existe | Onde | Situação |
|---|---|---|
| `monthly_cashflow(months_back)` — receita×despesa por mês | `0012:68` | RPC pronta, **hook pronto** (`use-finance.ts:198`), **zero telas** |
| `net_worth()` devolve 5 números | `0026:183` | a tela usa **1** (`net_cents`); investimentos, outros bens e passivos: 0 ocorrências |
| `net_worth_snapshots` guarda 5 métricas **por dia** | `0026:81` | `net_worth_series` devolve 2, mensais; a tela mostra 1 |
| `source`, `status`, `due_at`, `merchant`, `debt_id` | `transactions` | exibidos e **não filtráveis** |
| `attachment_path` | `0017:121` | coluna morta: nada escreve, nada lê |
| `expenses_summary` / `expenses_monthly` | `0012:132,148` | zero consumidores em todo o repo |

Quatro agregações rodam **em JS sem RPC** (parceladas, histórico de faturas, lotes
de import) com teto de 5.000 linhas que **lança exceção** em vez de mostrar dado
(`use-finance.ts:1360`).

---

## O que bancos e apps de finanças fazem e aqui faltava

- **Nubank, Itaú, C6** abrem o cartão na **fatura atual** e oferecem `‹ ›` entre
  meses, com as fechadas acessíveis para sempre.
- **Todo internet banking** tem **extrato por conta** com período.
- **Mobills e Organizze** separam "marcar como pago" de "efetivar pagamento" —
  exatamente o caso das parcelas retroativas.
- **YNAB e Monarch** tratam **saldo inicial / reconciliação** como conceito de
  primeira classe. Aqui, dado histórico entrava como dívida em aberto.
- **Nubank** mostra "3/8" com link para as outras parcelas e o total.

---

## Fases

| Fase | Tema | Estado |
|---|---|---|
| **1** | O passado do cartão: fatura atual em destaque, `‹ ›` entre faturas, quitar sem mexer no caixa, apagar plano inteiro, `3/8` com link | **implementada e validada**; `0046` aplicada em staging |
| 2 | Extrato de verdade: filtro por conta/cartão, status e origem; paginação no lugar do `limit(200)`; busca que abre o lançamento certo | pendente |
| 3 | Visões que existem no banco: `monthly_cashflow` na home; patrimônio com os 5 componentes; janelas ajustáveis | pendente |
| 4 | Período livre: seletor com salto de ano; relatórios além de 3 anos; passado na projeção e nas parceladas | pendente |

Cada fase é uma rodada: implementa → personas → valida.

---

## Fase 1 — o que mudou, e as decisões que não são óbvias

**`settle_invoice`** quita a fatura **sem criar transferência**. É o pedido do
caso real: a fatura já foi paga na vida real, e `pay_invoice` tiraria do caixa de
hoje um dinheiro que saiu meses atrás. A RPC também fecha as parcelas `pending` de
dentro — sem isso a fatura ficaria "paga" com lançamentos previstos alimentando
`upcoming_bills` e oferecendo botão "Paguei".

**O saldo do cartão precisou mudar junto.** `account_balances` somava toda
transação do cartão; funcionava porque o único jeito de quitar criava uma
transferência que compensava as compras. Sem transferência, o cartão ficaria
negativo para sempre enquanto Cartões mostrava limite livre — o app se
contradizendo em duas telas. O filtro lê o marcador explícito
`card_invoices.settled_manually`: só `status = 'paid'` também excluiria as compras
do `pay_invoice`, e aí o cartão ficaria POSITIVO. E inferir pela ausência de
`payment_transaction_id` não servia — a coluna é `on delete set null`, então
apagar a transferência faria um pagamento de verdade virar um settle.

**`paid_at` separado de `occurred_at`.** Dar baixa reescrevia a data do
lançamento, então boleto de agosto pago em setembro migrava de mês em todo
relatório e o mês fechado encolhia sozinho.

**A fatura destacada é a corrente**, com faixa de atraso pressável acima. Ressalva
honesta: `reference_month` é o mês do **fechamento**, então com `closing_day` baixo
a fatura destacada pode ser a do mês anterior ainda não paga. É a que precisa ser
paga agora, e o bug original continua resolvido.

**O rótulo do pager e o histórico** — `InvoicePager` anda sobre a LISTA de faturas,
não sobre o calendário: fatura é lista esparsa (mês sem compra não gera fatura, e
parcelamento gera fatura futura), então somar ±1 mês cairia num vazio.

---

## Validação da Fase 1 no simulador (31/08/2026)

iPhone 16 contra o banco de **staging** (`.env.local`), com a `0046` aplicada.
Navegação por deep link (`appproops:///...`), que de quebra exercitou o roteamento.

**Passou:** fatura corrente em destaque com a faixa "2 faturas atrasadas" acima;
`InvoicePager` com as duas setas; na fatura mais antiga a seta de voltar **some**
em vez de virar botão morto; fatura **paga** de maio finalmente alcançável;
"Parcela 1 de 8 · R$ 7.200,00 no total" pressável; dark mode com os tokens certos.

**O deep link para o detalhe de uma parcela de ABRIL funcionou sem `month`** — sob
o código antigo cairia em "esse lançamento não existe mais", porque a tela
procurava dentro da lista do mês corrente. É a prova do reparo em `useTransaction`.

### Dois defeitos encontrados PELO teste, e corrigidos

1. **`invoices.tsx` mostrava só o futuro.** Ela pedia `useCardInvoices(id, 12)` e
   as 12 mais novas eram todas faturas futuras de parcelamento (até 2027): o
   histórico inteiro — o motivo de a tela existir — ficava de fora, sem erro e sem
   aviso. Mudar só o default do hook não bastou; a tela passava 12 explicitamente.
2. **O gráfico mentia e a média estava errada.** "Últimas 12 faturas" desenhava
   2027, e "média das últimas 6" era calculada sobre faturas futuras de R$ 0,00.
   Agora gráfico e média usam só o passado, e as futuras ganharam seção própria —
   não somem (esconder dado é o problema que esta rodada ataca), mas também não
   são "anteriores".

### Não verificado

- **Toques**: "Marcar como paga", duplo toque, apagar plano e desfazer não são
  automatizáveis por deep link. A lógica correspondente foi validada em SQL contra
  o banco real (commit `03c3339`).
- **Dynamic Type**: `simctl ui content-size` não surtiu efeito visível nem após
  relaunch, e nada no código desliga o escalonamento — a conclusão honesta é
  *não verificado*, não *quebrado*.
- **Offline, VoiceOver e Android**: pendentes.

### Achado cosmético, não corrigido

Com faturas de valor igual, as barras do gráfico ficam todas cheias e viram um
bloco preto sólido — o `Sparkline` tem `MIN_SPAN_RATIO` para isso, o gráfico de
barras não. Pré-existente; cabe na Fase 4 (polimento e gráficos).
