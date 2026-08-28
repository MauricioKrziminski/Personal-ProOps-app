# Projeção — `src/app/(tabs)/finance/forecast.tsx`

Hoje é `src/app/finance/forecast.tsx`, 347 linhas. O gráfico de saldo é feito com `View`s puras:
cada dia vira uma coluna com `height` em `%` e posicionamento absoluto contra uma linha do zero
calculada à mão (`forecast.tsx:38-78`). Com horizonte de 180 dias isso são 181 `View`s numa linha, e
`@shopify/react-native-skia` está instalado desde sempre (`package.json:8`) com **zero import no
projeto**. O simulador "Posso comprar isso?" — a feature mais forte do produto — só é renderizado
depois do card do gráfico e **só quando `serie.length > 0`** (`:116`), dentro de uma tela que só se
alcança por um link no meio de um menu. Os erros de `bills` (`:87`) e `sim` (`:88`) não aparecem em
lugar nenhum: as duas seções simplesmente não renderizam. E o empty state (`:244`) é **inalcançável**:
`cash_flow_forecast` usa `generate_series`, que devolve uma linha por dia sempre — mesmo com saldo
zero e nenhum lançamento, `serie.length` nunca é 0 fora de loading e erro.

## Pergunta que responde

> "Posso gastar isso?"

É a pergunta mais frequente do produto, e a única tela que responde de verdade — com o dinheiro que
ainda vai sair, não com o saldo de hoje.

## Persona

- **Primária: Rafa, 29** — autônomo, renda irregular. Ele não quer o extrato, quer o veredito. O
  simulador é a tela inteira para ele.
- **Secundária: Jorge, 46** — cartão e contas. Para ele o valor está em ver **quando** o caixa afunda,
  não em quanto ele tem hoje.
- **Camila, 34** — usa o horizonte de 6 meses para planejar. É a única que olha o gráfico inteiro.

## Entrada e saída

- **Entrada:** toque no card de destaque da aba Hoje; toque na linha "Posso comprar isso?" da aba
  Financeiro (que abre **direto no simulador**, com `?simular=1` — a feature não pode continuar
  dependendo de o usuário rolar até achar); `push` da seção "Gerenciar".
- **Saída:** conta/fatura → `push /finance/invoice/[id]` ou detalhe do lançamento.
- **Back:** pop. O horizonte escolhido não é preservado entre visitas.

## O modelo de caixa — e a frase que a tela precisa dizer

A projeção é modelo de **caixa**, montado para não contar o mesmo gasto duas vezes (`0014`):

- **Saldo inicial** = contas que guardam dinheiro (`type <> 'credit_card'`, não arquivadas), contando
  só `cleared`.
- **Saídas futuras** = (a) **toda fatura não paga, na data de vencimento dela** + (b) `pending` sem
  fatura, em `coalesce(due_at, occurred_at)`.

Daí a consequência contraintuitiva: **a compra no cartão sai do caixa quando a fatura vence, não
quando foi feita**. Alguém que gastou R$ 800 no cartão hoje vê o saldo intacto por três semanas e
acha que a projeção está quebrada.

A tela explica isso **onde a dúvida nasce** — na linha do dia em que o saldo cai de degrau —, não num
rodapé que ninguém lê: tocar no degrau abre um popover com *"R$ 1.240 — fatura do Nubank vence hoje.
Compra no cartão sai do caixa no vencimento, não no dia da compra."*

## Anatomia

1. **Header nativo** — large title "Projeção". `headerRight` = menu com os horizontes (30 dias ·
   90 dias · 6 meses), tirando os chips de dentro do card (`forecast.tsx:120-129`): trocar de
   horizonte é configuração da tela, não conteúdo dela.
2. **Card de destaque (o único `GlassCard`) — o gráfico de saldo**
   Título é a resposta, não o rótulo: **"Você fica no vermelho em 12/09"** (em `danger`) ou
   **"Não fica negativo nos próximos 90 dias"**. Abaixo, o saldo de hoje e o saldo no fim do
   horizonte, `Fonts.rounded` + `tabular-nums`.
   O gráfico vira **Skia** (`Canvas` + `Path`, componente `BalanceChart` **(novo)** em
   `src/components/finance/`): uma área com a linha do zero, o trecho negativo preenchido em
   `danger`, e um marcador no pior dia. Um `Path` desenha o que hoje são 181 `View`s, e a transição
   entre horizontes vira interpolação de path em vez de remontagem da árvore.
   *É o destaque porque é a única resposta da tela que vale sem nenhuma interação.*
3. **"Posso comprar isso?"** — **segundo bloco, sempre visível, e alcançável por link direto.**
   `Card` opaco (o glass já foi gasto), `MoneyInput` grande, chips de parcelas (1 · 3 · 6 · 10 · 12),
   e o veredito em uma frase:
   - Cabe: *"Dá para pagar. No pior dia você fica com R$ 320, em 12/10."*
   - Não cabe: *"Aperta. Você fica com −R$ 180 em 12/10."* — e, quando `installments > 1`,
     `12x de R$ 250`.
   O veredito precisa dizer **por que**, não só sim/não: o pior saldo e o dia já vêm da RPC
   (`worst_balance_cents`, `worst_day`).
4. **"O que vence"** — `Row`s de `upcoming_bills(30)`, atrasados primeiro em `danger`. Cada linha:
   ícone (`creditcard` para fatura, `doc.text` para lançamento), título, data, valor.
   Ação por linha: **Paguei** para `kind = 'transaction'` (`useMarkPaid`), e **Pagar fatura** para
   `kind = 'invoice'` — que hoje simplesmente não tem ação nenhuma (`forecast.tsx:224` só renderiza o
   botão para transação) e leva para `/finance/invoice/[id]`, onde `pay_invoice` mora. Fatura sem
   saída é o item mais caro da lista sem jeito de resolver.
5. **"Como eu calculo isso"** — `Section` colapsada no fim, fechada por padrão, com o modelo de caixa
   em três linhas. Quem duvida do número procura aqui; quem não duvida nem vê.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Gráfico | `useCashFlowForecast(dias)` | `['forecast', '90']` | RPC `cash_flow_forecast(days)` (teto 365) | `transactions` |
| Simulador | `useAffordability(centavos, parcelas)` | `['affordability', centavos, parcelas]` | RPC `affordability` (teto 72 parcelas) | — (`enabled: amountCents > 0`) |
| O que vence | `useUpcomingBills(30)` | `['upcoming-bills', '30']` | RPC `upcoming_bills(days)` | `transactions`, `card_invoices` |
| Contexto do empty | `useAccounts()` | `['accounts']` | tabela `accounts` | `accounts` |
| Paguei | `useMarkPaid()` | — | `update transactions set status='cleared'` | — |

⚠️ **O simulador precisa de debounce de ~400 ms no valor (novo).** Hoje o `queryKey` inclui o valor
em centavos (`use-finance.ts:447`) e o `MoneyInput` digita em centavos: cada tecla é uma chave nova e
uma chamada de RPC nova. E `affordability` não é barata — ela compõe com
`cash_flow_forecast(370)` por dentro (`0014`). Digitar "1250" hoje são quatro projeções de um ano.

Três queries, **três estados independentes**. Hoje `forecast.isError` (`:113`) fala pela tela toda e
os outros dois erros somem.

## Ação primária

**Simular uma compra.** É a única ação da tela, é o diferencial do produto, e o custo dela precisa ser
"abrir a tela e digitar" — não "abrir a tela, rolar, achar".

## Ações secundárias

- Marcar conta como paga direto na linha (`useMarkPaid`), com confirmação otimista e toast com
  Desfazer.
- Ir para a fatura (`/finance/invoice/[id]`).
- Trocar o horizonte (menu do header).
- Tocar num degrau do gráfico → popover explicando o evento daquele dia.
- **Context menu nativo** na linha de conta: Paguei · Ver lançamento · Adiar vencimento **(novo — nada em `use-finance.ts` mexe em `due_at` hoje)**.
- Pull-to-refresh refaz as três.

## Estados

- **Loading** — `Skeleton` com a forma final: bloco alto de gráfico + bloco de simulador + três
  linhas. Blocos resolvem independentes.
- **Empty real (novo predicado)** — `serie.length === 0` **nunca acontece** (`generate_series` sempre
  devolve linhas). O empty verdadeiro é *nada para projetar*: sem conta cadastrada **e** sem nenhum
  `pending` — ou seja, `useAccounts()` vazio e `upcoming_bills` vazio, com a série toda em saldo zero.
  `EmptyState`, ícone `chart.line.uptrend.xyaxis`, título *"Ainda não dá para projetar"*, dica:
  *"Cadastre suas contas e manda no WhatsApp `todo dia 5 pago 1200 de aluguel`. A partir daí eu mostro
  quanto sobra em cada dia."* Manter o empty atual como está significa exibir para sempre um gráfico
  reto em zero com cara de bug.
- **Empty de "O que vence"** — causa diferente, texto positivo e curto: *"Nada vence nos próximos 30
  dias."* Sem `EmptyState` grande — é uma seção, não a tela.
- **Simulador em repouso** — `simCents === 0`: *"Digite um valor para simular contra a sua projeção
  real."* (o texto atual de `:199` está certo; muda de lugar, não de conteúdo).
- **Erro do gráfico** — inline no lugar do card, com "Tentar de novo".
- **Erro do simulador** — inline dentro do bloco: *"Não deu para simular agora."* + retry. Hoje o
  bloco fica em silêncio (`:183` só testa `sim.data`) e parece que o app está pensando.
- **Erro de `upcoming_bills`** — inline no lugar da seção, com retry. Hoje a seção some inteira
  (`:207`), e "nada vence" e "não consegui carregar o que vence" viram a mesma tela — o pior par
  possível de confundir num app de contas.
- **Falha ao marcar como paga** — toast persistente e a linha **volta**. Otimista sem rollback visível
  faz o usuário achar que pagou.
- **Conteúdo longo** — título de conta trunca em uma linha; valor nunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Gráfico ao trocar horizonte | continuidade espacial | interpolação do `Path` em Skia, `Motion.slow` (~500 ms); hoje a árvore de `View`s é remontada e o gráfico pisca |
| Gráfico ao chegar dado novo (realtime) | mudança de estado | mesmo path anima em `Motion.base`; sem haptic — não foi o usuário |
| Veredito do simulador | mudança de estado | cross-fade em `Motion.fast` + haptic **uma vez** quando o veredito **vira** (`notificationAsync(Success)` / `(Warning)`), nunca a cada tecla |
| Valores do destaque | mudança de estado | contam de/para em `Motion.base`, `tabular-nums` |
| Chips de parcela | feedback | press-in `scale 0.97`, 120 ms, haptic `selectionAsync` |
| Linha "Paguei" | feedback | some com `LinearTransition` em `Motion.fast`; haptic `notificationAsync(Success)` |
| Popover do degrau | continuidade | `Motion.spring.sheet` a partir do ponto tocado |
| Entrada dos blocos | continuidade | `FadeInDown`, stagger 60 ms, cap 400 ms |

O gráfico anima; o veredito em texto **não se move** enquanto está sendo lido — só troca por
cross-fade.

## Acessibilidade

- O gráfico tem **alternativa em texto obrigatória**, não opcional: o título já é a conclusão
  ("fica negativo em 12/09"), e o `Canvas` recebe `accessibilityLabel` com saldo de hoje, saldo final
  e pior dia. Skia não gera árvore de acessibilidade — sem isso a tela fica muda para VoiceOver.
- Negativo **nunca** só por cor: vem com sinal, com a palavra "negativo" no label e com o ícone
  `exclamationmark.triangle`.
- Veredito do simulador anunciado por `accessibilityLiveRegion` / `AccessibilityInfo.announce` quando
  muda — o usuário de leitor de tela não vê o cross-fade.
- Chips de parcela com label "3 vezes", não "3x".
- Botão "Paguei" com `accessibilityLabel` que inclui o item ("Marcar Aluguel como pago").
- Alvos ≥ 44pt, inclusive nos chips e no botão de linha.
- Dynamic Type XL: o gráfico mantém a altura, o bloco de veredito quebra em várias linhas, a linha de
  conta vira duas.
- Valores `selectable` e `tabular-nums`.

## Fora de escopo

- **Editar a projeção** ("e se eu ganhar R$ 2.000 a mais?"). O simulador cobre a saída; simular
  entrada exigiria outro parâmetro na RPC. Fase futura.
- **Horizonte acima de 365 dias.** A RPC trava em 365 (`least(greatest(days,1),365)`), e mais que
  isso é adivinhação.
- **Simular acima de 72 parcelas.** Teto da `affordability`.
- **Cenário salvo / comparar dois cenários.** `affordability` não grava nada de propósito — é
  simulação pura, e persistir cenário criaria um estado que ninguém mantém atualizado.
- **Repetir o detalhe do que vence.** A lista aqui é resumo; o detalhe da fatura mora em
  `/finance/invoice/[id]` e o dia a dia de contas vence na aba **Hoje**.
- **Projetar patrimônio.** Isso é `net_worth_snapshots`, na tela de Patrimônio — e é snapshot, não
  reconstrução.
