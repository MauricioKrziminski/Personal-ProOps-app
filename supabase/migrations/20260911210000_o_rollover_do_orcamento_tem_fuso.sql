-- O rollover do orçamento não pode depender do fuso da SESSÃO.
--
-- `private.budgets_status_for` compara `b.created_at` (timestamptz) com `m.inicio` (date), e
-- não tinha `SET "TimeZone"` no cabeçalho — era a ÚNICA função do banco comparando `created_at`
-- com uma borda de período sem fixar o fuso (conferido no catálogo).
--
-- ⚠️ Uma `date` comparada com `timestamptz` é convertida usando o fuso da SESSÃO, e o Postgres
-- do Supabase roda em UTC. `m.inicio` de 01/09 vira 01/09 00:00 UTC, que é 31/08 21:00 em
-- Brasília: um orçamento padrão criado entre 21h e meia-noite da véspera lê como "criado depois
-- que o período começou" e **perde o rollover daquele mês**. Janela de 3 horas, silenciosa, e só
-- aparece para quem tem `rollover` ligado — ou seja, some sem ninguém ligar os pontos.
--
-- É a mesma família do bug das 21h que a `20260911030000` corrigiu em 24 funções; esta ficou de
-- fora porque não usa `current_date`, e sim uma conversão implícita.
--
-- ⚠️ **O fuso vai no CABEÇALHO, nunca por `alter function` depois:** `CREATE OR REPLACE`
-- preserva dono e permissões e APAGA toda cláusula que a definição nova não repetir. Neste
-- repositório isso já custou um `security definer` e um `set timezone` pendurados.
--
-- A definição abaixo é a vigente, de `pg_get_functiondef`, com UMA linha acrescentada.

CREATE OR REPLACE FUNCTION private.budgets_status_for(ws_ids uuid[], ref_month date, p_view text DEFAULT NULL::text)
 RETURNS TABLE(category text, limit_cents bigint, spent_cents bigint, committed_cents bigint, base_limit_cents bigint, rollover_cents bigint, rollover boolean, month date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with regua as (
    select private.cycle_close_day(ws_ids, p_view) as close_day
  ),
  rotulos as (
    select r.close_day,
           private.cycle_month_of(r.close_day, ref_month) as rotulo,
           (private.cycle_month_of(r.close_day, ref_month) - interval '1 month')::date as rotulo_anterior
    from regua r
  ),
  mes as (
    select t.rotulo,
           t.rotulo_anterior,
           b.ini as inicio,
           (b.fim + 1) as fim,          -- exclusivo, como era com `+ interval '1 month'`
           a.ini as anterior             -- ciclos são contíguos: o anterior termina em `inicio`
    from rotulos t
    cross join lateral private.cycle_bounds(t.close_day, t.rotulo) b
    cross join lateral private.cycle_bounds(t.close_day, t.rotulo_anterior) a
  ),
  efetivos as (
    select distinct on (b.category)
           b.category, b.limit_cents, b.rollover, b.month
    from public.budgets b, mes m
    where b.workspace_id = any(ws_ids)
      and (b.month is null or b.month = m.rotulo)
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
    -- O rollover olha o ciclo FECHADO, e ali "já aconteceu" é a mesma régua: um boleto de agosto
    -- que nunca foi pago não pode consumir a sobra que vai para setembro.
    select coalesce(t.category, 'outros') as category,
           coalesce(sum(t.amount_cents) filter (
             where t.status = 'cleared' or t.invoice_id is not null), 0)::bigint as cents
    from public.transactions t, mes m
    where t.workspace_id = any(ws_ids)
      and t.kind = 'expense'
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
        b.month = m.rotulo_anterior
        -- limite padrao: so vale se ja existia antes deste ciclo comecar
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
$function$
;
