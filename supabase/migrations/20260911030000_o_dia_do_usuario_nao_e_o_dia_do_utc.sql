-- O banco acha que já é amanhã das 21h às 24h, todo dia.
--
-- O Postgres do Supabase roda em UTC, e `current_date` dentro de uma função lê o fuso da
-- SESSÃO. Medido em 10/09/2026 às 21h03 BRT: aparelho e Mac diziam `10/09`, o banco dizia
-- `11/09`. Consequência nas três horas finais de todo dia: a projeção começava amanhã (e
-- largava o que ainda vence hoje), "o que vence" perdia o dia, e — o que tornou isto visível —
-- o ciclo virava cedo: com fechamento no dia 10, às 21h do dia 10 o app já mostrava o ciclo
-- seguinte.
--
-- ## Por que NÃO mudar o fuso do banco
--
-- A doc do Supabase é explícita: *"Every Supabase database is set to UTC by default. We
-- strongly recommend keeping it this way"*. `alter database postgres set timezone` resolveria
-- as 24 de uma vez, mas mudaria junto o `auth`, o `storage`, o `realtime` e os checkpoints do
-- LangGraph — troca um defeito de 3 horas por uma mudança de semântica no banco inteiro.
--
-- ## Por que não reescrever as 24 funções
--
-- A alternativa honesta era um `private.today()` e 24 corpos reescritos. São 24 chances de
-- errar uma linha em SQL que já está certo, e o defeito não está no corpo delas — está no fuso
-- em que ele é avaliado. `alter function ... set timezone` fixa a GUC pela DURAÇÃO da chamada:
-- o corpo não muda, o default do banco não muda, e como a GUC vale para tudo que a função
-- chamar, quem entra pela porta pública leva o fuso certo para a árvore inteira.
--
-- Provado no staging antes de aplicar, no mesmo instante: `cycle_now` devolvia `diasAteOFim`
-- 19 em UTC (30/09 − 11/09) e 20 com o fuso (30/09 − 10/09).
--
-- ⚠️ **O fuso é FIXO e isso é uma decisão, não esquecimento.** O produto é brasileiro em todas
-- as pontas — pt-BR, WhatsApp pela Meta BR, BRL, telefone com DDI 55 — e não existe coluna de
-- fuso em lugar nenhum. Inventá-la agora seria configuração para um usuário que não existe.
-- Quando existir, o caminho é `private.today(ws_ids)` lendo `workspaces.timezone`, e estas 24
-- linhas viram `reset timezone`.
alter function private.debt_schedule_for(p_debt_id uuid) set timezone to 'America/Sao_Paulo';
alter function private.draft_ocorrencias(drafts jsonb, ate date) set timezone to 'America/Sao_Paulo';
alter function private.effective_plan(ws_id uuid) set timezone to 'America/Sao_Paulo';
alter function private.month_summary_for(ws_ids uuid[], p_month date) set timezone to 'America/Sao_Paulo';
alter function private.monthly_lines_range(ws_ids uuid[], meses integer) set timezone to 'America/Sao_Paulo';
alter function private.recurring_drop_future() set timezone to 'America/Sao_Paulo';
alter function public._affordability(uid uuid, amount_cents bigint, installments integer) set timezone to 'America/Sao_Paulo';
alter function public._alerts_to_send() set timezone to 'America/Sao_Paulo';
alter function public._card_summary(uid uuid) set timezone to 'America/Sao_Paulo';
alter function public._cash_flow_forecast(uid uuid, days integer) set timezone to 'America/Sao_Paulo';
alter function public._close_due_invoices() set timezone to 'America/Sao_Paulo';
alter function public._promote_due_transactions() set timezone to 'America/Sao_Paulo';
alter function public._snapshot_net_worth() set timezone to 'America/Sao_Paulo';
alter function public._upcoming_bills(uid uuid, days integer) set timezone to 'America/Sao_Paulo';
alter function public.affordability(amount_cents bigint, installments integer) set timezone to 'America/Sao_Paulo';
alter function public.card_summary() set timezone to 'America/Sao_Paulo';
alter function public.cash_flow_forecast(days integer) set timezone to 'America/Sao_Paulo';
alter function public.create_installment_plan(p_account_id uuid, p_total_cents bigint, p_installments integer, p_occurred_at date, p_description text, p_category text, p_merchant text) set timezone to 'America/Sao_Paulo';
alter function public.cycle_now() set timezone to 'America/Sao_Paulo';
alter function public.expenses_monthly(months_back integer) set timezone to 'America/Sao_Paulo';
alter function public.financial_health() set timezone to 'America/Sao_Paulo';
alter function public.net_worth_series(months_back integer) set timezone to 'America/Sao_Paulo';
alter function public.upcoming_bills(days integer) set timezone to 'America/Sao_Paulo';
alter function public.update_recurring_series(p_recurring_id uuid, p_patch jsonb, p_propagate boolean) set timezone to 'America/Sao_Paulo';
