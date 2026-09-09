-- Orçamento separa o que JÁ ACONTECEU do que está COMPROMETIDO.
--
-- `budgets_status_for` somava toda despesa do mês sem olhar status: um boleto agendado que você
-- ainda pode adiar contava como gasto, igual a uma compra feita. É o padrão que o YNAB não segue
-- — lá transação agendada não entra no "Activity" da categoria; ela aparece num total à parte e
-- a categoria ganha destaque quando o que vem não está coberto.
--
-- ⚠️ **A régua NÃO é `status`, é "já aconteceu".** Filtrar `cleared` seria trocar um erro por
-- outro pior:
--
--   • parcela de CARTÃO futura é `pending`, mas a compra ACONTECEU — você comprou em 12x e a
--     parcela de outubro é gasto de outubro, inevitável. Tirá-la faria o orçamento subestimar
--     justamente o cartão, que é onde o gasto costuma escapar;
--   • boleto agendado (`invoice_id` nulo) não aconteceu — dá para adiar, renegociar, não pagar.
--
-- Daí: `spent_cents` = efetivado + parcela de cartão; `committed_cents` = previsto sem fatura.
-- `spent_cents` MUDA de significado, e é a única coluna deste conjunto que muda — por isso os
-- consumidores (5 telas, a tab bar e o alerta) foram revisados um a um no mesmo commit.

drop function if exists public.budgets_status(date);
drop function if exists public._budgets_status(uuid, date);
drop function if exists private.budgets_status_for(uuid[], date);

create function private.budgets_status_for(ws_ids uuid[], ref_month date)
returns table(category text, limit_cents bigint, spent_cents bigint, committed_cents bigint,
              base_limit_cents bigint, rollover_cents bigint, rollover boolean, month date)
language sql
stable
set search_path to 'public'
as $fn$
  with mes as (
    select date_trunc('month', ref_month)::date as inicio,
           (date_trunc('month', ref_month) + interval '1 month')::date as fim,
           (date_trunc('month', ref_month) - interval '1 month')::date as anterior
  ),
  efetivos as (
    select distinct on (b.category)
           b.category, b.limit_cents, b.rollover, b.month
    from public.budgets b, mes m
    where b.workspace_id = any(ws_ids)
      and (b.month is null or b.month = m.inicio)
    order by b.category, b.month nulls last
  ),
  gasto as (
    select coalesce(t.category, 'outros') as category,
           -- JÁ ACONTECEU: efetivado, ou parcela de cartão (a compra foi feita)
           coalesce(sum(t.amount_cents) filter (
             where t.status = 'cleared' or t.invoice_id is not null), 0)::bigint as cents,
           -- AINDA PODE NÃO ACONTECER: previsto fora de fatura
           coalesce(sum(t.amount_cents) filter (
             where t.status = 'pending' and t.invoice_id is null), 0)::bigint as previsto
    from public.transactions t, mes m
    where t.workspace_id = any(ws_ids)
      and t.kind = 'expense'
      and t.occurred_at >= m.inicio and t.occurred_at < m.fim
    group by 1
  ),
  gasto_anterior as (
    -- O rollover olha o mês FECHADO, e ali "já aconteceu" é a mesma régua: um boleto de agosto
    -- que nunca foi pago não pode consumir a sobra que vai para setembro.
    select coalesce(t.category, 'outros') as category,
           coalesce(sum(t.amount_cents) filter (
             where t.status = 'cleared' or t.invoice_id is not null), 0)::bigint as cents
    from public.transactions t, mes m
    where t.workspace_id = any(ws_ids)
      and t.kind = 'expense'
      and t.occurred_at >= m.anterior and t.occurred_at < m.inicio
    group by 1
  ),
  limite_anterior as (
    select distinct on (b.category) b.category, b.limit_cents
    from public.budgets b, mes m
    where b.workspace_id = any(ws_ids)
      and (
        -- override daquele mes: existia por definicao
        b.month = m.anterior
        -- limite padrao: so vale se ja existia antes deste mes comecar
        or (b.month is null and b.created_at < m.inicio)
      )
    order by b.category, b.month nulls last
  )
  select e.category,
         (e.limit_cents + case
            when e.rollover then greatest(
              coalesce(la.limit_cents, 0) - coalesce(ga.cents, 0), 0)
            else 0 end)::bigint as limit_cents,
         coalesce(g.cents, 0)::bigint as spent_cents,
         coalesce(g.previsto, 0)::bigint as committed_cents,
         e.limit_cents as base_limit_cents,
         (case when e.rollover then greatest(
            coalesce(la.limit_cents, 0) - coalesce(ga.cents, 0), 0)
         else 0 end)::bigint as rollover_cents,
         e.rollover,
         e.month
  from efetivos e
  left join gasto g on g.category = e.category
  left join gasto_anterior ga on ga.category = e.category
  left join limite_anterior la on la.category = e.category
  order by 3 desc;
$fn$;

create function public._budgets_status(uid uuid, ref_month date default current_date)
returns table(category text, limit_cents bigint, spent_cents bigint, committed_cents bigint,
              base_limit_cents bigint, rollover_cents bigint, rollover boolean, month date)
language sql
stable security definer
set search_path to 'public'
as $fn$
  select * from private.budgets_status_for(
    array(select public._workspace_ids(uid)), ref_month);
$fn$;
revoke execute on function public._budgets_status(uuid, date) from public, anon, authenticated;

create function public.budgets_status(ref_month date default current_date)
returns table(category text, limit_cents bigint, spent_cents bigint, committed_cents bigint,
              base_limit_cents bigint, rollover_cents bigint, rollover boolean, month date)
language sql
stable
set search_path to 'public'
as $fn$
  select * from private.budgets_status_for(
    array(select private.my_workspace_ids()), ref_month);
$fn$;
