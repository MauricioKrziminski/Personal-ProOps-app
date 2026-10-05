-- F17 — "Como é calculado": a saúde financeira passa a DEVOLVER a janela que usou.
--
-- A explicação da tela escreve o período da resposta, e o score só tinha o número. O corpo é o da
-- `0027` sem nenhuma conta alterada; entram `window_from` e `window_to` NO FIM, calculados na MESMA
-- CTE que já cortava os três meses — duas expressões para a mesma janela seriam a segunda cópia.
--
-- Mudar o tipo de retorno não cabe em `create or replace`: drop + create. O drop leva junto o
-- `alter function ... set timezone` da `20260911030000` e os grants, então o fuso vai no CABEÇALHO
-- e os grants voltam aqui. Idempotente: pode rodar duas vezes.

drop function if exists public.financial_health();

create function public.financial_health()
returns table(
  score int, savings_rate numeric, months_of_reserve numeric,
  budget_adherence numeric, debt_ratio numeric,
  window_from date, window_to date
)
language sql stable
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  with ultimos as (
    select coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::numeric as receitas,
           coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::numeric as despesas,
           (current_date - interval '3 months')::date as janela_de,
           current_date as janela_ate
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
                else case when p.liabilities_cents > 0 then 1 else 0 end end as divida,
           u.janela_de, u.janela_ate
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
    round(b.divida * 100, 1),
    b.janela_de,
    b.janela_ate
  from base b;
$$;

revoke execute on function public.financial_health() from public, anon;
grant execute on function public.financial_health() to authenticated, service_role;
