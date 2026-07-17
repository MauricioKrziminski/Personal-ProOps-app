# Domínio financeiro

## Dinheiro

- **Sempre `amount_cents` bigint inteiro e positivo. Nunca float, nunca decimal, nunca `parseFloat`.** Sinal/direção vem do `kind`, não do valor.
- Moeda default BRL. Exibição só via `formatBRL` (app) / `centsToBRL` (functions).

## Modelo (v1)

- **`transactions`** unificada: `kind in (expense, income, transfer)`. Transfer exige `counterparty_account_id` (check no banco). `occurred_at date`. `source in (whatsapp, app, import, recurring)`.
- **`accounts`**: carteiras/contas com `type in (checking, savings, credit_card, cash, investment)` e `initial_balance_cents`. Saldo é **derivado** (RPC `_account_balances`), nunca coluna materializada. Cartão de crédito é só um tipo de conta — fatura/fechamento é v2.
- **`goals`**: `target_cents` + `saved_cents` atualizado direto (sem ledger de aportes na v1).
- **`budgets`**: limite mensal fixo por categoria, unique (user_id, category). Status via RPC `_budgets_status` (limite vs gasto do mês).
- **`recurring_transactions`**: RRULE + `next_run_at`; materializadas pelo cron do `send-reminders` com `source='recurring'`.

## Categorias

- **Texto livre, minúsculo, curto** — sem FK. Lista de sugestões compartilhada entre o prompt do Gemini e os chips do app: mercado, transporte, lazer, contas, saúde, casa, educação, assinaturas, salário, freela, outros. A tabela `categories` legada existe mas não é usada — não construir em cima dela.

## Agregações

- Toda leitura agregada via RPC (padrão duplo interna/wrapper de `supabase.md`): `transactions_summary`, `monthly_cashflow`, `account_balances`, `budgets_status`. Não somar transações no cliente nem em TS das functions.
- `expenses_summary(from_date, to_date)` é **wrapper de back-compat** lendo `transactions where kind='expense'` — manter assinatura enquanto houver app antigo em campo.

## Regras de negócio

- Transferência não conta como receita nem despesa em resumos (excluir `kind='transfer'` das agregações de fluxo).
- Undo via WhatsApp (`undo_last`) apaga apenas a transação mais recente do usuário e responde o que apagou.
- Conta citada por nome no WhatsApp resolve por `ilike`; sem match → `account_id null` (o lançamento nunca falha por conta desconhecida).
