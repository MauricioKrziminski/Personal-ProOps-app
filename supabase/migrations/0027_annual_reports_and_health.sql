-- Relatórios anuais (o que a declaração de IR pede) e score de saúde financeira.
-- Transferência nunca entra em receita/despesa — regra do domínio.

/** Totais do ano + taxa de poupança. */
create or replace function public.annual_summary(p_year int)
returns table(
  income_cents bigint, expense_cents bigint, balance_cents bigint,
  savings_rate numeric, tx_count bigint
)
language sql stable
set search_path = public
as $$
  with t as (
    select kind, amount_cents
    from public.transactions
    where workspace_id in (select private.my_workspace_ids())
      and kind <> 'transfer'
      and extract(year from occurred_at) = p_year
      and status = 'cleared'
  ),
  totais as (
    select coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::bigint as receitas,
           coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::bigint as despesas,
           count(*)::bigint as qtd
    from t
  )
  select receitas, despesas, (receitas - despesas)::bigint,
         case when receitas > 0
              then round(100.0 * (receitas - despesas) / receitas, 1)
              else 0 end,
         qtd
  from totais;
$$;

/** Receitas e despesas do ano por categoria — a espinha do relatório anual. */
create or replace function public.annual_by_category(p_year int)
returns table(kind text, category text, total_cents bigint, tx_count bigint)
language sql stable
set search_path = public
as $$
  select t.kind, coalesce(t.category, 'outros'),
         sum(t.amount_cents)::bigint, count(*)::bigint
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
    and t.kind <> 'transfer'
    and extract(year from t.occurred_at) = p_year
    and t.status = 'cleared'
  group by 1, 2
  order by 1, 3 desc;
$$;

/**
 * Saldo de cada conta e valor de cada bem em 31/12 do ano.
 * É exatamente o que a ficha "Bens e Direitos" da declaração pede.
 */
create or replace function public.year_end_balances(p_year int)
returns table(kind text, name text, balance_cents bigint)
language sql stable
set search_path = public
as $$
  with fim as (select make_date(p_year, 12, 31) as dia)
  select 'account'::text, a.name,
         (a.initial_balance_cents + coalesce((
           select sum(case
             when t.kind = 'income'   and t.account_id = a.id then t.amount_cents
             when t.kind = 'expense'  and t.account_id = a.id then -t.amount_cents
             when t.kind = 'transfer' and t.account_id = a.id then -t.amount_cents
             when t.kind = 'transfer' and t.counterparty_account_id = a.id then t.amount_cents
             else 0 end)
           from public.transactions t, fim
           where t.status = 'cleared' and t.occurred_at <= fim.dia
             and (t.account_id = a.id or t.counterparty_account_id = a.id)
         ), 0))::bigint
  from public.accounts a
  where a.workspace_id in (select private.my_workspace_ids())
  union all
  select 'asset', ativo.name,
         coalesce((
           select v.value_cents from public.asset_valuations v, fim
           where v.asset_id = ativo.id and v.as_of <= fim.dia
           order by v.as_of desc limit 1
         ), ativo.current_value_cents)::bigint
  from public.assets ativo
  where ativo.workspace_id in (select private.my_workspace_ids()) and not ativo.is_liability
  order by 1, 2;
$$;

/**
 * Score de saúde financeira 0..100, com as parcelas visíveis para o app poder
 * explicar CADA ponto. Score sem explicação vira número de para-choque.
 *   poupança (0..40): quanto da receita sobra
 *   orçamento (0..25): quantas categorias dentro do limite
 *   reserva   (0..20): meses de despesa cobertos pelo caixa
 *   dívida    (0..15): comprometimento com dívidas + faturas
 */
create or replace function public.financial_health()
returns table(
  score int, savings_rate numeric, months_of_reserve numeric,
  budget_adherence numeric, debt_ratio numeric
)
language sql stable
set search_path = public
as $$
  with ultimos as (
    select coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::numeric as receitas,
           coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::numeric as despesas
    from public.transactions
    where workspace_id in (select private.my_workspace_ids())
      and kind <> 'transfer' and status = 'cleared'
      and occurred_at >= (current_date - interval '3 months')::date
  ),
  patrimonio as (select * from public.net_worth()),
  orcamentos as (
    select count(*)::numeric as total,
           count(*) filter (where spent_cents <= limit_cents)::numeric as dentro
    from public.budgets_status()
  ),
  base as (
    select case when u.receitas > 0 then (u.receitas - u.despesas) / u.receitas else 0 end as poupanca,
           case when u.despesas > 0
                then greatest(p.cash_cents, 0)::numeric / (u.despesas / 3)
                else 0 end as reserva,
           case when o.total > 0 then o.dentro / o.total else 1 end as aderencia,
           case when u.receitas > 0
                then least(p.liabilities_cents::numeric / u.receitas, 1)
                else case when p.liabilities_cents > 0 then 1 else 0 end end as divida
    from ultimos u, patrimonio p, orcamentos o
  )
  select (
      least(greatest(b.poupanca, 0), 0.4) / 0.4 * 40
      + b.aderencia * 25
      + least(b.reserva, 6) / 6 * 20
      + (1 - b.divida) * 15
    )::int,
    round(b.poupanca * 100, 1),
    round(b.reserva, 1),
    round(b.aderencia * 100, 1),
    round(b.divida * 100, 1)
  from base b;
$$;
