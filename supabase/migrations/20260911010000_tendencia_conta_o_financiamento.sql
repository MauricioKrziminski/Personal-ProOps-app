-- A tendência mensal contava DUAS das três coisas que saem do caixa.
--
-- `monthly_cashflow` lia `transactions` cru. Só que nem tudo que sai do caixa é transação: a
-- parcela de financiamento vem do CRONOGRAMA da dívida (`debt_schedule_for`) e a recorrente
-- além do horizonte materializado vem da REGRA (`recurring_projection_for`). As outras duas
-- leituras do mês já sabiam disso — `month_summary` (a tela "O mês inteiro") e
-- `cash_flow_forecast` (a Projeção) somam as três fontes desde a `20260910140000`.
--
-- Medido em produção em 10/09/2026, setembro:
--   monthly_cashflow  →  entrou 7.441,62 · saiu 6.315,37 · "sobrou" +1.126,25
--   month_summary     →  entrou 7.441,62 · saiu 7.800,37 · resultado −358,75
-- A diferença de R$ 1.485,00 é uma linha só: `Parcela Carro (8/48)`, vencendo 23/09,
-- `origin = 'debt_schedule'`. O gráfico dizia "sobrou mil reais" no mês em que o dono do
-- produto estava no vermelho, e ele reparou antes de nós.
--
-- ⚠️ Isto NÃO reescreve o passado, e a razão é `debt_schedule_for`: ela devolve o cronograma a
-- partir da PRÓXIMA parcela, não o contrato inteiro. Medido nos seis meses da janela antes de
-- aplicar — abril a agosto deram delta 0,00 e só setembro mudou. Se um dia ela passar a
-- devolver as parcelas já pagas, `private.debt_paid_in_month` (que procura transação com
-- `debt_id`) não segura o carro, porque o carro não tem nenhuma: as 8 parcelas pagas moram só
-- no cadastro. Seria história reescrita para baixo, em silêncio.
--
-- A assinatura não muda, mas a HACHURA "a pagar" da barra muda de régua, e de propósito: era
-- `t.status = 'pending'` e passou a ser `not settled`, que é a mesma coluna que "O mês inteiro"
-- já usa. A diferença é a compra de cartão com a fatura em aberto — `cleared` na linha, mas o
-- dinheiro ainda não saiu do caixa. Em setembro/2026, produção: 3.433,01 → 4.961,01. Para um
-- gráfico de FLUXO DE CAIXA a régua nova é a certa; a antiga desenhava como realizado um gasto
-- que ainda está para sair.

create or replace function private.monthly_lines_range(ws_ids uuid[], meses int)
returns table (
  month date, income_cents bigint, expense_cents bigint,
  income_pending_cents bigint, expense_pending_cents bigint
)
language sql stable set search_path = public as $$
  with janela as (
    select generate_series(
             date_trunc('month', current_date) - make_interval(months => least(greatest(coalesce(meses, 6), 1), 60)),
             date_trunc('month', current_date),
             interval '1 month')::date as ini
  ),
  linhas as (
    select j.ini as month, l.*
    from janela j cross join lateral private.month_lines_for(ws_ids, j.ini) l
  )
  select month,
         coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::bigint,
         coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::bigint,
         coalesce(sum(amount_cents) filter (where kind = 'income'  and not settled), 0)::bigint,
         coalesce(sum(amount_cents) filter (where kind = 'expense' and not settled), 0)::bigint
  from linhas
  group by month
  order by month;
$$;

-- Mesma postura dos irmãos em `private` (`month_lines_for`, `month_summary_for`,
-- `debt_schedule_for`): `authenticated` PRECISA de execute, senão o wrapper `security invoker`
-- abaixo chama permission denied. Quem protege é o schema não ser exposto pelo PostgREST — não
-- existe `/rest/v1/rpc/monthly_lines_range` — mais o `ws_ids` vir de quem chama.
revoke execute on function private.monthly_lines_range(uuid[], int) from public, anon;
grant execute on function private.monthly_lines_range(uuid[], int) to authenticated, service_role;

create or replace function public.monthly_cashflow(months_back int default 6)
returns table (
  month date, income_cents bigint, expense_cents bigint,
  income_pending_cents bigint, expense_pending_cents bigint
)
language sql stable set search_path = public as $$
  select * from private.monthly_lines_range(
    array(select private.my_workspace_ids()), months_back);
$$;

create or replace function public._monthly_cashflow(uid uuid, months_back int default 6)
returns table (
  month date, income_cents bigint, expense_cents bigint,
  income_pending_cents bigint, expense_pending_cents bigint
)
language sql stable security definer set search_path = public as $$
  select * from private.monthly_lines_range(
    array(select public._workspace_ids(uid)), months_back);
$$;

revoke execute on function public._monthly_cashflow(uuid, int) from public, anon, authenticated;
