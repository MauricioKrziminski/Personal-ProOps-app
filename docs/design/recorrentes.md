# Recorrentes — `src/app/(tabs)/finance/recurring.tsx`

Hoje é `src/app/finance/recurring.tsx`, 198 linhas — a menor das telas de finanças, e a única que
**não deixa criar nada**. Série recorrente só nasce pelo WhatsApp; o rodapé da tela diz isso com
todas as letras (`recurring.tsx:131`). Ela lista, pausa/retoma (`:87-96`) e apaga com `onLongPress` +
`Alert` (`:52`, `:31`). Emoji faz papel de ícone em todo canto: `🔁💰`/`🔁💸` no título (`:55`),
`⏸`/`▶️` na ação (`:95`), `⚠️` no erro (`:78`), `🔁` no empty (`:121`).

É também a **única tela do app que mostra `last_error`** (`:75-85`), com a contagem
"tentativa X de 5" — e o 5 é real: a `0007` define esse limite para o cron parar de tentar para
sempre. Esse padrão é bom e precisa sobreviver à redesenhada.

Três colunas do schema não têm UI nenhuma: `end_date`, `auto_confirm` e `dtstart` — e nem chegam ao
app, porque `RECURRING_COLUMNS` (`use-finance.ts:243-244`) não as seleciona.

## Pergunta que responde

> "O que vai sair da minha conta todo mês sem eu fazer nada?"

## Persona

- **Primária: Jorge, 46** — aluguel, escola, plano de saúde, financiamento. Ele quer conferir a lista
  uma vez por mês e não pensar nela de novo.
- **Secundária: Camila, 34** — assinatura que ela esqueceu que tinha. A tela é onde ela descobre e
  corta. Para isso ela precisa **editar e encerrar**, que hoje não existe.
- **Rafa, 29** — receita recorrente (contrato fixo). É metade da projeção dele.

## Entrada e saída

- **Entrada:** `push` da seção "Gerenciar" da aba Financeiro; deep link do WhatsApp depois de a IA
  criar uma série ("criei o lançamento recorrente — ver no app").
- **Saída:** `push /finance/transactions` filtrado por `recurring_id` — "ver as ocorrências desta
  série" é a pergunta seguinte natural, e o vínculo já existe (`transactions.recurring_id`, `0014`).
  Criar/editar em `formSheet`.
- **Back:** pop.

## Como a série funciona (e por que a tela tem que respeitar isso)

- **RRULE + `dtstart`** — `dtstart` é a âncora imutável da série. Até a `0014` a expansão usava
  `next_run_at` como âncora, e como ele anda a cada materialização a hora de parede derivava a cada
  rodada do cron (`0015`). `dtstart` nunca muda; a UI **nunca** o edita.
- **`next_run_at` é a próxima ocorrência FUTURA** — é o que o app mostra, independente de quanto já
  foi gravado à frente.
- **`materialized_until`** é controle do cron, não conteúdo. Não vai para a tela.
- O `finance-scheduler` materializa **90 dias à frente** (`HORIZON_DAYS = 90`) como `transactions`
  com `source = 'recurring'` e `status = 'pending'` — ou `cleared` se a data já passou **e**
  `auto_confirm` for true. Idempotência pelo unique `(recurring_id, occurred_at)`: rodar o cron duas
  vezes não duplica (o `23505` é ignorado de propósito).
- Série encerrada por `end_date` volta com `active = false` sozinha.

Isso tem duas consequências que a tela atual ignora, e que são as decisões mais importantes deste
documento:

**1. Apagar a série deixa até 90 dias de `pending` órfãos.** `transactions.recurring_id` é
`on delete set null` (`0014`), então o `delete` de `useDeleteRecurring` (`use-finance.ts:1275`)
remove a série e deixa as ocorrências futuras já materializadas soltas em `transactions` —
continuando a pesar em `cash_flow_forecast` e `upcoming_bills`, sem nenhum jeito de descobrir de
onde vieram. E o texto do `Alert` atual ("Os lançamentos já criados continuam no histórico",
`recurring.tsx:34`) está certo sobre o passado e errado sobre o futuro.
→ Apagar precisa ser **uma RPC `delete_recurring(p_id, p_keep_future)` (novo)** que, na mesma
transação, apaga os `pending` futuros da série antes de apagar a série. Duas chamadas do app não
servem: falhar no meio deixa exatamente a bagunça que estamos consertando.

**2. Editar não alcança o que já foi materializado.** Mudou o valor do aluguel? O unique
`(recurring_id, occurred_at)` garante que o cron **não** reescreve as ocorrências já gravadas — elas
ficam com o valor antigo pelos próximos 90 dias.
→ Editar precisa ser **uma RPC `save_recurring(...)` (novo)** que atualiza a série e, junto,
reescreve os `transactions` da série com `status = 'pending'` e `occurred_at >= hoje`. `cleared`
nunca é tocado: o que já aconteceu, aconteceu.

## Anatomia

1. **Header nativo** — large title "Recorrentes". `headerRight` = `plus` (`Icon`), abre o sheet de
   criação (que hoje não existe).
2. **Card de destaque (o único `GlassCard`) — "Próximos 30 dias"**
   Soma das ocorrências desta série já materializadas nos próximos 30 dias, separada em
   `sai R$ 3.480 · entra R$ 5.000`. Vem de `transactions` filtradas por `recurring_id not null` e
   `status = 'pending'` — **não** de uma soma dos `amount_cents` da lista. Somar a lista seria errado:
   séries com `FREQ` diferente (semanal, mensal, anual) não somam no mesmo denominador, e um número
   errado num card de destaque é pior que nenhum número.
3. **"Precisa de atenção"** — séries com `last_error` ou pausadas. Vem primeiro porque é a única
   parte com consequência: série parada = conta que não vai aparecer na projeção.
   Mantém o que a tela já faz bem: a mensagem do erro, a contagem `tentativa 3 de 5`, e a informação
   de que retomar zera o contador (`useToggleRecurring` limpa `run_attempts` e `last_error`,
   `use-finance.ts:1262`).
4. **"Ativas"** — `Card` opaco por série: descrição, `Icon` de direção (`arrow.down.left` receita /
   `arrow.up.right` despesa) em vez de `🔁💰`, valor com sinal e `tabular-nums`, `describeRRule`
   ("todo dia 5") e `Próximo em 05/09`. Se `auto_confirm` for false, um selo discreto
   **"você confirma"**; se houver `end_date`, **"até 12/2026"**.
5. **"Pausadas"** — seção própria, no fim, opacidade reduzida. Hoje as pausadas se misturam com as
   ativas (a ordenação sobe as ativas, `use-finance.ts:256`, mas visualmente é a mesma lista com
   `opacity: 0.6`, `:160`).

### Criar e editar — `formSheet` **(novo)**

Criar continua sendo mais rápido pelo WhatsApp, e o sheet diz isso no rodapé. Mas "só pelo WhatsApp"
é uma armadilha: quem quer **corrigir** o valor do aluguel não vai reescrever a frase, vai apagar e
recriar — e apagar hoje deixa 90 dias de órfãos.

Campos:

- **Tipo** — segmented Despesa / Receita. `transfer` é aceito pelo banco desde a `0014` mas o app
  estreita para `'expense' | 'income'` (`use-finance.ts:114`); manter fora até haver caso de uso.
- **Valor** — `MoneyInput`, `amount_cents`.
- **Descrição** e **Categoria** (chips de `SUGGESTED_CATEGORIES`) e **Conta** (opcional).
- **Repete** — **presets, nunca RRULE livre**: `Todo mês no dia N` · `Toda semana na <weekday>` ·
  `Todo ano em DD/MM` · `A cada N meses no dia D`. Cada preset monta a RRULE
  (`FREQ=MONTHLY;BYMONTHDAY=5`) e mostra a frase de volta via `describeRRule`, que é o mesmo caminho
  usado para as séries criadas pela IA. Campo de texto livre para RRULE seria um gerador de série
  quebrada.
- **Começa em** — data. Só na criação: vira `dtstart` **e** o `next_run_at` inicial, e depois é
  imutável. Calcular a primeira ocorrência a partir do preset é um helper de cliente **(novo)** —
  o `nextOccurrence` de `_shared/` roda em Deno e não é importável do app.
- **Termina em** — data opcional (`end_date`). É como se encerra uma assinatura sem apagar o
  histórico. Hoje não existe UI nenhuma para isso.
- **Confirmar automático** — `Switch` (`auto_confirm`, default true). Legenda explicando a diferença,
  porque ela é sutil e muda o que aparece na aba Hoje: *"Ligado, o lançamento já entra como pago na
  data. Desligado, ele fica esperando você dizer que pagou."*

Na edição, um aviso honesto antes de salvar: *"As próximas ocorrências ainda não confirmadas vão ser
atualizadas. O que já foi lançado fica como está."* — que é exatamente o que a RPC faz.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Lista (3 seções) | `useRecurringTransactions()` | `['recurring']` | tabela `recurring_transactions` | `recurring_transactions` (na publicação desde a `0009`, justamente para `last_error` chegar sem refetch) |
| Destaque 30 dias | `useRecurringUpcoming(30)` **(novo)** | `['recurring','upcoming',30]` | `transactions` where `recurring_id not null and status = 'pending'` | `transactions` |
| Ocorrências da série | `useTransactions` filtrado por `recurring_id` **(novo)** | `['transactions', …, recurringId]` | tabela `transactions` | `transactions` |
| Pausar / retomar | `useToggleRecurring()` | — | `update recurring_transactions` | — |
| Criar / editar | `useSaveRecurring()` **(novo)** | — | RPC `save_recurring` **(novo)** | — |
| Apagar | `useDeleteRecurring()` → passa a chamar a RPC **(novo)** | — | RPC `delete_recurring` **(novo)** | — |

⚠️ `RECURRING_COLUMNS` (`use-finance.ts:243-244`) precisa passar a selecionar `end_date`, `auto_confirm`
e `dtstart` **(novo)** — sem eles o sheet de edição não tem como pré-preencher os campos que ele
mesmo introduz.

## Ação primária

**Pausar ou retomar uma série.** É a ação de manutenção que o usuário faz de verdade nesta tela, e um
toque é o custo certo — a série volta a aparecer (ou some) da projeção imediatamente.

## Ações secundárias

- **Context menu nativo** na série: Editar · Ver ocorrências · Pausar/Retomar · Apagar.
- **Apagar é action sheet nativo com duas saídas**, porque a consequência é real:
  `Apagar e cancelar os próximos lançamentos` · `Apagar e manter os próximos` · Cancelar.
  Cada opção manda um `p_keep_future` diferente. Um `Alert` de duas opções com um texto que só fala
  do passado (`recurring.tsx:34`) não dá para o usuário a informação de que ele precisa.
- Encerrar sem apagar: preencher `end_date` no sheet de edição. É a saída certa para assinatura
  cancelada — mantém o histórico e para de projetar.
- Pull-to-refresh.

## Estados

- **Loading** — `Skeleton` com a forma: bloco alto + quatro linhas.
- **Empty (nenhuma série)** — `EmptyState`, ícone `repeat`, título *"Nada se repete ainda"*, dica com
  a frase pronta: *"Manda no WhatsApp: `todo dia 5 pago 1200 de aluguel` — ou toca em + para
  cadastrar aqui."* Com o sheet de criação existindo, a dica passa a ter dois caminhos, e o do
  WhatsApp continua em primeiro porque é o mais rápido.
- **Empty de "Precisa de atenção"** — a seção some, não vira card vazio.
- **Empty das ocorrências (série nova)** — causa própria: o cron ainda não rodou. Texto:
  *"O primeiro lançamento aparece em 05/09."* — nunca "nenhum lançamento", que parece defeito.
- **Erro da lista** — inline, com "Tentar de novo".
- **`last_error` na série** — é conteúdo, não erro de tela: `Card` com fundo `warning` suave, ícone
  `exclamationmark.triangle`, a mensagem crua truncada em 3 linhas (como hoje, `:81`), a contagem de
  tentativas e o botão Retomar, que zera o contador. Manter.
- **Falha ao pausar / apagar / salvar** — toast persistente + rollback visível. Hoje `useToggleRecurring`
  e `useDeleteRecurring` não têm `onError` na tela: a série volta ao estado anterior e ninguém explica.
- **Conteúdo longo** — descrição trunca em uma linha; valor e data nunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Pausar / retomar | mudança de estado | card cruza para `opacity 0.6` e muda de seção com `LinearTransition` em `Motion.base`; haptic `impactAsync(Light)` |
| Card mudando de seção | continuidade espacial | `LinearTransition`, `Motion.base` — o movimento é a explicação de para onde o item foi |
| Apagar | feedback | sai com `LinearTransition` em `Motion.fast`; toast "Recorrência apagada" com Desfazer |
| Sheet de criar/editar | continuidade | `Motion.spring.sheet` |
| Preset de repetição | feedback | frase do `describeRRule` faz cross-fade em `Motion.fast` ao trocar o preset — confirma que a regra virou português |
| Erro aparecendo via realtime | mudança de estado | `FadeIn` em `Motion.base`, sem haptic: não foi o usuário que causou |
| Entrada dos cards | continuidade | `FadeInDown`, stagger 60 ms, cap 400 ms (já é o padrão em `:50`) |

## Acessibilidade

- Card com label completo: *"Aluguel, despesa de mil e duzentos reais, todo dia 5, próximo em 5 de
  setembro"*.
- Pausado **não** é comunicado só por opacidade: o label diz "pausado" e o card tem o selo.
- Série com erro anuncia o erro como parte do label, não como decoração.
- `Switch` de confirmação automática com label e hint próprios — a diferença entre `pending` e
  `cleared` é sutil demais para depender do rótulo curto.
- Botão só-ícone do header com `accessibilityLabel="Nova recorrência"`.
- Dynamic Type XL: o card vira três linhas; a frase da recorrência nunca trunca (é a informação
  principal).
- Alvos ≥ 44pt na ação de pausar.
- Valores `selectable` e `tabular-nums`.

## Fora de escopo

- **Editar `dtstart`.** Âncora imutável por decisão de arquitetura (`0015`). Mudar o início é criar
  outra série.
- **Ver/editar `materialized_until`.** Controle interno do cron.
- **Pular uma ocorrência específica** ("esse mês não paga"). O jeito certo hoje é apagar aquela
  `transactions` pendente na tela de Lançamentos; uma UI de exceção por data exigiria uma tabela de
  exceções que não existe.
- **RRULE avançada** (`BYSETPOS`, `BYDAY` composto, `COUNT`). Os presets cobrem o que a IA gera; o
  resto continua chegando pelo WhatsApp e é exibido pelo `describeRRule`, que devolve a regra crua
  quando não entende — de propósito, para nunca mentir sobre a data.
- **Recorrente do tipo `transfer`.** O banco aceita desde a `0014`, o app não tem caso de uso.
