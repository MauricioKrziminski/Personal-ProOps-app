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
| **2** | Extrato de verdade: filtro por conta/cartão, status e origem; paginação no lugar do `limit(200)`; busca que abre o lançamento certo | **implementada e validada** (iOS + Android, claro e escuro) |
| **3** | Visões que existem no banco: `monthly_cashflow` na home; patrimônio com os 5 componentes; janelas ajustáveis | **implementada e validada** (iOS + Android, claro e escuro); `0047` e `0048` em staging |
| **4** | Período livre: seletor com salto de ano; relatórios além de 3 anos; passado na projeção e nas parceladas | **implementada e validada** (iOS + Android, claro e escuro) |

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

### Segunda rodada de validação — toques reais (31/08/2026)

Feita com `idb` (toque em coordenadas de dispositivo), no iPhone 16 contra staging.

**Apagar a compra inteira** — plano descartável criado em staging, toque longo abriu
o menu com a ação, a confirmação nomeou o estrago ("Some as 6 parcelas … R$ 600,00
no total — de todos os meses. Isso não volta."), **Cancelar não apagou nada**, e
confirmar apagou o plano e as 6 parcelas por cascade. Verificado no banco.

**Marcar como paga (sem mexer no saldo)** — menu do header abriu com as duas ações;
a confirmação explicou o efeito; o resultado no banco foi `status=paid`,
`settled_manually=true`, `payment_transaction_id=null`, e a dívida saiu do saldo do
cartão (−1.340.000 → −1.250.000). A tela virou "Paga em 31/08/2026" e o botão
"Paguei" sumiu. **Revertido depois** — quitar a fatura do usuário é decisão dele.

**VoiceOver (parcial)** — as setas do pager anunciam o destino: "Fatura anterior,
Junho de 2026" / "Próxima fatura, Agosto de 2026".

### Achado de acessibilidade a investigar

O botão `…` do header **não aparece na árvore de acessibilidade** lida pelo `idb`,
embora o botão "voltar" apareça em outras telas — tive que tocar por coordenada.
Pode ser limitação do `idb` com a barra de navegação nativa, ou o leitor de tela
também não alcançar, e aí "Marcar como paga" seria inacessível por VoiceOver.
**Não determinado.** Vale um teste com o VoiceOver de verdade antes da Fase 2.

### Bloqueado por login: Android

O app sobe no emulador (`s26`, Android 16) com o bundle atual e renderiza o login,
mas entrar exige o OTP no WhatsApp do dono da conta. **Android segue não testado** —
e é o gap mais relevante que resta, porque `HeaderMenu` e `ItemLink` têm caminhos
de código diferentes lá (context menu do iOS vs. sheet do Android).

### Android — validado (31/08/2026)

Emulador `s26` (Android 16), mesmo bundle, mesmo banco de staging. Os dois caminhos
que **só existem no Android** foram exercitados:

- **`HeaderMenu` via `headerRight`** (no iOS é `Stack.Toolbar`): o menu abre sheet
  com "Ver todas as faturas" e "Marcar como paga (sem mexer no saldo)", mais título
  e "Cancelar" — o desenho da plataforma, não uma cópia do iOS.
- **`ItemLink` com toque longo → sheet** (no iOS é context menu nativo): abriu com
  as quatro ações do plano, incluindo "Apagar a compra inteira".
- **`confirmDestructive` → diálogo nativo** com botões em CAIXA ALTA, como manda o
  Material. Cancelar não escreveu nada (conferido no banco); confirmar apagou o
  plano e as 3 parcelas por cascade.
- **Ícones**: as variantes Material renderizaram (nenhum `circle` genérico), o que
  exercita o mapa SF → Material do `Icon`.
- **Dark mode**: correto, com os tokens do tema escuro.

### Offline (persona da Bia) — validado

Com wifi e dados desligados, a tela mostrou **"Não deu para carregar esta fatura."**
com "Tentar de novo", a fatura continuou `Aberta`, e o banco ficou intacto
(`open`, `settled_manually=false`, `paid_at=null`). Nenhuma escrita silenciosa.

### O que segue sem verificação

- **VoiceOver de verdade** (só o rótulo das setas do pager foi conferido, via idb).
- **Dynamic Type**: `simctl ui content-size` não surtiu efeito nem após relaunch.
- O botão de menu do header não aparece na árvore de acessibilidade do `idb` no
  iOS — não determinado se é limitação da ferramenta ou se o leitor de tela também
  não alcança.

---

## Fase 2 — o que mudou, e as decisões que não são óbvias

**Achados 1 e 3 fechados.** `accounts.tsx` passa `accountId` (a linha inteira e a ação "Ver
extrato"), e a busca global abre `/finance/[txId]` em vez de despejar o usuário na lista do mês
corrente. O detalhe por id já funcionava desde a Fase 1 — foi o que o deep link de abril provou.

**O extrato de uma conta inclui a transferência RECEBIDA.** Uma transferência A→B guarda
`account_id = A` e `counterparty_account_id = B`. Filtrar só `account_id` deixaria o extrato de B
sem o dinheiro que ENTROU — um extrato que esconde entrada não é extrato. O filtro é
`or=(account_id.eq.X,counterparty_account_id.eq.X)`.

**"Sem conta" é `NO_ACCOUNT = 'none'`, exportado de `use-finance.ts`.** `null` não viaja por
parâmetro de rota, e a sentinela literal escrita nas duas pontas (quem navega e quem lê) diverge
na primeira renomeação.

**A busca da tela saiu do cliente e foi para o banco.** Ela filtrava o array já carregado; com
paginação isso ficaria PIOR que antes — buscaria dentro de uma página de 50 em vez das 200 linhas
de então. Usa `toIlikeTerm` (`src/lib/search.ts`), o mesmo saneamento da busca global: sem ele uma
vírgula digitada vira separador de condição do PostgREST e a query volta **400
`failed to parse logic tree`** — confirmado contra o staging. Duas telas que buscam lançamento
precisam achar a mesma coisa; agora é o mesmo código nas duas.

**Dois `.or()` na mesma query são AND entre si.** `supabase-js` faz `append` no `searchParams`, e
o PostgREST combina parâmetros repetidos com AND — conferido no endpoint real (a query completa
volta 401 da RLS, ou seja, foi PARSEADA; a versão com vírgula crua volta 400 de sintaxe).

**A ordenação ganhou `id` como desempate.** `(occurred_at, created_at)` empata em lote de
importação e em parcelas criadas juntas. Sem terceiro critério a ordem pode mudar entre a página 1
e a 2, e aí uma linha some da lista enquanto outra aparece duas vezes.

**O card de sobra do mês SOME quando há filtro de conta.** `transactions_summary` não recebe conta:
o número seria do mês inteiro, de todas as contas, em cima de uma lista de uma conta só — o app se
contradizendo dentro da mesma tela. Preferi esconder a acrescentar `account_id` no par
interna/wrapper da RPC; se a Fase 3 precisar do total por conta, é ali que ele entra. O título da
tela vira o nome da conta, então o recorte fica dito em algum lugar.

**Conta e origem são SUBMENU do `…`, não chips no corpo.** Com oito contas cadastradas uma fileira
de chips vira o conteúdo da tela. `ItemAction` já suporta submenu nas duas plataformas (menu
aninhado no iOS, segundo sheet no Android) — é o mesmo desenho do "mudar de pasta" das notas. O
filtro ATIVO aparece como pílula limpável no corpo, junto da de categoria que já existia.

**`arrow.triangle.branch` (ícone de "Origem") entrou no mapa SF → Material** como `call_split`.
O `icon-map.test.ts` pegou a falta antes de o Android renderizar um `circle` genérico — é a
terceira vez que esse teste paga o próprio custo.

### Validação da Fase 2 (31/08/2026)

iPhone 16 (iOS 26.5) e emulador `s26` (Android 16), mesmo bundle, banco de staging.

**Extrato por conta** — "Ver extrato" do Nubank abre com o nome da conta no título, o card de
sobra do mês AUSENTE e a pílula "conta: Nubank". Trocando para o cartão pelo submenu, as duas
`Pagamento da fatura` continuam aparecendo: elas têm `account_id = Nubank` e
`counterparty_account_id = cartão`, ou seja, **é o ramo do `.or()` que está sendo exercido** — o
filtro ingênuo teria escondido as duas. O total do dia (−R$ 800,00) ignora as transferências,
como manda a regra.

**"Sem conta"** (a sentinela `NO_ACCOUNT`) devolveu exatamente os dois lançamentos de WhatsApp sem
conta, +R$ 250 e −R$ 45 — que somam os R$ 205,00 que a tela Contas mostra. O ramo
`is('account_id', null)` está certo.

**Busca no banco** — "gamer" achou `pc gamer (5/8)` com o filtro de conta ATIVO, o que prova os
dois `.or()` convivendo numa query só. **"gamer, tv" (com vírgula) devolveu estado vazio, não
erro** — `toIlikeTerm` fez o trabalho; sem ele seria 400.

**Busca global** — tocar em `pc gamer (7/8)` (30/10/2026, mês FUTURO) abriu o detalhe do
lançamento. Sob o código antigo isso caía na lista de agosto, onde o item não está. Achado 3
fechado.

**Paginação** — não há mês com mais de 50 lançamentos no staging, então o teto foi baixado para 2
temporariamente: rolar carregou as páginas seguintes na ordem certa, **sem repetir e sem pular
linha**, e o total do dia se corrigiu conforme as linhas chegaram. Com o teto de volta em 50 e o
app reiniciado, o mês inteiro volta numa página só. (Detalhe do teste: trocar a constante com o
Fast Refresh ligado NÃO refaz a query — as páginas em cache continuam com o tamanho antigo e a
lista parece completa com 2 linhas. É preciso reiniciar o app.)

**Android** — os dois caminhos que só existem lá: o `HeaderMenu` virou sheet "Mais opções" com
`Conta…` e `Origem…`, e cada um abriu um SEGUNDO sheet com o check na opção ativa. Ícones nas
variantes Material, nenhum `circle` genérico.

**Dark mode** conferido nas duas plataformas: pílulas, segmented, linhas e FAB com os tokens do
tema escuro.

**Offline (persona da Bia)** — app carregado, DEPOIS wifi e dados desligados: o extrato mostra
skeleton enquanto o TanStack retenta e então assenta em **"Algo deu errado · Não conseguimos
carregar os dados agora"** com "Tentar de novo". Nada de lista vazia se passando por "esse mês não
teve nada", nada de dado velho, nenhuma escrita. Religando a rede, "Tentar de novo" trouxe o
extrato de volta. (Desligar a rede ANTES de abrir o app não testa nada: derruba o Metro e o build
de desenvolvimento nem carrega o bundle.)

### O que ainda não foi verificado

- Segue valendo o que a Fase 1 deixou aberto: **VoiceOver de verdade** e **Dynamic Type**.
- Com dois filtros ativos e lista vazia, o botão "Limpar filtros" fica **encostado no FAB
  "Lançar"**. Não se sobrepõem, mas é o mesmo canto. Cabe na Fase 4.

### Para o backlog (visto no teste, fora do escopo da Fase 2)

- **Deep link não reaplica filtro em tela já montada.** `appproops:///finance/transactions` caiu
  na instância que já estava filtrada por conta, porque os filtros nascem de
  `useState(params.X)` — o mesmo padrão que `month`, `kind` e `category` já usavam. `router.push`
  de dentro do app monta tela nova, então nada quebrou; só passa a importar se
  `notifications.ts:41` um dia levar parâmetro.
- **Transferência aparece sem sinal no extrato de UMA conta.** `signed={tx.kind !== 'transfer'}` é
  regra da lista global, onde transferência não é entrada nem saída. No extrato do Nubank as duas
  saídas de R$ 900,00 aparecem sem o "−", com total do dia R$ 0,00. Direção relativa à conta é
  assunto de Fase 3/4, não do achado 1.

---

## Fase 3 — o que mudou, e as decisões que não são óbvias

A fase existia para gastar dado que o banco já guardava e nenhuma tela lia. Ligar esse dado
revelou que ele estava **errado** em dois lugares — os dois invisíveis enquanto ninguém desenhava
o resultado. Foi o achado mais caro da rodada, e é o argumento contra deixar RPC pronta sem
consumidor: função sem tela não é função pronta, é função não testada.

### `monthly_cashflow` estava com escopo e janela errados (`0048`)

Três defeitos numa função de 2005 linhas de idade que a auditoria já tinha marcado como "zero
consumidores":

1. **Não havia limite SUPERIOR** — só `occurred_at >= início`. Toda parcela FUTURA entrava:
   `monthly_cashflow(6)` devolvia **14 meses**, até 2027, porque compra em 8x cria uma linha por
   mês à frente. É literalmente o mesmo defeito que a Fase 1 corrigiu em `invoices.tsx`
   ("últimas 12 faturas" desenhando 2027). Parcelamento sempre povoa o futuro, e **todo gráfico
   de passado precisa dizer isso na query** — não no rótulo.
2. **O escopo era `user_id`, não `workspace_id`.** `user_id` é o AUTOR do lançamento; desde a
   `0010` o dado pertence ao workspace. Num workspace compartilhado esta função mostraria só o
   que VOCÊ lançou enquanto `transactions_summary`, na MESMA tela, soma o workspace inteiro —
   dois números do mesmo mês que não batem.
3. **`months_back` sem trava**, diferente de todas as outras janelas do schema (1..60).

### `net_worth_series` ignorava workspace e escondia 3 das 5 métricas (`0047`)

`distinct on (mês)` escolhia UMA linha por mês entre TODOS os workspaces do usuário. Quem
participa de dois via a curva de um deles enquanto o número de hoje — que sai de `net_worth()`,
que SOMA — trazia os dois. Agora é a última foto de cada `(workspace, mês)` e `sum()` por mês, a
mesma conta do herói.

Junto, as 3 colunas que a tabela guardava desde a `0026` e a função não devolvia
(`cash_cents`, `investments_cents`, `other_assets_cents`). `create or replace` **não muda coluna
de retorno** ("cannot change return type"), então foi drop + create, com as colunas antigas no
mesmo nome e na mesma posição — bundle velho em campo ignora as novas.

### O corte do futuro é feito DUAS vezes, de propósito

A `0048` fecha a janela no banco, mas o **Postgres roda em UTC**: às 22h de Brasília o
`current_date` do servidor já virou o dia seguinte, e no fim do mês isso deixa passar um balde do
mês QUE VEM — com barra e tudo, num gráfico cujo título é sobre o passado. Foi visto acontecendo
no simulador às 22:30 de 31/08. A segunda trava é no cliente, com `localISODate()`, exatamente a
defesa que `invoices.tsx` já usava. **A convenção `current_date` é do schema inteiro** (projeção,
patrimônio, alertas): trocar isso é decisão de outra rodada, não conserto de um bloco.

### A composição do patrimônio mostra as quatro parcelas, inclusive as zeradas

Caixa + investimentos + outros bens − passivos. Linha com R$ 0,00 **fica**: é ela que diz "você
não cadastrou investimento nenhum", e esconder uma parcela faria a soma não fechar aos olhos de
quem confere. Validado no simulador: `10.405 + 0 + 0 − 13.400 = −2.995`, o valor do herói.

### As barras são uma cor com duas intensidades, não duas cores

`entrou`/`saiu` é comparação, não estado a resolver. Gastar `success`/`danger` ali queimaria a
última alavanca de cor que um app monocromático tem, para decorar. O par é `tint` cheio contra
`tint` a 35% — a mesma solução do gráfico de faturas — mais **legenda em palavra**, que é o que
funciona sem enxergar cor.

**Barra de valor ZERO desenha nada.** O piso de `Space.xs` (herdado do gráfico de faturas) vale só
para valor que existe: com o piso aplicado ao zero, todo mês sem receita ganhava um tracinho, e um
tracinho lê como "entrou um pouquinho". Mesmo princípio do "previsto R$ 0,00" que o painel não
escreve.

### Um rótulo de mês, não quatro

`mesLabel` (Patrimônio) e `mesCurto` (Parceladas) eram a mesma função copiada, e a tendência ia
criar a terceira cópia. Viraram `monthShort`, ao lado de `monthLabel`/`monthTitle` — um mês, três
comprimentos. O primeiro desenho da tendência usava `monthLabel` e o eixo saiu com
"agosto de 2026" quebrando **uma letra por linha**.

### Validação (31/08/2026)

iPhone 16 e emulador `s26`, claro e escuro, contra o staging com `0047` e `0048` aplicadas.

**Passou:** composição somando o herói exatamente; tendência com 5 meses reais (abr–ago), rótulos
curtos, mês sem receita sem barra preta, legenda legível; alternância 6/12 meses refazendo a
query; ícones em variante Material no Android (nenhum `circle` genérico); dark mode nos dois.

**Offline (persona da Bia) — e um defeito encontrado por ele.** Com o app carregado e a rede
derrubada depois, a composição continuava exibindo os quatro valores com toda a confiança
LOGO ABAIXO da faixa "Não deu para calcular seu patrimônio". Causa: o `data` do TanStack
**sobrevive ao erro de refetch**, e o bloco só checava `hoje`, não `patrimonio.isError`. A tela se
contradizia em dois blocos que leem a MESMA query. Corrigido — a seção que falhou já diz que
falhou, e quem depende dela some em vez de fingir que tem número. Religando a rede, "Tentar de
novo" traz herói e composição juntos. (A tendência da home já estava certa: ela testa `isError`
antes de desenhar.) Detalhe do teste: derrubar a rede ANTES de abrir o app não serve — cai o
Metro, e o Fast Refresh de uma correção também não chega ao device offline.

**Não observável no staging:** o seletor de janela do Patrimônio (6/12/24). Ele mora DENTRO do
cartão da curva, que só existe com 2+ fotos, e o staging tem uma só. A `queryKey` do
`useNetWorthSeries` inclui `monthsBack` (conferido no código), que é o que faz a troca refazer a
query — a mesma fiação exercitada na tendência da home.

**Escritas mas ainda não desenhadas:** as 3 colunas novas de `net_worth_series`. A `0047` as expõe
porque a assinatura já estava aberta — abrir de novo custaria outro drop. Componente ao longo do
tempo é assunto de outra fase.

### Nota de deploy

**Produção e staging estão em dia** (31/08/2026). Produção estava na `0042` — não na `0037`, como
a suposição anterior dizia —, então o que faltava era `0043`..`0048`, aplicadas depois da
validação. Tudo aditivo: coluna nova anulável, tabela nova e troca de função. As duas únicas
escritas em tempo de migration são inofensivas — o backfill da `0046` escreve só em `paid_at`, que
nasce nessa mesma migration, e a limpeza da `0044` roda sobre `draft_actions`, criada vazia na
`0043` do mesmo push.

⚠️ O `supabase link` do repo aponta para **PRODUÇÃO**: `db push --linked` vai para lá, e staging
exige `--db-url` com a `DATABASE_URL` do `agent/.env` (que é o staging). Conferir o alvo antes de empurrar
continua sendo obrigação de quem empurra.

---

## Fase 4 — o que mudou, e as decisões que não são óbvias

Fecha o achado 5 ("todo recorte temporal é fixo ou de passo 1") e os dois itens cosméticos que as
fases anteriores estacionaram aqui. **Nenhuma migration:** é tudo tela.

### O salto de ano mora no `MonthPicker`, e as três telas herdam

O título do mês virou a porta: toca e abre um sheet com passo de ANO e grade de 12 meses. Voltar
catorze meses passou de **catorze toques para três** — medido no simulador, de agosto/2026 para
março/2025. Como a decisão está no primitivo, Lançamentos, Orçamentos e o painel do Financeiro
ganharam junto, sem uma linha de tela.

Sheet feito à mão em vez de biblioteca de picker: nenhuma está aprovada no projeto — a mesma
decisão que o `Segmented` já registra. **Sem teto de ano**, igual às setas, que sempre andaram sem
trava; um limite aqui seria a única fronteira do app que o usuário descobre batendo nela.

### Relatórios: os anos vêm do dado

Eram três fixos (`anoAtual - 2`), então quem usa o app há mais tempo não alcançava o próprio
passado e quem começou ontem via dois anos vazios oferecidos como se tivessem conteúdo. Agora saem
do lançamento mais antigo. Viraram **chips roláveis**, não `Segmented`: o segmentado divide a
largura em partes iguais e quebra a partir de ~4 opções, e a lista agora cresce com o uso. **Com um
ano só a fileira some** — seletor de uma opção não seleciona nada, e o ano já está escrito no
destaque e no título de Bens e Direitos. Mesma régua do badge de aba.

### Parceladas: a faixa cobre o plano inteiro

Este é o caso que originou a auditoria — compra em 8x lançada JÁ na 5ª parcela — e a tela ainda
não mostrava as quatro parcelas passadas. **A causa não era o gráfico, era o dado:** `porMes`
nascia com dois filtros (`status = 'pending'` e `mes >= hoje`), então o passado saía antes de
chegar na faixa. Agora o mapa carrega o plano inteiro, a faixa rola e abre no mês corrente, e as
parcelas pagas aparecem mais fracas.

`comprometido` e a média **continuam olhando só para a frente** — passaram a ler as parcelas
direto em vez de herdar o mapa, porque esse número tem dois recortes que a faixa não tem. Os dois
valores da tela não mudaram depois da mudança, que era o resultado desejado.

### O bloco preto sólido era o EMPATE, não a escala

O achado cosmético parado desde a Fase 1 ("barras de valor igual viram um bloco preto") tinha uma
causa diferente da suposta. Não é falta de `MIN_SPAN_RATIO`: em barra medida a partir do zero,
valores iguais **devem** dar barras iguais — encolher isso faria o gráfico mentir. O que produzia o
bloco era o destaque: parcela é o total dividido igual, então três meses empatavam no máximo e os
três saíam em `tint`. Agora o accent só marca o mês mais pesado quando existe **um**.

### Transferência ganha sinal no extrato de uma conta

Na lista global transferência não tem sinal — não é entrada nem saída do conjunto. No extrato de
UMA conta tem: sai da origem, ENTRA no destino. As mesmas duas transferências de R$ 900,00 agora
aparecem **−R$ 900,00 no Nubank e +R$ 900,00 no cartão**, e o total do dia continua ignorando
transferência.

### A projeção mostra o passado antes do dia de hoje

Sai de `net_worth_snapshots`, cujo `cash_cents` é o mesmo `private.cash_total` em que a projeção se
ancora — por isso as duas pontas se encontram em vez de dar um degrau. A foto de HOJE é descartada
(o cron a tirou de madrugada; o dia 0 da projeção já é o valor de agora). A soma por dia é
obrigatória: dois workspaces têm duas fotos por data, e é exatamente o defeito que a `0047`
corrigiu no banco — não vale reintroduzi-lo no cliente.

No `Sparkline`, `pastCount` divide a linha: passado a 35%, futuro cheio, marcador vertical no hoje.
`0` (padrão) desenha exatamente o que desenhava antes, então as outras três telas não mudaram.

### O FAB cobria o botão do estado vazio

Visto no simulador: "Ver Fevereiro de 2025" cortado ao meio pelo "Lançar". Nos dois estados vazios
que oferecem BOTÃO o FAB sai — não há lista para completar e a oferta da tela é a do estado vazio.
Ele fica no "nenhum lançamento ainda", cuja dica manda tocar justamente nele.

### Validação (31/08/2026)

iPhone 16 e emulador `s26`, claro e escuro, contra o staging.

**Passou:** salto de agosto/2026 → março/2025 em três toques; grade com o mês corrente marcado, nas
duas plataformas e nos dois temas; faixa das parceladas cobrindo abril/2026 → maio/2027 com as
quatro passadas rotuladas "já passou" e rolagem abrindo no mês corrente; empate sem bloco preto;
transferência com sinal oposto nas duas pontas; ano único escondendo a fileira de chips; FAB
liberando o botão do estado vazio.

**Verificado com série sintética:** o corte passado/futuro do `Sparkline`. O staging tem UMA foto
de patrimônio, então o trecho passado não aparece com dado real — o caminho de desenho foi
exercitado injetando 30 pontos temporariamente, como o teto de página foi na Fase 2.

### Três defeitos que o teste offline encontrou (e um sistêmico)

Pelo terceiro ciclo seguido, a passada offline achou bug — e sempre o MESMO: **o `data` do TanStack
sobrevive ao erro de refetch**, então a seção continua afirmando números embaixo da faixa que
acabou de dizer que falhou. Na Fase 3 foi a composição do patrimônio; aqui foram **Relatórios**
("Para onde foi" e "De onde veio" intactos sob "Algo deu errado") e **Projeção** ("Atrasado"
oferecendo "Pagar fatura" — um botão que ESCREVE no banco — sob a faixa de erro). Os dois
corrigidos.

> **Isto virou padrão, não coincidência.** Toda seção que lê uma query precisa checar `isError`,
> não só `data`. Vale uma varredura própria: o app tem dezenas de blocos com essa forma e só três
> foram auditados. O teste offline de Relatórios foi conferido depois do conserto; o da Projeção
> pegou a tela no meio do refetch e ficou **inconclusivo** — o código é o mesmo dos outros dois.

### Achado sistêmico: sheet sob a status bar no Android

`presentationStyle="pageSheet"` desce sozinho no iOS; no Android o `Modal` ocupa a tela inteira e o
cabeçalho nasce **por cima do relógio e dos ícones de bateria**. Em Patrimônio isso deixava o
**"Salvar" atrás do ícone de wifi** — ação primária inalcançável. Corrigido no sheet novo e em
Patrimônio.

**Faltam oito telas com o mesmo padrão:** `import`, `notes/[id]`, `goals`, `rules`, `budgets`,
`debts`, `accounts`, `recurring` e `invoice/[id]`. Não foram tocadas porque nenhuma entrou nesta
rodada e o conserto certo é um primitivo `Sheet` compartilhado, não nove cópias de
`paddingTop` — é trabalho próprio, com validação própria.

### O que segue aberto no app inteiro

Tudo o que esta seção listava foi fechado na rodada de limpeza logo abaixo.

---

## Rodada de limpeza — as pendências das quatro fases (01/09/2026)

Fechou o que as fases deixaram em aberto. Duas varreduras, um backlog e as duas verificações de
acessibilidade que nunca tinham sido feitas.

### `Sheet`: treze cópias viraram um primitivo

`presentationStyle="pageSheet"` desce sozinho no iOS; no Android o `Modal` ocupa a tela inteira e
o cabeçalho nasce **por cima do relógio**. Em Patrimônio isso deixava o **"Salvar" atrás do ícone
de wifi** — ação primária inalcançável num sheet que grava no banco.

Existiam TREZE cópias do mesmo par `<Modal><View style={[styles.sheet, …]}>`, uma por tela, todas
com o mesmo defeito. Consertar treze vezes era garantir que a décima quarta tela nascesse errada.
Agora é `src/components/ui/sheet.tsx`, e a migração **deletou 142 linhas líquidas**. O primitivo
envolve só a moldura: cabeçalho, rolagem e teclado continuam sendo decisão de cada tela, porque
são diferentes de verdade entre um form de conta e uma lista de tags.

Verificação: `presentationStyle` só existe dentro de `sheet.tsx`; um sheet conferido no Android
(cabeçalho abaixo do relógio) e um no iOS (idêntico ao de antes, sem respiro dobrado).

### `isError`: onze telas mostravam dado velho sob a faixa de erro

O bug que apareceu em três fases seguidas, agora varrido de ponta a ponta. **O `data` do TanStack
sobrevive ao erro de refetch**, então a seção continuava afirmando números embaixo da faixa que
acabou de dizer que falhou.

Corrigido em **Cartões, Metas, Dívidas, Recorrentes, Orçamentos, Plano, Regras, Lembretes,
Importar, Contas e Fatura**. O conserto é uma linha por query — zerar a lista derivada quando a
query falha —, o que cobre lista, contadores e destaque de uma vez; os estados vazios já checavam
`isError` e continuam calados.

**O caso grave era a Fatura**: junto do total vinha o botão **"Paguei R$ 1.700,00"**, que ESCREVE
no banco, em cima de um número que o app não conseguia mais confirmar. Verificado offline no
Android: hoje sobra só a faixa de erro com "Tentar de novo".

O que NÃO foi mexido: o padrão em cadeia (`isError ? erro : isLoading ? … : conteúdo`) já é
seguro, e o silêncio deliberado de quem mostra o erro em outra faixa da mesma tela é decisão de
desenho, não este bug.

### Deep link aplica filtro em tela já montada

Os filtros nasciam de `useState(params.x)`, que só lê na primeira renderização — então
`?accountId=…` caía na instância aberta e era ignorado em silêncio. Agora é **ajuste durante a
renderização** (o padrão do próprio React para "estado que muda quando a prop muda"): `setState`
dentro de `useEffect` é erro de lint aqui, porque dispara renderização em cascata. Só aplica o que
veio no link — parâmetro ausente não desfaz escolha que o usuário fez na tela.

### Dynamic Type: verificado, e o "não verificado" era erro de FERRAMENTA

`simctl ui <udid> content_size` — com **underscore**, não hífen. As fases anteriores usaram
`content-size`, que o `simctl` recusa imprimindo o texto de uso; ninguém leu a mensagem e a
conclusão virou "não surtiu efeito".

Conferido nos dois lados: iOS em `extra-extra-extra-large` e Android em `font_scale 1.3`. **O
layout aguenta**: título, composição, segmented, chips, grade do sheet de mês e estado vazio
escalam e refluem, com truncagem limpa e nenhum valor cortado. Nada no código desliga
`allowFontScaling` (conferido por grep).

**Um defeito real apareceu por causa do teste:** no eixo do gráfico de Patrimônio, uma série de 12
meses mostrava `set. … set.` nas duas pontas — doze meses lendo como se nada tivesse acontecido.
`monthShort` ganhou o ano quando as pontas caem em anos diferentes: `set./25 … set./26`.

### As duas validações que o staging não permitia

O `net_worth_snapshots` do staging estava **vazio** — o cron de foto nunca rodou lá (em produção
rodou: 11 fotos desde 26/08). Sem foto não há curva, e por isso o seletor 6/12/24 do Patrimônio e
o trecho passado da projeção nunca tinham sido vistos com dado real.

Inseri 44 fotos descartáveis (mensais de 14 meses + diárias de 30 dias), validei e **apaguei
tudo** — o staging voltou a zero. Com elas:

- **Seletor de janela**: 12 meses → `+R$ 25.200,00`, 6 meses → `+R$ 11.550,00`. A query refaz e o
  gráfico encurta.
- **Passado da projeção**: o trecho fraco à esquerda, o marcador vertical no hoje e a projeção
  cheia à direita, **com a emenda sem degrau** — que era o ponto do desenho (as duas pontas saem
  do mesmo `cash_total`). Na Fase 4 isso só tinha sido exercitado com série sintética.

### VoiceOver: até onde deu, e o que sobra

O simulador **não sobe o VoiceOver de verdade** (`defaults write VoiceOverTouchEnabled` grava a
preferência e nada mais acontece). Mas a dúvida registrada desde a Fase 1 — "o `…` do header é
alcançável?" — ficou bem menor:

- **No Android, a árvore REAL (`uiautomator dump`) expõe tudo**: `Mais opções`, `Navigate up`,
  `Buscar lançamentos`, `Lançar`, `Paguei`, `Setembro de 2026`, `Mês anterior, Agosto de 2026` e
  as linhas inteiras (`pc gamer (6/8), R$ 900,00, despesa, qua., 30 de setembro, previsto`).
- **No iOS o `idb` não enxerga a barra de navegação INTEIRA** — some o `…`, o título grande, a
  busca **e o botão voltar**, em todas as telas. Voltar é controle de prateleira do UIKit,
  acessível por construção; se ele some junto, quem não percorre é a ferramenta.

**Continua sendo inferência, não medição.** Fechar de verdade pede VoiceOver ligado à mão num
device — é a única pendência que sobra desta rodada.
