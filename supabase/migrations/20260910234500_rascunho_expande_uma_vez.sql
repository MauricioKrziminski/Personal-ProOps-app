-- Rascunho: expandir as hipóteses UMA vez, não uma vez por dia (10/09/2026)
--
-- ## O defeito, medido em produção
--
-- `forecast_with_drafts` fazia `cross join lateral private.draft_effect(drafts, f.day)` — ou
-- seja, chamava a função **por LINHA da série**. Cada chamada re-parseia o JSONB, re-expande
-- o `generate_series` de cada parcela e re-agrega tudo de novo. É O(dias × hipóteses × parcelas)
-- para produzir um resultado que precisa de O(hipóteses × parcelas + dias).
--
-- Com 2 hipóteses, em produção:
--
--   | horizonte | sem rascunho | com rascunho |
--   |---|---|---|
--   | 90 dias   |  28 ms |   171 ms |
--   | 1 ano     |  36 ms |   601 ms |
--   | 3 anos    |  85 ms | 1.769 ms |
--
-- Escolher "3 anos" e somar uma suposição custava quase dois segundos, e cresce LINEAR com o
-- horizonte — a 10 anos seria ~6 s.
--
-- ## O conserto
--
-- A expansão vira `private.draft_ocorrencias(drafts, ate)`, que devolve o CONJUNTO de
-- ocorrências uma vez. Dela saem as duas portas:
--
--   private.draft_ocorrencias(drafts, ate)     ← a expansão, num lugar só
--        ├── private.draft_effect(drafts, d)   ← agrega para UM dia (o contrato antigo)
--        └── forecast_with_drafts / _forecast_with_drafts ← agrupa por data e acumula
--
-- ⚠️ **`draft_effect` continua existindo e com o MESMO retorno.** `affordability` e
-- `_affordability` chegam nela por dentro dos wrappers, e há a asserção de equivalência em
-- `supabase/tests/draft_scenario.sql` que existe justamente para uma troca de motor não mudar
-- o resultado de uma feature que funciona. Uma aritmética só: quem muda a regra muda em
-- `draft_ocorrencias` e as duas portas acompanham.
--
-- ⚠️ **O acumulado vira window function, e isso só é correto porque a hipótese não começa
-- antes do dia 0** (`20260910233000`): `sum(...) over (order by day)` soma o que caiu em dias
-- QUE ESTÃO na série. Uma ocorrência anterior ao primeiro dia não teria linha para somar e
-- sumiria do saldo — com a trava do piso, toda ocorrência cai dentro da janela. As duas
-- migrations são um par; não reverta a de baixo sozinha.

create or replace function private.draft_ocorrencias(drafts jsonb, ate date)
returns table (kind text, vence date, cents bigint)
language sql
stable
set search_path = public
as $$
  with h as (
    select
      coalesce(x->>'kind', 'expense') as kind,
      coalesce(x->>'mode', 'total') as mode,
      greatest(coalesce((x->>'amount_cents')::bigint, 0), 0) as total,
      least(greatest(coalesce((x->>'installments')::int, 1), 1), 72) as parcelas,
      -- o piso da `20260910233000`: a série começa em `current_date` e uma parcela datada
      -- antes disso mexeria no saldo sem ter dia na janela para aparecer em "entra/sai"
      greatest(coalesce((x->>'start')::date, ate), current_date) as inicio
    from jsonb_array_elements(coalesce(drafts, '[]'::jsonb)) x
  ),
  p as (
    select kind, mode, inicio, total, parcelas,
           -- em `monthly` a repetição é ilimitada: quem corta é o fim da janela
           case when mode = 'monthly'
                then greatest(
                       (extract(year from age(ate, inicio)) * 12
                        + extract(month from age(ate, inicio)))::int + 1, 0)
                else parcelas end as vezes,
           case when mode = 'monthly' then total else (total / parcelas)::bigint end as valor,
           -- o resto da divisão inteira vai na ÚLTIMA parcela, como em
           -- `create_installment_plan`: sem isso, 100 em 3x soma 99
           case when mode = 'monthly' then 0::bigint
                else (total - (total / parcelas)::bigint * parcelas)::bigint end as resto
    from h
  )
  select p.kind,
         private.add_months(p.inicio, i)::date,
         (p.valor + case when p.mode <> 'monthly' and i = p.parcelas - 1 then p.resto else 0 end)
           ::bigint
  from p cross join lateral generate_series(0, greatest(p.vezes - 1, -1)) i
  where p.vezes > 0;
$$;

revoke execute on function private.draft_ocorrencias(jsonb, date) from public, anon;
grant execute on function private.draft_ocorrencias(jsonb, date) to authenticated, service_role;


-- O contrato antigo, agora uma agregação fina por cima da expansão. Mesmo retorno, mesmos
-- números — é o que `affordability` continua consumindo por dentro dos wrappers.
create or replace function private.draft_effect(drafts jsonb, d date)
returns table (in_cents bigint, out_cents bigint, delta_cents bigint)
language sql
stable
set search_path = public
as $$
  select
    coalesce(sum(cents) filter (where kind = 'income'  and vence = d), 0)::bigint,
    coalesce(sum(cents) filter (where kind <> 'income' and vence = d), 0)::bigint,
    coalesce(sum(case when kind = 'income' then cents else -cents end)
             filter (where vence <= d), 0)::bigint
  from private.draft_ocorrencias(drafts, d);
$$;

revoke execute on function private.draft_effect(jsonb, date) from public, anon;
grant execute on function private.draft_effect(jsonb, date) to authenticated, service_role;


create or replace function public._forecast_with_drafts(uid uuid, days integer, drafts jsonb)
returns table (day date, in_cents bigint, out_cents bigint, balance_cents bigint)
language sql stable security definer
set search_path = public
as $$
  with base as (select * from public._cash_flow_forecast(uid, days)),
  por_dia as (
    select o.vence as day,
           coalesce(sum(o.cents) filter (where o.kind = 'income'), 0)::bigint  as in_add,
           coalesce(sum(o.cents) filter (where o.kind <> 'income'), 0)::bigint as out_add,
           coalesce(sum(case when o.kind = 'income' then o.cents else -o.cents end), 0)::bigint
             as delta_add
    from private.draft_ocorrencias(drafts, (select max(day) from base)) o
    group by o.vence
  )
  select b.day,
         (b.in_cents + coalesce(p.in_add, 0))::bigint,
         (b.out_cents + coalesce(p.out_add, 0))::bigint,
         (b.balance_cents
          + coalesce(sum(coalesce(p.delta_add, 0)) over (order by b.day), 0))::bigint
  from base b
  left join por_dia p on p.day = b.day
  order by b.day;
$$;
revoke execute on function public._forecast_with_drafts(uuid, integer, jsonb)
  from public, anon, authenticated;

create or replace function public.forecast_with_drafts(days integer, drafts jsonb)
returns table (day date, in_cents bigint, out_cents bigint, balance_cents bigint)
language sql stable
set search_path = public
as $$
  with base as (select * from public.cash_flow_forecast(days)),
  por_dia as (
    select o.vence as day,
           coalesce(sum(o.cents) filter (where o.kind = 'income'), 0)::bigint  as in_add,
           coalesce(sum(o.cents) filter (where o.kind <> 'income'), 0)::bigint as out_add,
           coalesce(sum(case when o.kind = 'income' then o.cents else -o.cents end), 0)::bigint
             as delta_add
    from private.draft_ocorrencias(drafts, (select max(day) from base)) o
    group by o.vence
  )
  select b.day,
         (b.in_cents + coalesce(p.in_add, 0))::bigint,
         (b.out_cents + coalesce(p.out_add, 0))::bigint,
         (b.balance_cents
          + coalesce(sum(coalesce(p.delta_add, 0)) over (order by b.day), 0))::bigint
  from base b
  left join por_dia p on p.day = b.day
  order by b.day;
$$;
