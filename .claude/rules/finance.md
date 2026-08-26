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
- **`budgets`**: `month` null = limite padrão; linha com `month` sobrescreve aquele mês. **Dois unique parciais** (NULL não colide com NULL no Postgres). `rollover` soma a sobra do mês anterior, um nível só. Status via `_budgets_status`.
- **`debts`**: dívidas com `interest_rate_monthly` em fração mensal (1,99% a.m. = 0.0199). `debt_schedule` monta a Price; `pay_debt_installment` abate o saldo **já descontando os juros do mês**.
- **`recurring_transactions`**: RRULE + `dtstart` (âncora imutável) + `next_run_at` (próxima ocorrência FUTURA, é o que o app mostra) + `materialized_until` (controle do cron). Materializadas **90 dias à frente** pelo `finance-scheduler` como `pending`, com `source='recurring'`. Idempotência pelo unique `(recurring_id, occurred_at)`.

## Categorias

- **Texto livre, minúsculo, curto** — sem FK. Fonte única da lista de sugestões: `src/lib/categories.ts`. O prompt do Gemini (`_shared/gemini.ts`) mantém uma cópia literal porque roda em Deno e não importa de `src/`; `src/lib/categories.test.ts` falha se as duas divergirem — mexeu numa, mexe na outra. A tabela `categories` legada foi dropada na `0010_workspaces.sql`.

## Agregações

- Toda leitura agregada via RPC (padrão duplo interna/wrapper de `supabase.md`): `transactions_summary`, `monthly_cashflow`, `account_balances`, `budgets_status`. Não somar transações no cliente nem em TS das functions.
- `expenses_summary(from_date, to_date)` é **wrapper de back-compat** lendo `transactions where kind='expense'` — manter assinatura enquanto houver app antigo em campo.

## Cartão de crédito

- **A regra de ciclo mora no banco, em UM lugar**: o trigger `set_invoice` em `transactions` chama `private.invoice_window(closing_day, due_day, occurred_at)` e resolve a fatura. App, WhatsApp e importação não recalculam nada — nunca duplicar essa lógica em TS.
- Compra **até** o dia de fechamento cai na fatura do próprio mês; depois, na do mês seguinte. Dia 31 em mês curto cai no último dia (`private.day_in_month`).
- Cartão é conta comum em partida dobrada: a compra deixa o saldo do cartão negativo (dívida) e o **pagamento da fatura é `transfer`** da conta pagadora para o cartão (RPC `pay_invoice`). Pagamento de fatura **nunca** é despesa nova — o gasto já contou na compra.
- Parcelamento só pela RPC `create_installment_plan` (nunca inserindo N linhas no app).

## Projeção de fluxo de caixa

- Modelo de caixa (não contar o mesmo gasto duas vezes): saldo inicial = contas **não-cartão**, só `cleared`; saídas futuras = (a) toda fatura não paga **na data de vencimento** + (b) `pending` sem fatura em `coalesce(due_at, occurred_at)`. Compra no cartão sai do caixa quando a fatura vence, não quando foi feita.
- `cash_flow_forecast(days)`, `upcoming_bills(days)` e `affordability(amount_cents, installments)` — pares interna/wrapper. `affordability` **compõe** com a projeção (interna chama interna, wrapper chama wrapper): não duplicar a query grande.
- `pending` → `cleared` só automaticamente para parcela de compra parcelada e recorrente com `auto_confirm`. Conta a pagar avulsa espera o usuário confirmar.

## Alertas proativos

- Quem decide o que alertar é `_alerts_to_send()`; quem entrega é a Edge Function `send-alerts` (cron diário).
- **Dedupe por dia** em `alerts_sent` (workspace, tipo, ref, `sent_on`), reservado ANTES do envio. Cron rodando duas vezes não pode virar spam — no WhatsApp spam é template pago.
- Toda mensagem termina numa ação ("quer que eu remaneje?", "me manda paguei"). Alerta que só informa é o que faz o usuário desinstalar no segundo mês.

## Regras de negócio

- Transferência não conta como receita nem despesa em resumos (excluir `kind='transfer'` das agregações de fluxo).
- Undo via WhatsApp (`undo_last`) apaga apenas a transação mais recente do usuário e responde o que apagou.
- Conta citada por nome no WhatsApp resolve por `ilike`; sem match → `account_id null` (o lançamento nunca falha por conta desconhecida).
