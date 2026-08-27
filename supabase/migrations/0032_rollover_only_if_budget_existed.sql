-- BUG do rollover: orcamento criado HOJE ganhava "sobra" de um mes em que ele
-- nem existia.
--
-- A CTE `limite_anterior` usava o limite padrao (month is null) como se ele
-- valesse retroativamente. Criar "lazer 500" hoje fazia julho contar como
-- "limite 500, gasto 0" => 500 de sobra, e o limite do mes virava 1000. Um gasto
-- de 450 aparecia como 45% em vez de 90%.
--
-- Correcao: o limite padrao so conta para o mes anterior se o orcamento ja
-- EXISTIA antes deste mes comecar (`created_at < inicio do mes`). Override
-- explicito daquele mes obviamente existia, entao continua valendo sempre.
--
-- Nao guardamos historico de limite, entao o padrao ATUAL segue como aproximacao
-- do que valia no mes passado — mas so quando ele e anterior ao mes corrente.
create or replace function private.budgets_status_for(ws_ids uuid[], ref_month date)
returns table(
  category text, limit_cents bigint, spent_cents bigint,
  base_limit_cents bigint, rollover_cents bigint, rollover boolean, month date
)
language sql stable
set search_path = public
as $$
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
           sum(t.amount_cents)::bigint as cents
    from public.transactions t, mes m
    where t.workspace_id = any(ws_ids)
      and t.kind = 'expense'
      and t.occurred_at >= m.inicio and t.occurred_at < m.fim
    group by 1
  ),
  gasto_anterior as (
    select coalesce(t.category, 'outros') as category,
           sum(t.amount_cents)::bigint as cents
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
$$;
