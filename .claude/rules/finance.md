# Domínio financeiro

## Dinheiro

- **Sempre `amount_cents` bigint inteiro e positivo. Nunca float, nunca decimal, nunca `parseFloat`.** Sinal/direção vem do `kind`, não do valor.
- Moeda default BRL. Exibição só via `formatBRL` (app) / `centsToBRL` (functions).

## Modelo (v1)

- **`transactions`** unificada: `kind in (expense, income, transfer)`. Transfer exige `counterparty_account_id` (check no banco). `occurred_at date`. `source in (whatsapp, app, import, recurring)`.
- **`accounts`**: carteiras/contas com `type in (checking, savings, credit_card, cash, investment)` e `initial_balance_cents`. Saldo é **derivado** (RPC `_account_balances`), nunca coluna materializada. Cartão de crédito tem `closing_day`, `due_day`, `credit_limit_cents` e `payment_account_id` (check no banco: null nos outros tipos).
- **`card_invoices`**: ciclo da fatura (mês de referência, fechamento, vencimento, status). O **total nunca é materializado** — sai de `sum(transactions.amount_cents) where invoice_id = ...`, igual ao saldo de conta.
- **`installment_plans`**: compra parcelada. Uma `transactions` por parcela, uma por mês; as futuras nascem `status='pending'`. Resto da divisão inteira vai na ÚLTIMA parcela (a soma sempre bate com o total).
- **`transactions`** ganhou `status in (pending, cleared)`, `due_at`, `invoice_id`, `installment_plan_id`, `installment_no`, `merchant`. `pending` = ainda vai acontecer; é a base da projeção de fluxo de caixa.
- **`goals`**: `target_cents` + `saved_cents`, que é **derivado da soma de `goal_contributions`** (ledger). Aporte só pela RPC `goal_deposit` — nunca `+=` no cliente. Aporte NÃO vira transação: é movimento entre contas do próprio usuário e lançar como despesa inflaria o gasto do mês.
- **`budgets`**: **gasto e comprometido são colunas separadas, e a régua é "já aconteceu", não
  `status`** (`20260909180000`, validado contra o mercado). `spent_cents` = efetivado **+ parcela
  de cartão** (a compra foi feita, a parcela é inevitável); `committed_cents` = previsto sem
  fatura (dá para adiar). Filtrar só `cleared` seria trocar um erro por outro pior — subestimaria
  justamente o cartão. **O AVISO conta os dois; o número exibido é só o gasto**, que é o destaque
  amarelo do YNAB traduzido: transação agendada não entra no "Activity", mas acende a categoria
  quando o que vem não está coberto. Vale para as 5 telas, as 2 tab bars e o alerta.
  `month` null = limite padrão; linha com `month` sobrescreve aquele mês. **Dois unique parciais** (NULL não colide com NULL no Postgres). `rollover` soma a sobra do mês anterior, um nível só — e **só se o orçamento já existia antes do mês corrente** (`created_at`), senão um orçamento criado hoje ganharia sobra de um mês em que não existia. Status via `_budgets_status`.
- **`debts`**: dívidas com `interest_rate_monthly` em fração mensal (1,99% a.m. = 0.0199). `debt_schedule` monta a Price; `pay_debt_installment` abate o saldo **já descontando os juros do mês**.
- **`recurring_transactions`**: RRULE + `dtstart` (âncora imutável) + `next_run_at` (próxima ocorrência FUTURA, é o que o app mostra) + `materialized_until` (controle do cron). Materializadas **um ano à frente** pelo `finance-scheduler` como `pending`, com `source='recurring'`. Idempotência pelo unique `(recurring_id, occurred_at)`.

  ⚠️ **Era 90 dias até 10/09/2026, e 90 dias fazia a projeção MENTIR** — não "acabar". A parcela
  é linha real e continuava aparecendo; a receita recorrente, não. Abrir outubro de 2027 mostrava
  as parcelas sem o salário, e o saldo despencava para um número que nunca existiu. O padrão da
  indústria é híbrido: a REGRA é a fonte da verdade, uma janela vira linha de verdade (editável,
  conciliável) e o resto se expande da regra — o Google Calendar pré-computa ~1 ano, o Asana 30
  dias. Aqui a janela virou 365 dias, que é ~12 linhas por série.

  ⚠️ **Passar de 90 para 365 dias quebrou TODA leitura de "o mais recente", e em silêncio.**
  O cron grava as ocorrências do ano inteiro NO MESMO INSTANTE: quem ordena por `created_at`
  passa a ver só futuro. Medido em produção em 10/09/2026, com 200 linhas futuras contra 103
  passadas:

  - `useRecentTransactions` — "Últimos lançamentos" da Hoje e do Financeiro virou doze
    "Manutenção dentista", uma por mês, até agosto de 2027.
  - `finance.reference_window` (era `resolve_transaction` e `por_transacao`, com a consulta
    duplicada) — a janela dos 40 ficou **40 de 40 no futuro**, e "apaga o último gasto"
    resolvia para *Manutenção dentista de 10/08/2027*. Caminho destrutivo; quem segurava era o
    usuário ler o `interrupt()` e dizer não.

  O corte certo é a DATA, nunca o `status`: compra no cartão fica `pending` até a fatura ser
  paga e ainda assim é lançamento que aconteceu. E a janela do agente tem duas metades — o
  passado primeiro (é o que "o último" quer dizer), depois as 10 ocorrências futuras mais
  próximas, para "a parcela de outubro" continuar alcançável.

  **Não escreva um segundo expansor em SQL** para ir além do horizonte: a aritmética de
  recorrência mora em `agent/app/jobs/scheduler.py` (`HORIZON_DAYS`) e duplicá-la é a segunda
  cópia que diverge. Além de 12 meses, o caminho é uma RPC de LEITURA que marque a linha como
  projetada. E **quem anuncia a janela ao usuário lê a constante** — a frase de `query_recurring`
  cravava "90 dias" logo abaixo de um comentário dizendo que a janela vinha de `HORIZON_DAYS`;
  `tests/test_query_reads.py` quebra se voltar a cravar.

  **Apagar a série leva junto as ocorrências futuras ainda `pending`** (trigger
  `recurring_drop_future`, `20260909090000`) — a FK é `on delete set null`, e sem o trigger elas
  ficavam órfãs pesando na projeção. Histórico e ocorrência ATRASADA ficam: a primeira aconteceu,
  a segunda é conta em aberto. Foi assim que nasceu um terceiro salário de R$ 2.632,00 que nunca
  existiu, quando o salário único virou dois pagamentos.

## Categorias

- **Texto livre, minúsculo, curto** — sem FK. Fonte única da lista de sugestões:
  `src/lib/categories.ts` — que é SUGESTÃO, não a lista. O seletor do app oferece **as
  categorias que o usuário usa** (`categories_used()`, `20260909100000`), mescladas com as
  sugestões e agrupadas por forma sem acento (`src/lib/categories-merge.ts`): em produção havia 25
  categorias distintas e só 8 estavam entre as 13 sugeridas — "despesas eventuais" (14
  lançamentos), "roupa", "eletrônicos" e "impostos" não davam para escolher no app. Existe UMA
  cópia literal, porque o Python não importa de `src/`: `agent/app/domain/categories.py`.
  (Eram duas; a do Deno saiu com `supabase/functions/` em 09/09/2026.)
  `src/lib/categories.test.ts` falha se as duas divergirem — mexeu numa, mexe na outra. A
  tabela `categories` legada foi dropada na `0010_workspaces.sql`.

## O "hoje" do banco não é o hoje do usuário

⚠️ **O Postgres do Supabase roda em UTC, e das 21h à meia-noite `current_date` já é amanhã.**
Medido em 10/09/2026 às 21h03 BRT: aparelho e Mac diziam `10/09`, o banco dizia `11/09`. Nas
três horas finais de todo dia a projeção começava amanhã (largando o que ainda vence hoje), "o
que vence" perdia o dia, e o ciclo virava cedo — com fechamento no dia 10, às 21h do dia 10 o
app já mostrava o ciclo seguinte.

**24 funções usavam `current_date`** e a correção não foi reescrever nenhuma:
`alter function ... set timezone to 'America/Sao_Paulo'` (`20260911030000`) fixa a GUC pela
DURAÇÃO da chamada. O corpo não muda, o default do banco não muda, e como a GUC vale para tudo
que a função chamar, a porta pública leva o fuso certo para a árvore inteira. Provado antes de
aplicar: `cycle_now` devolvia `diasAteOFim` 19 em UTC e 20 com o fuso.

⚠️ **Não mude o fuso do BANCO.** A doc do Supabase é explícita — *"strongly recommend keeping
it [UTC]"* —, e `alter database` arrastaria junto `auth`, `storage`, `realtime` e os
checkpoints do LangGraph.

⚠️ **O fuso é fixo, e é decisão.** O produto é brasileiro em todas as pontas e não existe
coluna de fuso. Quando existir, o caminho é `private.today(ws_ids)` lendo
`workspaces.timezone`, e as 24 linhas viram `reset timezone`.

**Função nova que use `current_date` precisa do `set timezone` junto** — senão ela volta a
enxergar o dia do UTC, e o sintoma aparece só depois das 21h.

⚠️ **`default current_date` na ASSINATURA não é alcançado pelo `set timezone`** — default de
parâmetro é avaliado no CHAMADOR, antes de a GUC da função valer. São 7 funções assim
(`pay_invoice`, `settle_invoice`, `goal_deposit`, `pay_debt_installment`, `update_asset_value`,
`budgets_status`, `_budgets_status`) e hoje nenhuma corre risco: **todo chamador passa a data
local** (`localISODate()` no app, `local_iso_date(ctx.timezone)` / `require_date` no agente).
Conferido em produção em 11/09/2026 — nas 7 o `current_date` está SÓ na assinatura, nunca no
corpo. Chamador novo que omitir a data grava o dia do UTC, e alterar o fuso da função não
conserta: o jeito é passar a data, ou trocar o default por `null` + `coalesce` DENTRO do corpo.

## O mês financeiro fecha no dia que o usuário paga, não no dia 31

⚠️ **"Do dia 1 ao 31" é uma suposição, e para quem paga tudo num dia só ela corta o ciclo ao
meio.** O caso do dono do produto (10/09/2026): salário no dia 5 e no 20, e as DUAS faturas
vencendo dia 10 — Nubank (fecha dia 3) e BB (fecha no último dia). O período que importa para
ele é **11/08 a 10/09**: recebe, gasta, e no dia 10 paga tudo. Lido de 1 a 31, o salário do dia
20 aparece num balde e a fatura que ele paga com esse salário no seguinte — e nenhum número da
tela bate com a planilha dele.

`workspaces.cycle_close_day` (`20260911020000`), **null = último dia do mês**, que é
exatamente o comportamento anterior. Teto de 28 para o dia existir em fevereiro: sem isso o
ciclo mudaria de tamanho conforme o mês, que é o defeito que ele resolve.

**Uma função sabe a regra, e é `private.cycle_bounds(close_day, mes)`.** Dela saem
`month_lines_for`, `month_summary_for`, `monthly_lines_range` e `month_group` — os quatro
`date_trunc('month', ...)` que existiam viraram uma chamada. `private.cycle_month_of` responde
a outra metade: a que ciclo um DIA pertence.

⚠️ **O rótulo é o mês em que o ciclo TERMINA.** "Setembro" com fechamento no dia 10 é
11/08–10/09, porque é assim que o usuário fala ("o que eu pago em setembro"). A consequência é
que `date_trunc('month', current_date)` deixa de servir para "mês corrente": no dia 15/09 o
ciclo corrente já se chama outubro, e ancorar no mês civil deixaria a tela um ciclo atrasada
durante 20 dias por mês.

⚠️ **Isto é parâmetro de LEITURA e não encosta na regra de fatura.** Em qual fatura uma compra
cai continua sendo o `closing_day` do cartão pelo trigger `set_invoice`, e a projeção continua
tirando o dinheiro do caixa na data de VENCIMENTO. Compra no Nubank dia 04/09 cai na fatura que
vence 10/10 — antes e depois. O ciclo só move a régua que corta os gráficos.

⚠️ **O app PERGUNTA o ciclo, nunca calcula** (`cycle_now`, `cycle_range`). Reescrever a
aritmética em TypeScript seria a segunda cópia da regra, e o modo de falha é mudo: o painel
pediria N dias de projeção enquanto o banco agrupa outra borda, e os dois números da tela
discordariam sem erro nenhum. Foi quase o que aconteceu — o painel já seguia o ciclo enquanto a
linha "entrou · saiu" logo abaixo dele ainda somava 01 a 31.

Padrão do nicho, não invenção: YNAB, Monarch, Mobills e Organizze todos têm dia de
início/fechamento do mês configurável.

⚠️ **E a régua é ESCOLHA, não configuração de mão única** (`20260911130000`). `cycle_close_day`
sozinho fixava a leitura: quem configurava o dia 10 via 11/08–10/09 em todo lugar, e o único
caminho de volta era apagar a configuração. `workspaces.cycle_view` (`cycle` | `civil`) separa
"qual é o meu ciclo" de "como eu quero ver agora" — o Perfil mostra os dois, e trocar a régua
**não apaga o dia**.

**Ela é aplicada num ponto só: `private.cycle_close_day()` devolve `null` no modo civil.** As
cinco leituras que perguntam o dia a ela (`month_lines_for`, `month_summary_for`,
`monthly_lines_range`, `month_group`/`month_forecast_json`, `cycle_range`) caem sozinhas no
`date_trunc('month')` que já era o caminho de quem nunca configurou ciclo. Zero argumento novo,
zero segunda aritmética de "onde o mês começa".

⚠️ **`budgets_status_for` era a quinta leitura e tinha ficado para trás.** Ela seguia em
`date_trunc('month')` enquanto as outras quatro migraram na `20260911021000`: na tela do
Financeiro o painel somava 11/08–10/09 e o bloco de orçamento logo abaixo somava 01–30/09, os
dois escritos "setembro". Na Hoje e no badge da dock era pior — `useBudgetsStatus()` manda HOJE,
e no dia 11/09 o ciclo corrente já se chama outubro.

⚠️ **`budgets.month` é o RÓTULO; `occurred_at` é a JANELA.** Com ciclo os dois deixam de ser o
mesmo valor (rótulo `01/09`, janela `11/08`–`10/09`), e comparar `b.month` com o início da janela
faz o limite personalizado do mês sumir da tela sem erro nenhum.

⚠️ **A chave `budgets-status` não se conserta sozinha na troca de régua.** As outras são chaveadas
por `from`/`to`, que mudam junto; a do orçamento é chaveada pelo rótulo, que é o mesmo `2026-09`
nas duas réguas. Ela está em `REGUA_MUDOU` (`use-finance.ts`), a lista que os DOIS setters
invalidam.

## Em qual fatura cai a compra feita NO dia do fechamento

**Não há padrão, e por isso é campo do cartão** (`accounts.closing_day_inclusive`,
`20260911140000`). A `20260909050000` cravou `<` ("a compra DO dia já é da próxima") com prova
boa — duas faturas reais do Nubank, nos dois sentidos —, e o erro não foi a conclusão, foi
generalizar um emissor para o sistema inteiro. Pesquisado em 11/09/2026: o Mobills escreve "a
partir do dia de fechamento entra na seguinte", a Serasa escreve "antes ou **no dia exato** do
fechamento entram na fatura do mês atual", e acrescenta que depende do horário da compra e do
sistema da instituição.

O default é `false` = o comportamento que já valia. **Trocar a chave não reescreve o passado**: o
trigger só roda em insert/update da transação, então compra já classificada mantém o
`invoice_id`. Remanejar retroativamente mexeria em fatura paga e em mês fechado.

⚠️ **A borda anda UM dia, não o ciclo.** `p_inclusive` soma 1 à data de corte em vez de trocar
`<` por `<=` — uma expressão só, em vez de dois ramos que divergem. O teste confere que os dois
modos concordam nos outros 27 dias do mês.

⚠️ **O trigger se chama `public.tg_transactions_set_invoice()`; `set_invoice` é o nome do
TRIGGER.** Escrever `create or replace function private.set_invoice()` CRIA uma função órfã —
sem erro, sem aviso, com a migration aplicando limpa — e a coluna nova nasce inerte. Quem pegou
foi `supabase/tests/regua_e_dia_do_fechamento.sql`, que insere a compra e confere o vencimento da
fatura em que ela caiu: testar `invoice_window` direto passava com o defeito de pé.

⚠️ **`CREATE OR REPLACE FUNCTION` preserva dono e permissões — e SÓ isso.** Toda cláusula que a
definição nova não repetir é APAGADA: foi assim que o trigger perdeu `security definer` e
`cycle_now` perdeu o `set timezone` que a `20260911030000` tinha pendurado por `alter function`
(o bug das 21h–00h voltando em silêncio). **Fuso e `security definer` vão no CABEÇALHO**, nunca
por `alter` depois — pendurados, eles morrem no próximo replace.

## "Quanto sobrou" tem UMA definição, e ela inclui o que não é transação

⚠️ **Nem tudo que sai do caixa é linha em `transactions`.** A parcela de financiamento sai do
CRONOGRAMA (`private.debt_schedule_for`) e a recorrente além do horizonte materializado sai da
REGRA (`private.recurring_projection_for`). Quem ignora essas duas fontes mostra um mês melhor do
que ele é — e não dá erro nenhum, só um número otimista.

Em 10/09/2026 existiam **três** respostas para "quanto sobrou em setembro" e uma estava errada:

| RPC | tela | setembro/2026 |
|---|---|---|
| `month_summary` (sobre `month_lines_for`) | O mês inteiro | **−358,75** |
| `cash_flow_forecast` | Projeção | acumulado, −707,92 no fim do mês |
| `monthly_cashflow` | Tendência mensal | **+1.126,25** ← lia só `transactions` |

A diferença de R$ 1.485,00 era uma linha só: `Parcela Carro (8/48)`, `origin='debt_schedule'`.
O gráfico dizia "sobrou mil reais" no mês em que o dono do produto estava no vermelho, e ele
reparou antes de nós. `monthly_cashflow` passou a agregar `month_lines_for`
(`20260911010000`): **existe uma fonte de linha do mês, e é ela.**

Custo medido em produção: 146–256 ms para 6–24 meses, contra ~20 ms da soma crua. É uma
chamada por montagem de tela, cacheada pelo TanStack Query.

⚠️ **A hachura "a pagar" mudou de régua junto**, de `status='pending'` para `not settled` — a
mesma coluna de "O mês inteiro". A diferença é a compra de cartão com fatura em aberto: `cleared`
na linha, mas o dinheiro ainda não saiu. Setembro: 3.433,01 → 4.961,01. Para um gráfico de FLUXO
DE CAIXA a régua nova é a certa.

⚠️ **Isto não reescreveu o passado, e o motivo é frágil:** `debt_schedule_for` devolve o
cronograma a partir da PRÓXIMA parcela. Se um dia ela passar a devolver as já pagas,
`private.debt_paid_in_month` não segura — ela procura transação com `debt_id`, e as 8 parcelas
pagas do carro moram só no cadastro (`debt_installments_undocumented`). Seria história reescrita
para baixo, em silêncio. Medido antes de aplicar: abril a agosto deram delta 0,00.

## O acumulado é o produto, não um detalhe da Projeção

A pergunta que faz o usuário manter uma planilha ao lado do app não é "quanto entrou e saiu neste
mês" — é *"o que de fato restou para eu gastar esse mês contando com o que restou do mês
anterior"*. Com salário caindo num mês e fatura vencendo no começo do outro, **mês isolado dá um
número que nunca existiu na conta dele.**

A série de caixa sempre foi cumulativa; o que faltava era o ponto de partida ESCRITO. `veioDe`
(`src/lib/forecast-months.ts`) sai por subtração (`saldo − entra + sai`) em vez de vir do mês
anterior no array: no primeiro mês não existe anterior, e o valor certo lá é o saldo em conta
ANTES dos vencimentos de hoje — nem o `hoje` do payload (que já os desconta), nem zero. Como é a
identidade da série, uma quebra futura aparece como número que não fecha.

Por isso o "E se…?" saiu do ÚLTIMO lugar da home do Financeiro para logo abaixo de "O mês
inteiro": o argumento antigo ("ninguém abre o app para simular") descrevia um simulador de
compra, não a única tela que responde quanto resta.

## Agregações

- Toda leitura agregada via RPC (padrão duplo interna/wrapper de `supabase.md`): `transactions_summary`, `monthly_cashflow`, `account_balances`, `budgets_status`. Não somar transações no cliente nem em TS das functions.
- **Previsto e realizado são colunas SEPARADAS, e o total nunca muda de significado**
  (09/09/2026). `account_balances` ganhou `cleared_cents`/`pending_in_cents`/`pending_out_cents`,
  `transactions_summary` ganhou `pending_cents`, `monthly_cashflow` ganhou
  `income_pending_cents`/`expense_pending_cents` e `month_summary` ganhou
  `income_unsettled_cents`. `balance_cents` e `total_cents` continuam sendo o total —
  três telas e o agente somam eles, e trocar o que uma coluna quer dizer é a quebra que não dá
  erro, só número errado. O realizado sai por subtração.

  ⚠️ **A tela é que escolhe qual coluna usar, e o cartão é o motivo.** Numa conta de dinheiro o
  saldo honesto é `cleared_cents`; num `credit_card` a parcela futura `pending` **é** dívida já
  assumida e o número certo é `balance_cents`. Filtrar `cleared` dentro do agregado forçaria um
  `case` de tipo de conta na soma — regra de produto vazando para dentro do SQL.

  ⚠️ **`month_summary` tem TRÊS definições que se alinham por POSIÇÃO** (`select *` em
  `public.month_summary` e `public._month_summary` sobre `private.month_summary_for`). Coluna
  nova entra nas três, no mesmo lugar, ou a tela mostra despesa no lugar de receita sem erro
  nenhum.
- `expenses_summary(from_date, to_date)` é **wrapper de back-compat** lendo `transactions where kind='expense'` — manter assinatura enquanto houver app antigo em campo.

## Cartão de crédito

- **A regra de ciclo mora no banco, em UM lugar**: o trigger `set_invoice` em `transactions` chama `private.invoice_window(closing_day, due_day, occurred_at)` e resolve a fatura. App, WhatsApp e importação não recalculam nada — nunca duplicar essa lógica em TS.
- Compra **antes** do dia de fechamento cai na fatura do próprio mês; **no** dia do fechamento e
  depois, na do mês seguinte — a janela é `[fechamento anterior, fechamento atual)`. Dia 31 em mês
  curto cai no último dia (`private.day_in_month`).
  > Isto era `<=` até 09/09/2026 e estava errado por um ciclo inteiro. Prova nos dois lados, mesmo
  > cartão: a fatura Nubank de 10/09 ("Período vigente: 03 AGO a 03 SET") contém as compras de
  > 03 AGO, e o OFX da de outubro (`DTSTART 20260903`) contém as de 03 SET. Era a causa de as
  > parcelas postadas no dia do fechamento aparecerem um mês fora. Migration
  > `20260909050000`, conciliação em `docs/bugs/2026-09-09-conciliacao-setembro.md`.
- Cartão é conta comum em partida dobrada: a compra deixa o saldo do cartão negativo (dívida) e o **pagamento da fatura é `transfer`** da conta pagadora para o cartão (RPC `pay_invoice`). Pagamento de fatura **nunca** é despesa nova — o gasto já contou na compra.
- **Pagar e quitar são efeitos diferentes e a interface tem que distinguir os dois.** `pay_invoice`
  move dinheiro (aceita valor parcial); `settle_invoice` marca a fatura como paga SEM criar
  transferência, para o pagamento que aconteceu fora do app. No app são dois botões; no WhatsApp,
  `pay_invoice` e `mark_paid` com a fatura como alvo. Confirmar "a fatura do Nubank" não separa os
  dois — a frase do SIM diz se o caixa se move.
- Parcelamento só pela RPC `create_installment_plan` (nunca inserindo N linhas no app).

## Projeção de fluxo de caixa

- **Horizonte da projeção: até 10 anos, e o teto num lugar só** (`20260910235500`).
  `private.clamp_forecast_days` — piso 1, teto 3650, default 90.

  > **Era 1095 (3 anos) por algumas horas em 10/09/2026.** O argumento para o teto baixo era
  > "a regra envelhece, projetar longe é fingir precisão" — e estava errado: PocketSmith
  > projeta 30 anos de saldo diário e o Monarch faz multi-ano. A resposta da indústria à
  > decadência da regra é dar ALAVANCA ao usuário, não encurtar o alcance, e a alavanca já
  > existe aqui: é o "E se…?". O que realmente impedia era CUSTO — com `draft_effect` sendo
  > chamada por dia, 3 anos com rascunho custava 1.769 ms e 10 anos passaria de 6 s. Depois da
  > `20260910234500`, 10 anos com duas hipóteses custa **68 ms**.

  ⚠️ **A leitura do app passa por `forecast_json`, não pelas RPCs `setof`.** O PostgREST corta
  a resposta em **1000 linhas** e o corte é MUDO: a série chega menor, o app soma "entra/sai" e
  tira o saldo do fim em cima do pedaço, e escreve o rótulo do horizonte pedido por cima. Medido
  em 10/09/2026 pela API autenticada: pedindo 3.650 dias vinham 1.000, último dia 05/06/2029,
  saldo **R$ 16.164,60 otimista** — e 3, 5 e 10 anos mostravam todos a MESMA data. Já valia em
  produção desde o teto de 3 anos (1.096 linhas, R$ 613,30 de erro).
  `cash_flow_forecast`/`forecast_with_drafts` continuam para o AGENTE (fala com o Postgres
  direto, sem esse teto) e para APK antigo; `src/lib/anti-slop.test.ts` quebra o build se uma
  tela voltar a chamá-las. **Qualquer leitura nova que possa passar de 1000 linhas nasce
  agregada ou em JSON** — não dá para ver esse defeito no SQL, só na tela.

  ⚠️ **"O mês inteiro" NÃO tem teto, e isso é desenho, não esquecimento.** Já foi levantado
  duas vezes como inconsistência ("a Projeção para em N anos e o mês navega para sempre").
  Medido em produção em 10/09/2026: `month_lines_for` em março/2035 devolve as MESMAS 6
  entradas (R$ 7.566,52) de outubro/2026, com 15 linhas marcadas `projected` — a recorrente é
  expandida da REGRA em qualquer distância, então o mês distante não some com a receita. Não
  existe ali o modo de falha que derrubava a projeção. E o `MonthSheet` recusa teto de propósito
  ("um teto criaria a única fronteira do app que o usuário descobriria batendo nela"). O teto da
  Projeção limita o TAMANHO DA SÉRIE, não a honestidade do dado — são coisas diferentes.

  ⚠️ **Teto de LEITURA não é janela de ESCRITA.** O materializador segue gravando UM ano
  (`HORIZON_DAYS = 365`); tudo além é calculado. Subir o teto não grava uma linha.

  ⚠️ **Não crie um segundo teto em código de aplicação.** Já aconteceu duas vezes. Na
  primeira, o 365 estava cravado dentro de `cash_flow_forecast` E de `_cash_flow_forecast`: a
  tela parava em "6 meses", "O mês inteiro" navegava para 2028 e mostrava tudo, e o seletor de
  mês do rascunho — que só oferece os meses DA JANELA — tornava impossível supor uma receita em
  2028 com o dado existindo. Na segunda, o agente ganhou um espelho (`FORECAST_MAX_DIAS`) que
  durou poucas horas. Quem pede demais recebe o máximo, e a frase lê a data do último dia que
  VOLTOU — não há o que espelhar.

  Efeito colateral bom da centralização: `affordability` chama com 370 dias e filtra até
  `add_months(hoje, parcelas)`; com o teto em 365, parcelamento acima de 12 meses era truncado
  em silêncio e o "pior dia" saía otimista.

- **Rascunho de cenário: um motor, duas portas** (`20260910170000`). `private.draft_effect(drafts,
  dia)` é a ÚNICA aritmética de hipótese do sistema — receita soma, gasto subtrai, parcela cai de
  mês em mês e o resto da divisão vai na última. Dela saem `forecast_with_drafts` (o Rascunho da
  Projeção) e `affordability` ("Posso comprar isso?", que virou uma casca de UMA hipótese de
  gasto). Antes, `affordability` tinha a conta dentro de si e por isso **só sabia gasto**.
  `supabase/tests/draft_scenario.sql` prova que ele devolve o mesmo de antes — trocar o motor de
  uma feature que funciona sem provar equivalência é como ela quebra em silêncio.

  **Duas formas de hipótese, e confundi-las erra por um fator de N** (`20260910200000`):
  `mode: 'total'` reparte um total em N parcelas (3.000 em 6x = 500/mês, a COMPRA);
  `mode: 'monthly'` repete o valor cheio todo mês (1.500/mês, a RECORRÊNCIA). `mode` ausente cai
  em `total` — é o que mantém `affordability` intacta. Em `monthly` a função **não precisa saber
  onde a projeção termina**: ela é avaliada por dia, e "quantas vezes já repetiu até `d`" é
  aritmética de meses; quem corta é o horizonte de quem chama.

  **O bloco chama-se "E se…?", não mais "Posso comprar isso?"** — o nome antigo contava a
  limitação (a conta vivia dentro do `affordability`, que sempre subtrai). Com `kind`, o bloco
  responde entrada E saída, e o veredito sai da própria série simulada (`primeiroNegativo` sobre
  `serie`), não de uma segunda RPC.

  ⚠️ **O rascunho move o CAIXA, e só.** Não remonta fatura (`set_invoice`), orçamento
  (`_budgets_status`) nem cronograma de dívida (`debt_schedule_for`) — reproduzir essas regras no
  cliente ou numa segunda função seria a cópia que diverge. A tela diz isso ao usuário.

  ⚠️ **Ele vive em `useState` da Projeção e em lugar nenhum mais** — nem banco, nem
  AsyncStorage, e `gcTime: 0` no hook para não ressuscitar do cache. Sair da tela apaga, que é o
  contrato com o usuário. A hipótese nunca começa ANTES de hoje (a projeção começa hoje, e uma
  data passada entrava no saldo sem ter dia na janela para aparecer em "entra/sai").


- **Receita atrasada sai da projeção depois de 3 dias; despesa atrasada NÃO** (`20260909200000`).
  `greatest(coalesce(due_at, occurred_at), current_date)` empurra todo previsto vencido para hoje.
  Para despesa está certo: você atrasou, mas ainda deve. Para receita era o anti-padrão que a
  prática de contas a receber nomeia — *"não assuma que o atrasado será pago mais rápido do que
  historicamente foi"* —, e na versão extrema: reassumia todo dia que chega HOJE. A janela de 3
  dias é a mesma cadência do alerta `income_to_confirm`: o app cutuca duas vezes e então deixa de
  contar. **Some do número, não da tela** — continua em "O que entra" com a pílula "não caiu".
- Modelo de caixa (não contar o mesmo gasto duas vezes): saldo inicial = contas **não-cartão**, só `cleared`; saídas futuras = (a) toda fatura não paga **na data de vencimento** + (b) `pending` sem fatura em `coalesce(due_at, occurred_at)`. Compra no cartão sai do caixa quando a fatura vence, não quando foi feita.
- `cash_flow_forecast(days)`, `upcoming_bills(days)` e `affordability(amount_cents, installments)` — pares interna/wrapper. `affordability` **compõe** com a projeção (interna chama interna, wrapper chama wrapper): não duplicar a query grande.
- **`transactions.auto_confirm` decide quem vira `cleared` sozinho na data** (`20260909110000`).
  A coluna mora na LINHA, não só na série: o materializador cria ocorrência com data passada já
  `cleared` (`scheduler.py:101`) sem passar pelo promote, então uma regra que vivesse só em
  `_promote_due_transactions` não cobriria esse caminho. A ocorrência HERDA o valor da série.
  **Receita nasce `false`** — Pix de terceiro precisa de comprovação; salário é o caso em que
  ligar faz sentido, e é escolha explícita do usuário, não inferência de categoria. Parcela de
  compra parcelada continua fora (espera pagamento).
- **Receita prevista que passou da data gera alerta `income_to_confirm`** — no dia e três dias
  depois, e para. Aberto (`occurred_at <= current_date`) mandaria o mesmo aviso todo dia, e no
  WhatsApp fora da janela de 24h isso é template PAGO.

## Editar em série — "o passado só muda à mão"

- **Editar tem ESCOPO, igual apagar já tinha**: "só esta" ou "esta e as futuras"
  (`update_transaction_scoped` e `update_recurring_series`, migration `20260909070000`). A
  pergunta é feita no SALVAR e só quando um campo propagável mudou — perguntar na abertura seria
  perguntar sem saber se há o que propagar.
- **Futuro é `status = 'pending'` E `occurred_at >= a da âncora`, as duas juntas.** Cada condição
  sozinha deixa passar um caso: só o status pega a parcela ATRASADA (passado para o usuário); só a
  data pega a parcela paga ADIANTADA (já aconteceu, e pode estar numa fatura quitada).
  `supabase/tests/scoped_transaction_edit.sql` testa as duas separadas.
- **Campos propagáveis: valor, categoria, descrição, comerciante, conta.** `occurred_at` não —
  data é de cada ocorrência e propagar empilharia tudo no mesmo dia. `status` também não: baixa
  tem caminho próprio, com efeito em fatura e projeção.
- **A âncora é sempre a primeira parcela EM ABERTO**, nunca a primeira do plano: a RPC reescreve a
  âncora inclusive no escopo "futuras", e ancorar numa parcela paga mexeria num mês fechado.
- **Editar em lote recalcula `installment_plans.total_cents`** e **atualiza a regra da
  recorrência**. Sem o primeiro, a tela mostra um total que não é a soma do que está embaixo dele;
  sem o segundo, os 90 dias materializados ficam com o valor novo e o mês seguinte volta com o
  velho (o unique `(recurring_id, occurred_at)` impede o cron de reescrever).
- ⚠️ **Formulário não escreve campo que ele não mostra.** Em cartão o "vou pagar depois" não
  existe, e o form derivava `status` desse campo ausente: editar o NOME de uma parcela futura dava
  baixa nela, mudando a projeção e o total da fatura sem nada na tela dizer isso. Onde o campo não
  aparece, o valor é o que já era.

## Rotativo — a fatura vencida que vai para a próxima

O usuário só tinha duas saídas para uma fatura que não pagou: deixá-la atrasada para sempre ou
marcá-la como PAGA. A segunda é mentira, e mentira que contamina tudo — saldo, projeção,
patrimônio. `roll_invoice` é a terceira (`20260911040000`).

**Encargos são ESTIMATIVA, e a tela não promete exatidão.**

- **IOF segue a fórmula da lei** — 0,38% + 0,0082% ao dia, teto 3,38% (Decretos 12.466/2025 e
  12.499/2025) — e ela acerta a ordem de grandeza, **não o centavo**. Medido contra a cobrança
  real do Nubank em agosto/2026: sobre R$ 333,72 a fórmula dá R$ 2,12 e o emissor cobrou
  R$ 2,13. A diferença é contagem de dias e arredondamento do banco, que não são públicos.
  ⚠️ Este arquivo já afirmou "IOF é exato" — era afirmação forte demais e foi corrigida.
- **A taxa de juros NÃO fica num campo** (`20260911060000`). O dono do produto barrou o desenho
  antes de ir para produção: *"esse valor pode mudar também à medida que o tempo passa, por isso
  não queria deixar fixo"*. E os números dele provam: a cobrança real foi **12,876%**, não os
  15,5% que eu tinha usado de exemplo — um campo fixo erraria ~20% já no primeiro mês.

  `private.rotativo_rate_for` divide os juros efetivamente cobrados pelo saldo que os gerou, na
  última vez que isso aconteceu **naquele cartão**. Se atualiza sozinha a cada fatura importada.
  `accounts.rotativo_rate_monthly` sobrou como taxa de PARTIDA, só enquanto não há o que
  observar; sem as duas, o app não estima juros e diz isso.

  ⚠️ **Linha `(estimado)` não alimenta a estimativa.** Sem esse filtro o palpite de um mês vira
  a "observação" do seguinte e o número nunca mais se corrige — um laço que parece aprendizado
  e é só eco.

⚠️ **Regra de terceiro não vira trava de digitação.** A primeira versão recusava adiar uma
fatura que já tinha recebido um saldo adiado, citando a Resolução CMN 4.549/2017 (o rotativo
dura um ciclo). O dono do produto apontou o furo — *"o Nubank consegue, ele mescla o pendente
na fatura como se fosse um lançamento"* — e ele estava certo: **a 4.549 obriga o BANCO**. Com a
trava, uma fatura que na vida real carregou saldo dois ciclos ficaria impossível de registrar, e
a única saída seria de novo marcar como paga uma fatura não paga. Hoje `roll_invoice` devolve
`segundo_ciclo` e a tela AVISA. A única recusa que ficou é adiar a MESMA fatura duas vezes, que
é idempotência de verdade.

⚠️ **Duas contagens duplas, e as duas são mudas.**
1. **Caixa**: a fatura adiada continua `status <> 'paid'`, então ela pesaria no vencimento E o
   principal pesaria de novo na fatura seguinte. São **15 ocorrências em 9 funções** — o filtro
   virou `status not in ('paid','rolled')`. `supabase/tests/roll_invoice.sql` prende o
   "exatamente uma vez".
2. **Competência**: o principal adiado NÃO é gasto novo — é a mesma compra, já contada no mês em
   que foi feita. Ele precisa existir como lançamento (o total da fatura é a soma das transações
   dela), mas `month_lines_for` e `budgets_status_for` o excluem por
   `transactions.rollover_of_invoice_id`. Sem isso a compra de agosto inflaria setembro e comeria
   o orçamento duas vezes. **Juros e IOF são gasto novo e contam em todo lugar.**

⚠️ **A interface nunca escreve "rolada".** O dono do produto recusou o jargão — *"eu não saberia
o que seria rolada"*. O status no banco é `rolled`; na tela é **"Adiada"**, e a linha diz
**"Foi para a fatura de 10/11"**, que é o que aconteceu.

⚠️ **Fatura ADIADA não recebe cobrança nova — `set_invoice` segue a corrente.** Achado pelo
teste de três ciclos seguidos, e é dinheiro sumindo em silêncio: a adiada sai da projeção, então
os juros e o IOF REAIS que chegam na importação do extrato, datados dentro daquele ciclo, iam
para dentro dela e desapareciam. O emissor faz o mesmo que a correção: fechada a fatura e
mandado o saldo ao rotativo, o que vem depois é cobrado na próxima.

⚠️ **`to_char(d, 'TMMonth')` escreve em INGLÊS aqui.** O `TM` traduz pelo `lc_time` da sessão, e
o Postgres do Supabase roda em `C`. Saiu "Saldo em rotativo de July" no primeiro teste com dados
reais. Quem traduz mês é `private.mes_pt` — array literal, exato, sem depender de configuração
global.

**Automático é por CARTÃO e nasce desligado** (`accounts.rotativo_auto`). Ligado para todos, um
cartão pago em dia nunca mais apareceria como atrasado. O cron roda um dia DEPOIS do vencimento
(`due_date < current_date`, nunca `<=`): pagar no próprio dia é o normal.

**O agente NÃO adia fatura** — lacuna declarada em `docs/AGENTE-PARIDADE-COM-O-APP.md`, com o
motivo (teto de `FinanceAction`) e o custo aceito.

## Patrimônio

- `assets` + `asset_valuations` (marcação com data). Valor novo entra sempre por `update_asset_value`, que grava no histórico — nunca `update` direto na coluna.
- **Histórico é SNAPSHOT** (`net_worth_snapshots`, tirado pelo `finance-scheduler`), não reconstrução: não existe histórico de valor de imóvel/investimento/dívida, e reconstruir seria inventar número. A série começa quando o usuário começa a usar.
- **Caixa inclui transação sem conta.** `private.cash_total()` é a fonte única — usada por patrimônio e pela projeção. Lançamento do WhatsApp costuma vir sem conta; ignorá-lo zerava o caixa de quem só usa o WhatsApp (bug corrigido na `0028`).

## Alertas proativos

- Quem decide o que alertar é `_alerts_to_send()`; quem entrega é `POST /cron/alerts`
  (`agent/app/jobs/alerts.py`, Cloud Scheduler diário).
- **Dedupe por dia** em `alerts_sent` (workspace, tipo, ref, `sent_on`), reservado ANTES do envio. Cron rodando duas vezes não pode virar spam — no WhatsApp spam é template pago.
- Toda mensagem termina numa ação ("quer que eu remaneje?", "me manda paguei"). Alerta que só informa é o que faz o usuário desinstalar no segundo mês.

## Planos e limites

- **Limite de plano mora em `private.plan_limits`, num lugar só.** Espalhar número de plano pelo código é como o produto acaba cobrando de um jeito e entregando de outro.
- `plan_status()` devolve plano + consumo do mês + limites numa chamada: serve a tela E o gate da
  IA em `_check_limits` (`agent/app/worker.py`). ⚠️ O consumo do mês é `count(*)` de `ai_events` —
  o agente que não gravar lá derruba o paywall em silêncio.
- Cancelamento é **uma chamada, sem formulário** (`cancel_subscription`). Dificultar cancelamento é a reclamação nº1 contra os concorrentes no Reclame Aqui — não repetir.
- Convite de membro é por **telefone** (o mesmo vínculo do WhatsApp), normalizado com DDI para casar com `profiles.phone`.

## Regras de negócio

- Transferência não conta como receita nem despesa em resumos (excluir `kind='transfer'` das agregações de fluxo).
- Undo via WhatsApp (`undo_last`) apaga apenas a transação mais recente do usuário e responde o que apagou.
- Conta citada por nome no WhatsApp resolve por `ilike`; sem match → `account_id null` (o lançamento nunca falha por conta desconhecida).
