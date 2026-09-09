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
- **`budgets`**: `month` null = limite padrão; linha com `month` sobrescreve aquele mês. **Dois unique parciais** (NULL não colide com NULL no Postgres). `rollover` soma a sobra do mês anterior, um nível só — e **só se o orçamento já existia antes do mês corrente** (`created_at`), senão um orçamento criado hoje ganharia sobra de um mês em que não existia. Status via `_budgets_status`.
- **`debts`**: dívidas com `interest_rate_monthly` em fração mensal (1,99% a.m. = 0.0199). `debt_schedule` monta a Price; `pay_debt_installment` abate o saldo **já descontando os juros do mês**.
- **`recurring_transactions`**: RRULE + `dtstart` (âncora imutável) + `next_run_at` (próxima ocorrência FUTURA, é o que o app mostra) + `materialized_until` (controle do cron). Materializadas **90 dias à frente** pelo `finance-scheduler` como `pending`, com `source='recurring'`. Idempotência pelo unique `(recurring_id, occurred_at)`.
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
  lançamentos), "roupa", "eletrônicos" e "impostos" não davam para escolher no app. Existem DUAS
  cópias literais, porque nem o Deno nem o Python importam de
  `src/`: `agent/app/domain/categories.py` (a que vale hoje) e `_shared/gemini.ts` (legado).
  `src/lib/categories.test.ts` falha se qualquer uma divergir — mexeu numa, mexe nas outras. A
  tabela `categories` legada foi dropada na `0010_workspaces.sql`.

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
