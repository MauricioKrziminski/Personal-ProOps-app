-- "falta receber" — o que o mês esperava e ainda não caiu.
--
-- `month_lines` já classifica cada linha por `settled` (`20260909040000:53-57`), tratando cartão
-- (`ci.status='paid'`) e dívida. O agregado tinha os três recortes de DESPESA
-- (`fixas_unsettled`, `parcelas_unsettled`, `variaveis_unsettled`) e nenhum de RECEITA — por isso
-- `month.tsx:113` cravava `falta.entrada = 0`. O dado existia e só não era somado.
--
-- ⚠️ **As TRÊS definições se alinham por POSIÇÃO.** `public.month_summary` e
-- `public._month_summary` fazem `select * from private.month_summary_for(...)`, então a
-- correspondência é posicional, não por nome. Acrescentar a coluna em duas e esquecer a terceira
-- alinha `income_unsettled_cents` com `expense_cents`: a tela mostraria despesa no lugar de
-- receita, sem erro nenhum, em silêncio. Por isso as três mudam neste mesmo arquivo, e a coluna
-- entra logo depois de `income_cents` nas três.
--
-- `drop` antes de `create` porque o tipo de retorno muda (42P13) — e o `drop` leva o `revoke`
-- junto, então ele é reemitido no fim.

drop function if exists public.month_summary(date);
drop function if exists public._month_summary(uuid, date);
drop function if exists private.month_summary_for(uuid[], date);

create function private.month_summary_for(ws_ids uuid[], p_month date)
returns table (
  income_cents bigint,
  income_unsettled_cents bigint,
  expense_cents bigint,
  result_cents bigint,
  fixas_cents bigint,
  fixas_unsettled_cents bigint,
  parcelas_cents bigint,
  parcelas_unsettled_cents bigint,
  variaveis_cents bigint,
  variaveis_unsettled_cents bigint,
  opening_cash_cents bigint,
  closing_cash_cents bigint,
  recurring_covered_until date,
  beyond_recurring_horizon boolean,
  debt_installments_undocumented int
)
language sql stable
set search_path = public
as $$
  with mes as (
    select date_trunc('month', p_month)::date as ini,
           (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date as fim
  ),
  l as (select * from private.month_lines_for(ws_ids, p_month)),
  horizonte as (
    -- a série que ACABOU não é "além do horizonte": ela simplesmente terminou
    select min(r.materialized_until)::date as ate,
           bool_or(r.materialized_until is null
                   or r.materialized_until::date < (select fim from mes)) as falta
    from public.recurring_transactions r
    where r.workspace_id = any(ws_ids) and r.active
      and (r.end_date is null or r.end_date >= (select fim from mes))
  ),
  sem_registro as (
    -- parcelas declaradas como pagas no cadastro que não têm lançamento nenhum por trás.
    -- É contagem do WORKSPACE, não do mês: a tela só a usa em mês passado.
    select coalesce(sum(greatest(
             d.installments_paid - (select count(*) from public.transactions t where t.debt_id = d.id),
             0)), 0)::int as n
    from public.debts d
    where d.workspace_id = any(ws_ids) and not d.archived
  )
  select
    coalesce(sum(l.amount_cents) filter (where l.kind = 'income'), 0)::bigint,
    coalesce(sum(l.amount_cents) filter (where l.kind = 'income' and not l.settled), 0)::bigint,
    coalesce(sum(l.amount_cents) filter (where l.kind = 'expense'), 0)::bigint,
    (coalesce(sum(l.amount_cents) filter (where l.kind = 'income'), 0)
     - coalesce(sum(l.amount_cents) filter (where l.kind = 'expense'), 0))::bigint,
    coalesce(sum(l.amount_cents) filter (where l.bucket = 'fixa'), 0)::bigint,
    coalesce(sum(l.amount_cents) filter (where l.bucket = 'fixa' and not l.settled), 0)::bigint,
    coalesce(sum(l.amount_cents) filter (where l.bucket = 'parcela'), 0)::bigint,
    coalesce(sum(l.amount_cents) filter (where l.bucket = 'parcela' and not l.settled), 0)::bigint,
    coalesce(sum(l.amount_cents) filter (where l.bucket = 'variavel'), 0)::bigint,
    coalesce(sum(l.amount_cents) filter (where l.bucket = 'variavel' and not l.settled), 0)::bigint,
    private.cash_total(ws_ids, (select ini from mes) - 1),
    case when (select ini from mes) <= current_date
         then private.cash_total(ws_ids, least((select fim from mes), current_date)) end,
    (select ate from horizonte),
    coalesce((select falta from horizonte), false),
    (select n from sem_registro)
  from l;
$$;
grant execute on function private.month_summary_for(uuid[], date) to authenticated, service_role;

create function public._month_summary(uid uuid, p_month date)
returns table (
  income_cents bigint, income_unsettled_cents bigint, expense_cents bigint, result_cents bigint,
  fixas_cents bigint, fixas_unsettled_cents bigint,
  parcelas_cents bigint, parcelas_unsettled_cents bigint,
  variaveis_cents bigint, variaveis_unsettled_cents bigint,
  opening_cash_cents bigint, closing_cash_cents bigint,
  recurring_covered_until date, beyond_recurring_horizon boolean,
  debt_installments_undocumented int
)
language sql stable security definer
set search_path = public
as $$
  select * from private.month_summary_for(array(select public._workspace_ids(uid)), p_month);
$$;
revoke execute on function public._month_summary(uuid, date) from public, anon, authenticated;

create function public.month_summary(p_month date)
returns table (
  income_cents bigint, income_unsettled_cents bigint, expense_cents bigint, result_cents bigint,
  fixas_cents bigint, fixas_unsettled_cents bigint,
  parcelas_cents bigint, parcelas_unsettled_cents bigint,
  variaveis_cents bigint, variaveis_unsettled_cents bigint,
  opening_cash_cents bigint, closing_cash_cents bigint,
  recurring_covered_until date, beyond_recurring_horizon boolean,
  debt_installments_undocumented int
)
language sql stable
set search_path = public
as $$
  select * from private.month_summary_for(array(select private.my_workspace_ids()), p_month);
$$;
