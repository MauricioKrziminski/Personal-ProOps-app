# Dívidas — `src/app/(tabs)/finance/debts.tsx`

Hoje é `src/app/finance/debts.tsx`, 480 linhas — a terceira maior tela do app. Ela já tem a parte
difícil (amortização Price e ordem de ataque vêm prontas do banco, `0023`) e erra o resto. O
formulário só **cria**: `onSubmit` chama `save.mutate` sem `id` (`debts.tsx:136`), então uma dívida
cadastrada com a taxa errada não tem como ser corrigida — só arquivada e recriada, apesar de
`useSaveDebt` já aceitar `id` (`use-finance.ts:791`). Quatro erros são invisíveis:
`usePayoffStrategy` (`:106`) e `useDebtSchedule` (`:41`) só desestruturam `data`;
`useArchiveDebt` (`:231`) e `usePayDebtInstallment` (`:73`) não têm `onError`. Pagar parcela é um
`Alert` (`:64-80`), arquivar é `onLongPress` + `Alert` (`:225`), e as variáveis misturam idiomas na
mesma função (`name`, `kind`, `remaining` ao lado de `taxa`, `parcelas`, `diaVencimento`, `criando`,
`aberta`, `estrategia`, `ordem`).

## Pergunta que responde

> "Quanto disso é juro, e por onde eu começo?"

Nenhum assistente financeiro de WhatsApp do mercado responde isso; quem responde são apps separados.
É o diferencial da tela — e ele só existe se o número da taxa estiver certo.

## Persona

- **Primária: Jorge, 46** — empréstimo, financiamento, rotativo do cartão. Ele sabe a parcela e não
  sabe o juro. A linha que muda a vida dele é *"desses R$ 890, R$ 310 são juros"*.
- **Secundária: Rafa, 29** — parcelamento sem juros com pessoa/loja (`interest_rate_monthly = 0`, que
  o schema aceita). Para ele a tela é só um controle de "quanto falta".
- **Casal** — dívida é do workspace (`0023`: unique `(workspace_id, name)`), e o pagamento vira uma
  `transactions` de verdade que o outro vê.

## Entrada e saída

- **Entrada:** `push` da seção "Gerenciar" da aba Financeiro.
- **Saída:** `push /finance/transactions` filtrado pela dívida ao tocar em "lançamentos desta
  dívida" — o pagamento de parcela cria uma `transactions` com `debt_id` (`0023`), e essa é a ponte.
  Criar/editar e pagar abrem `formSheet`.
- **Back:** pop. A dívida aberta não é preservada.

## `interest_rate_monthly` é fração mensal — e é a fonte de erro nº 1

`1,99% a.m. = 0.0199`. O banco guarda a fração (`numeric(10,6)`), a tela guarda texto e converte com
`parseTaxa` (`debts.tsx:34`, divide por 100) e `taxaLabel` (`:29`, multiplica por 100). A conversão
está certa; o que falta é o input **deixar isso óbvio antes de o usuário salvar**. Errar por um fator
de 100 aqui não dá erro nenhum: gera uma tabela Price plausível e um total de juros absurdo, e o
usuário não tem como saber.

O campo, portanto:

- Rótulo **"Juros por mês"**, sufixo `%` **dentro** do input, `keyboardType="decimal-pad"`, vírgula
  aceita (é como o brasileiro digita — `parseTaxa` já trata).
- **Prévia ao vivo, embaixo do campo**, recalculada a cada tecla:
  *"1,99% ao mês → R$ 199 de juros no primeiro mês sobre R$ 10.000."* É `saldo × fração`,
  aritmética de exibição, não precisa de banco. Um zero a mais vira "R$ 1.990 de juros no primeiro
  mês" e o erro fica impossível de não ver.
- **Guarda-corpo**: acima de 20% a.m. o campo mostra um aviso (não bloqueia — rotativo de cartão
  passa disso mesmo): *"20% ao mês é rotativo de cartão. Se você quis dizer ao ano, divida por 12."*
- **Ao ano ↔ ao mês** não é um toggle. Um toggle mal lido é justamente o bug que queremos evitar;
  o campo é sempre mensal e a prévia confirma.
- Vazio = **sem juros**, dito com todas as letras: *"Deixe em branco se não tem juros (parcelamento
  de loja, dinheiro com alguém)."*

## Anatomia

1. **Header nativo** — large title "Dívidas". `headerRight` = `plus` (`Icon`), abre o `formSheet`.
2. **Card de destaque (o único `GlassCard`) — "Total devido"**
   O que hoje é o card de resumo (`debts.tsx:162-207`), enxugado: valor grande em `danger`,
   `Fonts.rounded` + `tabular-nums`, e **uma** linha secundária: *"R$ 4.120 de juros até quitar
   tudo"* (soma de `total_interest_cents` de `payoff_strategy`). O juro total é o número que faz o
   usuário agir; ele hoje está diluído dentro da lista de prioridades.
3. **"Por onde começar"** — `Card` opaco, com o segmented `Mais juros` / `Menor saldo` no topo e a
   ordem de `payoff_strategy` numerada abaixo. **Só aparece com 2+ dívidas** — com uma só, o seletor
   é um controle que não muda nada (o código atual já acerta isso, `:172`). A legenda explica a
   escolha: avalanche paga menos no total, snowball quita a primeira mais rápido.
   Honestidade obrigatória, porque a RPC é honesta: o total de juros é **por dívida, isolado** — não
   simula redirecionar a parcela quitada para a próxima (`0023`). A legenda diz isso: *"Cada dívida
   contada sozinha, sem supor que você joga a parcela quitada na próxima."*
4. **Lista de dívidas** — `Card` opaco por dívida: nome, saldo em `danger`, tipo (`DEBT_KINDS`),
   taxa formatada ou "sem juros", `3/12 pagas`, barra de progresso.
5. **Detalhe da dívida** — hoje é acordeão inline (`:259`); vira `push` para
   `/finance/debts/[id]` **(novo)**, porque a amortização é conteúdo demais para caber dentro de um
   card de lista: próxima parcela, quanto dela é juro, tabela Price completa de `debt_schedule`, e o
   botão Paguei. Uma dívida financiada em 60x tem 60 linhas — acordeão não é lugar para isso.

### Detalhe — `/finance/debts/[id]` **(novo)**

1. Header nativo com o nome da dívida; `headerRight` = menu (Editar · Arquivar).
2. **Próxima parcela**, em destaque textual (não em `GlassCard` — o destaque da área já foi gasto na
   raiz): `R$ 890 em 10/09`, e embaixo, em `danger`, `R$ 310 disso são juros`. É a frase inteira do
   produto.
3. **Paguei esta parcela** — botão de largura cheia. Ação primária desta tela.
4. **Tabela de amortização** — `debt_schedule`: nº, vencimento, parcela, juros, amortização, saldo.
   `tabular-nums` em todas as colunas, scroll horizontal próprio se não couber, nunca empurrando o
   corpo da página.
5. **Lançamentos desta dívida** — as `transactions` com `debt_id`, que `pay_debt_installment` cria.

### Pagar parcela

`formSheet` pequeno, não `Alert` (`debts.tsx:64`): valor pré-preenchido com
`schedule[0].payment_cents` e **editável** (quem paga a mais amortiza mais — e a RPC já trata isso:
`abate = pagamento − juros do mês`), seletor de conta pagadora (`pay_debt_installment` aceita
`p_account_id` e a tela nunca manda, `use-finance.ts:819`), e a linha que explica o resultado antes
de confirmar: *"R$ 310 vão para o juro do mês, R$ 580 abatem o saldo. Fica em R$ 9.420."*

Isso é a metade do valor da tela de dívidas: pagar parcela **não** reduz o saldo pelo valor cheio, e
o usuário precisa ver isso no momento em que confirma, não depois.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Lista + destaque | `useDebts()` | `['debts']` | tabela `debts` (`archived = false`) | `debts` |
| Ordem de ataque | `usePayoffStrategy(estratégia)` | `['payoff', estratégia]` | RPC `payoff_strategy` | `debts` |
| Amortização | `useDebtSchedule(debtId)` | `['debt-schedule', debtId]` | RPC `debt_schedule` | — (lazy, `enabled: Boolean(debtId)`) |
| Lançamentos da dívida | `useTransactions` com filtro por `debt_id` **(novo)** | `['transactions', …, debtId]` | tabela `transactions` | `transactions` |
| Pagar | `usePayDebtInstallment()` | — | RPC `pay_debt_installment` | invalida `['debt-schedule']`, `['payoff']` e as chaves de finanças |
| Criar / editar | `useSaveDebt()` | — | `insert`/`update` em `debts` | — |
| Arquivar | `useArchiveDebt()` | — | `update debts set archived = true` | — |

Três queries na raiz, cada uma com **seu** estado. Hoje `isError` (`debts.tsx:159`) fala só por
`useDebts`, e a lista de prioridades simplesmente não aparece se `payoff_strategy` falhar.

## Ação primária

**Registrar o pagamento de uma parcela.** É a única ação que muda o saldo devedor, e a RPC
`pay_debt_installment` faz as três coisas de uma vez: cria a despesa, desconta o juro do mês e abate
o principal.

## Ações secundárias

- **Context menu nativo** na dívida: Ver amortização · Editar · Arquivar.
- **Editar (novo na UI).** Mesmo `formSheet` da criação, com `id`. Sem isso, taxa errada é
  permanente — e a taxa é o campo mais fácil de errar da tela inteira.
  Ao editar, `principal_cents` e `remaining_cents` viram campos separados: hoje a criação grava os
  dois iguais (`:138-139`), então a barra de progresso nasce sempre em 0% mesmo para quem já pagou
  metade.
- **Arquivar é action sheet nativo**, com o efeito colateral dito: *"A dívida sai da lista. Os
  pagamentos já lançados continuam nos seus lançamentos."*
- Segmented avalanche/snowball.
- Pull-to-refresh refaz as duas queries da raiz.

## Estados

- **Loading** — `Skeleton` com a forma: bloco alto + três cards com barra. No detalhe, oito linhas de
  tabela.
- **Empty (nenhuma dívida)** — `EmptyState`, ícone `creditcard.trianglebadge.exclamationmark`,
  título *"Nenhuma dívida cadastrada"*, dica: *"Cadastre um empréstimo ou financiamento e eu mostro
  quanto é juro e por onde começar."* Aqui a dica **não** é o atalho do WhatsApp: a IA não cria
  dívida, e mandar o usuário para lá seria mentira.
- **Empty da amortização** — causa própria: a dívida não tem `installments` preenchido, então
  `debt_schedule` volta vazio (`private.debt_schedule_for` depende de `restantes`). Texto:
  *"Informe quantas parcelas faltam para eu montar a tabela."* + atalho para Editar. É diferente de
  "quitou tudo", que também dá lista vazia e tem seu próprio texto: *"Nada em aberto. Dívida
  quitada."*
- **Erro de `payoff_strategy`** — inline, no lugar da seção "Por onde começar", com retry. A lista de
  dívidas continua na tela.
- **Erro de `debt_schedule`** — inline no detalhe, com retry. Hoje some (`:41`) e a tela parece dizer
  "sem parcelas em aberto" (`:93-97`) — uma falha que se disfarça de informação.
- **Falha ao pagar** — toast persistente e o sheet **fica aberto** com o valor. Nunca fechar num erro:
  o usuário precisa saber que o pagamento não foi registrado, senão registra de novo.
- **Falha ao arquivar** — toast e a dívida volta para a lista.
- **Conteúdo longo** — nome da dívida trunca; valores nunca. A tabela Price rola dentro do próprio
  container.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Barra de progresso | mudança de estado | `withSpring(Motion.spring.settle)`; hoje é `View` com `%` fixo (`debts.tsx:255`) |
| Saldo devedor após pagar | mudança de estado | conta de/para em `Motion.base`, `tabular-nums` |
| Troca avalanche ↔ snowball | mudança de estado | linhas reordenam com `LinearTransition` em `Motion.base` — a reordenação **é** a informação; cross-fade esconderia ela |
| Sheet de pagar | continuidade | `Motion.spring.sheet`; haptic `notificationAsync(Success)` na confirmação |
| Prévia da taxa no form | feedback | atualiza sem animação, a cada tecla — número que o usuário está lendo enquanto digita não se move |
| Entrada dos cards | continuidade | `FadeInDown`, stagger 60 ms, cap 400 ms |
| Push para o detalhe | continuidade espacial | transição nativa de stack |

## Acessibilidade

- Card com label completo: *"Empréstimo Banco X, deve nove mil e quatrocentos reais, 1,99 por cento
  ao mês, 3 de 12 parcelas pagas"*.
- Juros **nunca** só em vermelho: a palavra "juros" está sempre no texto ao lado do valor.
- Input da taxa com `accessibilityLabel="Juros por mês, em porcentagem"` e a prévia como
  `accessibilityHint` — quem usa VoiceOver é quem mais precisa da confirmação do fator de 100.
- Tabela de amortização com cabeçalho de coluna anunciado por célula; alternativa em lista quando
  Dynamic Type XL estiver ativo.
- Botão só-ícone do header com `accessibilityLabel="Nova dívida"`.
- Alvos ≥ 44pt, inclusive no segmented de estratégia.
- Valores `selectable` e `tabular-nums`.

## Fora de escopo

- **Simular quitação antecipada** ("e se eu jogar R$ 5.000 hoje?"). Boa ideia e cara: exige um
  `debt_schedule` paramétrico. Fase futura.
- **Snowball com redirecionamento de parcela.** A RPC é explicitamente honesta sobre não simular
  isso; a tela não pode prometer o que o número não entrega.
- **Renegociação / troca de taxa com histórico.** `debts` não guarda histórico de taxa; editar
  sobrescreve, e a tabela Price passa a valer dali para a frente.
- **Criar dívida pelo WhatsApp.** A IA não tem ação para isso e o `responseSchema` está no teto de
  15 propriedades (`.claude/rules/ai-gemini.md`).
- **IOF, seguro, tarifa embutida.** O modelo é Price puro; embutir custo acessório sem campo para ele
  seria inventar número.
