-- O orçamento também ignora o principal adiado.
--
-- Ficou de fora da `20260911040000` porque o meu gerador abortou ao achar DUAS ocorrências de
-- `and t.kind = 'expense'` em `budgets_status_for` — o mês corrente e o anterior (que alimenta
-- a sobra do `rollover`). A asserção estava certa em me parar: substituir só a primeira teria
-- deixado a sobra do mês anterior contando o principal adiado, e o teto do mês seguinte sairia
-- errado por um valor que ninguém relacionaria com isso.
--
-- Sem esta exclusão a compra de agosto comeria o orçamento de agosto E o de setembro.
CREATE OR REPLACE FUNCTION private.budgets_status_for(ws_ids uuid[], ref_month date)
 RETURNS TABLE(category text, limit_cents bigint, spent_cents bigint, committed_cents bigint, base_limit_cents bigint, rollover_cents bigint, rollover boolean, month date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
      -- dívida que mudou de fatura já comeu o orçamento no mês da compra
      and t.rollover_of_invoice_id is null
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
      -- dívida que mudou de fatura já comeu o orçamento no mês da compra
      and t.rollover_of_invoice_id is null
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
$function$;
