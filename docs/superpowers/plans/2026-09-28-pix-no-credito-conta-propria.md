# Pix no crédito para conta própria (cartão → conta) — plano

Pedido do Gabriel (28/09/2026). Mapeamento feito no STAGING com `pg_get_functiondef`; nada foi
alterado ainda.

## O modelo

Uma `transfer` com `account_id` = cartão e `counterparty_account_id` = conta própria, **paga**
(`status='cleared'`, `paid_at` = data; o dinheiro chegou na conta). Os juros do Pix são uma
despesa à parte no cartão (`DESCRICAO_JUROS_DO_PIX` / `useJurosDoPix`).

`tg_transactions_set_invoice` já dá `invoice_id` a QUALQUER linha do cartão (conferido), e o
pagamento da fatura (conta → cartão) nunca recebe. Então "linha da fatura" = `invoice_id` +
`kind in ('expense','transfer')`. Criar `private.conta_na_fatura(p_kind text)` IMMUTABLE,
language sql, **sem `set`** (para inlinar), e usá-la em todo lugar abaixo. Grants como as
irmãs (`authenticated` e `service_role` com EXECUTE; o schema `private` só tem USAGE).

## Função por função

| função | muda? |
|---|---|
| `private.invoice_open_cents` | **sim**: soma com `conta_na_fatura` |
| `public._card_summary` e `public.card_summary` (a pública repete a consulta) | **sim**: CTE `totals` |
| `public._upcoming_bills` e `public.upcoming_bills` | **sim**: o `join` que escolhe a fatura |
| `public._cash_flow_forecast` e `public.cash_flow_forecast` | **sim**: o `join` que escolhe a fatura |
| `public._alerts_to_send` (1º trecho, aviso da fatura) | **sim** |
| `private.cash_events` | **sim, e um RAMO NOVO**: transferência de cartão para conta não-cartão = ENTRADA no dia (mesma forma do ramo 1). Sem ele, a fatura cobra 340 no vencimento e a entrada no Itaú nunca aparece. Lido por `_cycle_lines`, `cycle_lines`, `spendable_events_for`, `cycle_series_for`. |
| `budgets_status_for`, `month_lines_for` | não (competência: transferência não é gasto) |
| `_account_balances`, `cash_total` | não (já tratam transferência nos dois lados) |
| `_liquidar_faturas_vencidas`, `tg_card_invoices_liquidada` | não (o Pix nasce pago) |
| `importar_parcelado`, `anticipation_candidates`, `cycle_series_for` (o `em_aberto`) | não |

Copiar cabeçalhos do `pg_get_functiondef` (SECURITY DEFINER, `SET TimeZone`, `search_path`):
`CREATE OR REPLACE` apaga o que não repetir. Migration nova depois de `20260928220000`.

## Teste SQL (`supabase/tests/pix_no_credito.sql`)

Transferência de 340 cartão → conta: total e `invoice_open_cents` +340; `budgets_status`
igual; `cash_flow_forecast` com +340 de saída no vencimento, conta com +340 pago, saldo final
igual ao de antes; ciclo com a entrada no dia e a saída no vencimento (uma vez cada).

## Depois do banco

1. App: telas que filtram linha de fatura por `'expense'` em TS (`invoice/[id].tsx`,
   `useInvoice`, `card-status.ts`) e "Pix no crédito" para conta própria no formulário
   (transferência com origem cartão + juros), editável com os mesmos campos.
2. Agente: paridade ("fiz um pix no crédito de 340 pro Itaú"), `docs/AGENTE-PARIDADE-COM-O-APP.md`.
3. Importação: "Valor adicionado na conta por cartão de crédito" (conta) e "Pix no Crédito -
   <titular>" (fatura) casam com a transferência.
4. Juros do rotativo: a cobrança real importada substitui a estimativa "(estimado)" (mínimo
   combinado); tirar a estimativa do total de hoje é a versão completa.

## Produção (quem roda é o Gabriel, depois da migration lá)

Script numa transação, com `set_config('request.jwt.claims', …)`: a linha
`abd9ea5b-f019-4f38-ad6b-242927e1ea69` vira transferência de 34000 cartão → Itaú + despesa de
1699 "Juros do Pix no crédito" em 23/09; conferir fatura de outubro = 445475, Nubank Conta paga
= 32251, Itaú paga = 500, e desfazer se não bater. Depois, acertar o saldo inicial real do Itaú.
